const pool = require("../config/db");
const { FEATURES } = require("../config/features");
const { clean, optionalNumber } = require("../utils/money");
const stockLedger = require("../services/stockLedger");
const invoiceRepository = require("../repositories/invoiceRepository");
const { checkHsn, minHsnDigits } = require("../services/hsnService");
const { businessId } = require("../middlewares/businessContext");
const {
  cityFilterFrom,
  resolveCitySql,
} = require("../services/sellerLocation");

/**
 * Hides a sold out listing from the catalogue, but only while stock counts
 * are believed. With stock hidden, a listing created since carries a count of
 * zero, and this clause would have hidden every one of them from search and
 * from the shop page. See config/features.
 */
const IN_STOCK = FEATURES.STOCK_TRACKING ? "AND si.stock > 0" : "";

/**
 * How a listing reaches the seller behind it.
 *
 * LEFT, and this matters more than it looks. These joins used to be inner, so
 * a wholesaler who had signed up but not filled in their business details had
 * every one of their listings vanish from search, from the product page and
 * from the shop page. No error, no empty state, no way for them to tell: the
 * products simply were not there. A new seller's first hour is exactly when
 * their profile is least likely to be complete.
 *
 * users is joined too so there is always a name to show. A person who has not
 * named their firm yet still has their own name, and "Ramesh Kumar" is a better
 * answer than hiding their stock.
 */
const SELLER_JOIN = `
      JOIN users su ON su.id = si.supplier_id
      LEFT JOIN wholesaler_profiles wp ON wp.user_id = si.supplier_id`;

// The firm's name if they have given one, otherwise their own.
const SELLER_NAME = `
      COALESCE(NULLIF(btrim(wp.company_name), ''),
               NULLIF(btrim(su.first_name || ' ' || COALESCE(su.last_name, '')), ''),
               'Wholesaler')`;

// Where a listing is allowed to appear. See migrations/listing_visibility.sql.
//   public      catalogue, search, comparison, and the storefront
//   storefront  the wholesaler's own page only, never the shared catalogue
//   private     nowhere public, the wholesaler's dashboard only
const VISIBILITY_LEVELS = ["public", "storefront", "private"];

// An unrecognised value would otherwise fail the CHECK constraint with a 500.
// Falling back to the caller's current setting (or 'public' on create) keeps
// the old clients working, since they send no visibility at all.
const normalizeVisibility = (value, fallback = "public") => {
  const level = String(value || "").toLowerCase();
  return VISIBILITY_LEVELS.includes(level) ? level : fallback;
};

// @desc    Add a product
// @route   POST /api/products
exports.addProduct = async (req, res) => {
  const {
    productId,
    name,
    category,
    description,
    price,
    bulkPrice,
    moq,
    stock,
    shippingDays,
    imageUrl,
    visibility,
    unit,
    packSize,
    hsnCode,
    gstPercent,
    notes,
  } = req.body;
  const supplierId = businessId(req);

  try {
    let finalProductId = productId;

    if (!finalProductId) {
      const newProduct = await pool.query(
        "INSERT INTO products (name, category, description, global_image_url) VALUES ($1, $2, $3, $4) RETURNING id",
        [name, category, description, imageUrl],
      );
      finalProductId = newProduct.rows[0].id;
    }

    // Digits only, and 4, 6 or 8 of them. Refused rather than stored, because
    // a code of the wrong length ends up printed on a tax invoice describing
    // the goods as something they are not.
    const hsn = checkHsn(hsnCode, { minDigits: await minHsnDigits() });
    if (!hsn.ok) return res.status(400).json({ message: hsn.reason });

    // The billing columns arrive with wholesale3_listing_billing_fields.sql.
    // Until it has been run a product can still be listed, it just carries no
    // unit or tax rate, which is what the older shape always did.
    const has = await invoiceRepository.schemaExtras();
    const billingColumns = has.has_listing_billing
      ? ", unit, pack_size, hsn_code, gst_percent, notes"
      : "";
    const billingValues = has.has_listing_billing ? ", $10, $11, $12, $13, $14" : "";
    const billingParams = has.has_listing_billing
      ? [
          clean(unit) || "pcs",
          optionalNumber(packSize),
          hsn.hsn,
          optionalNumber(gstPercent),
          clean(notes),
        ]
      : [];

    /**
     * The listing, and the stock it opens with.
     *
     * ONE TRANSACTION, because the opening figure is not decoration. If the
     * listing committed and the ledger row did not, the book would start life
     * short by however much he actually holds, with nothing on any screen
     * saying why.
     *
     * The quantity he types here means "this is what I have right now", so it
     * does two different things and they are deliberately not the same thing:
     *
     *   supplier_inventory.stock   what he OFFERS on the shop page
     *   an 'opening' ledger row    where his book stock starts counting
     *
     * Without the ledger row the Stock screen would show nothing until his
     * first sale, and then show a negative, because goods would be going out
     * of a book that never recorded them coming in.
     */
    const client = await pool.connect();
    let listingId;
    try {
      await client.query("BEGIN");
      const listing = await client.query(
        `INSERT INTO supplier_inventory
        (supplier_id, product_id, price, discount_price, moq, stock, shipping_days, image_url, status, visibility${billingColumns})
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Active', $9${billingValues})
        RETURNING id`,
        [
          supplierId,
          finalProductId,
          price,
          bulkPrice || null,
          moq,
          stock,
          shippingDays,
          imageUrl,
          normalizeVisibility(visibility),
          ...billingParams,
        ],
      );
      listingId = listing.rows[0].id;

      const opening = Number(stock) || 0;
      if (opening > 0) {
        await stockLedger.record(client, supplierId, {
          kind: "opening",
          documentId: listingId,
          documentNumber: null,
          direction: "in",
          note: "Opening stock, entered when the product was added",
          lines: [{
            itemName: clean(name) || "Product",
            productId: listingId,
            quantity: opening,
            unit: clean(unit) || null,
          }],
        });
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    res.status(201).json({ message: "Product listed successfully" });
  } catch (err) {
    console.error(err);
    if (err.constraint === "uq_supplier_product") {
      return res.status(400).json({
        message:
          "You are already selling this product. Please edit your existing listing.",
      });
    }
    res.status(500).json({ message: "Server error while adding product" });
  }
};

// @desc    Get all products for the Home Page (with bundled suppliers)
// @route   GET /api/products
exports.getPublicCatalog = async (req, res) => {
  try {
    const { citySql, cityKeySql } = await resolveCitySql(pool);
    // The filter sits in the WHERE, so it removes individual listings before
    // they are gathered up. That matters: filtering the product instead would
    // leave a Surat buyer looking at a product card whose suppliers, prices
    // and "3 sellers" count all came from Ludhiana.
    const city = cityFilterFrom(req.query);
    const cityClause = city ? `AND ${cityKeySql} = $1` : "";
    const params = city ? [city] : [];

    const query = `
      SELECT
        p.id,
        p.name,
        p.category,
        p.description,
        p.global_image_url as image,
        MIN(si.price) as starting_price,
        COUNT(si.id) as total_suppliers,
        json_agg(
          json_build_object(
            'id', si.id,
            'supplierId', si.supplier_id,
            'companyName', ${SELLER_NAME},
            'price', si.price,
            'discountPrice', si.discount_price,
            'verified', COALESCE(wp.is_verified, false),
            'moq', si.moq,
            'stock', si.stock,
            'city', ${citySql}
          )
        ) as suppliers
      FROM products p
      JOIN supplier_inventory si ON p.id = si.product_id
      ${SELLER_JOIN}
      WHERE si.status = 'Active' AND si.visibility = 'public'
        ${IN_STOCK}
        ${cityClause}
      GROUP BY p.id, p.name, p.category, p.description, p.global_image_url
      ORDER BY p.id DESC
    `;
    const result = await pool.query(query, params);
    res.status(200).json(result.rows);
  } catch (err) {
    console.error("Catalog query failed:", err);
    res.status(200).json([]);
  }
};

// @desc    The cities a buyer can actually filter to
// @route   GET /api/products/cities
//
// Built from the listings themselves rather than from a list of big Indian
// cities. A hardcoded list offers Bangalore to a buyer when no wholesaler
// there has ever listed anything, and they get an empty page with no way of
// telling whether they filtered wrongly or the shop is broken. Every city here
// has stock behind it, and the count says how much.
exports.getCatalogCities = async (req, res) => {
  try {
    const { citySql, cityKeySql } = await resolveCitySql(pool);
    const query = `
      SELECT
        ${cityKeySql} AS key,
        -- Sellers spell it differently. Show the commonest spelling rather
        -- than the folded one, so the menu reads "Surat", not "surat".
        mode() WITHIN GROUP (ORDER BY ${citySql}) AS city,
        COUNT(DISTINCT si.id)::int AS listings,
        COUNT(DISTINCT si.supplier_id)::int AS sellers
      FROM supplier_inventory si
      ${SELLER_JOIN}
      WHERE si.status = 'Active' AND si.visibility = 'public'
        ${IN_STOCK}
        AND ${citySql} IS NOT NULL
      GROUP BY ${cityKeySql}
      ORDER BY listings DESC, city ASC
    `;
    const result = await pool.query(query);
    res.status(200).json(result.rows);
  } catch (err) {
    console.error("Catalog city query failed:", err);
    res.status(200).json([]);
  }
};

// @desc    Get a single product and ALL its suppliers
// @route   GET /api/products/:id
exports.getProductById = async (req, res) => {
  const { id } = req.params;
  try {
    const { citySql } = await resolveCitySql(pool);
    const query = `
      SELECT 
        p.id, 
        p.name, 
        p.category, 
        p.description,
        p.global_image_url as image,
        json_agg(
          json_build_object(
            'id', si.id,
            'supplierId', si.supplier_id,
            'companyName', ${SELLER_NAME},
            'image', COALESCE(si.image_url, p.global_image_url),
            'price', si.price,
            'discountPrice', si.discount_price,
            'verified', COALESCE(wp.is_verified, false),
            'moq', si.moq,
            'stock', si.stock,
            'shippingDays', si.shipping_days,
            -- Where the goods actually sit, same rule the catalogue filters
            -- on. It used to read wp.city alone, so a seller whose warehouse
            -- was in Surat while they signed up from Mumbai was shown in the
            -- filter under Surat and on this page under Mumbai.
            'city', ${citySql},
            'country', wp.country,
            -- A buyer is being told something about a seller here, so it has
            -- to be true. It used to be "the box is not empty", which meant
            -- typing anything at all earned the badge. This is the number's
            -- own shape, which is the same rule the server now enforces when
            -- one is saved; it catches the rows written before it did.
            --
            -- It still is NOT verification against the GST portal. Nothing
            -- free will tell us that, so the screens say "GST registered",
            -- never "verified".
            'gstVerified',
              (wp.gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
            'contactPhone', COALESCE(wp.contact_phone, su.phone)
          )
        ) as suppliers
      FROM products p
      JOIN supplier_inventory si ON p.id = si.product_id
      ${SELLER_JOIN}
      WHERE p.id = $1 AND si.status = 'Active'
        ${IN_STOCK}
        AND si.visibility = 'public'
      GROUP BY p.id, p.name, p.category, p.description, p.global_image_url
    `;
    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Product not found" });
    }

    let reviewSummary = { rows: [{ average_rating: 0, total_reviews: 0 }] };
    try {
      reviewSummary = await pool.query(
        `SELECT COALESCE(AVG(rating), 0)::numeric(10,2) AS average_rating,
                COUNT(*) FILTER (WHERE status = 'active') AS total_reviews
         FROM product_reviews WHERE product_id = $1`,
        [id],
      );
    } catch (reviewErr) {
      console.warn('Review summary query failed:', reviewErr.message);
    }

    const product = result.rows[0];
    product.reviewSummary = reviewSummary.rows[0];

    // Per-supplier track record. These are counted from real orders and
    // reviews, so a new seller honestly shows zero instead of a stock figure.
    const supplierIds = [
      ...new Set((product.suppliers || []).map((s) => s.supplierId)),
    ].filter(Boolean);

    if (supplierIds.length > 0) {
      const statsById = new Map();

      const fulfilment = await pool.query(
        `SELECT COALESCE(o.supplier_id, si.supplier_id) AS supplier_id,
                COUNT(*) FILTER (WHERE o.status IN ('delivered', 'completed')) AS fulfilled_orders
         FROM orders o
         LEFT JOIN supplier_inventory si ON si.id = o.inventory_item_id
         WHERE COALESCE(o.supplier_id, si.supplier_id) = ANY($1::uuid[])
         GROUP BY 1`,
        [supplierIds],
      );
      fulfilment.rows.forEach((row) => {
        statsById.set(row.supplier_id, {
          fulfilledOrders: Number(row.fulfilled_orders) || 0,
        });
      });

      // Counts what a visitor would actually find on the storefront, so the
      // "view all N products" link never promises more than it shows.
      // Private listings are excluded for the same reason.
      const catalog = await pool.query(
        `SELECT supplier_id,
                COUNT(*) AS catalog_size,
                COUNT(*) FILTER (WHERE visibility = 'storefront') AS exclusive_count
         FROM supplier_inventory
         WHERE supplier_id = ANY($1::uuid[])
           AND status = 'Active'
           AND visibility IN ('public', 'storefront')
         GROUP BY supplier_id`,
        [supplierIds],
      );
      catalog.rows.forEach((row) => {
        const entry = statsById.get(row.supplier_id) || {};
        entry.catalogSize = Number(row.catalog_size) || 0;
        entry.exclusiveCount = Number(row.exclusive_count) || 0;
        statsById.set(row.supplier_id, entry);
      });

      try {
        const sellerRatings = await pool.query(
          `SELECT seller_id,
                  COALESCE(AVG(overall_experience), 0)::numeric(10,2) AS rating,
                  COUNT(*) FILTER (WHERE status = 'active') AS reviews
           FROM seller_reviews
           WHERE seller_id = ANY($1::uuid[])
           GROUP BY seller_id`,
          [supplierIds],
        );
        sellerRatings.rows.forEach((row) => {
          const entry = statsById.get(row.seller_id) || {};
          entry.rating = Number(row.rating) || 0;
          entry.reviews = Number(row.reviews) || 0;
          statsById.set(row.seller_id, entry);
        });
      } catch (ratingErr) {
        console.warn("Supplier rating query failed:", ratingErr.message);
      }

      product.suppliers = product.suppliers.map((supplier) => ({
        fulfilledOrders: 0,
        catalogSize: 0,
        exclusiveCount: 0,
        rating: 0,
        reviews: 0,
        ...supplier,
        ...(statsById.get(supplier.supplierId) || {}),
      }));
    }

    res.status(200).json(product);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error fetching product" });
  }
};

// @desc    One listing by its own id, whatever its visibility. This is the
//          link a wholesaler shares on WhatsApp for a private item: the id is
//          a random UUID, so the page is unlisted rather than secret, the same
//          way an unlisted video works. Nothing enumerates it, and it appears
//          in no catalogue, search result or storefront.
// @route   GET /api/products/listing/:inventoryId
exports.getListingById = async (req, res) => {
  const { inventoryId } = req.params;

  // A malformed id would otherwise reach Postgres and come back as a 500.
  if (!/^[0-9a-f-]{36}$/i.test(String(inventoryId))) {
    return res.status(404).json({ message: "Listing not found" });
  }

  try {
    const { citySql } = await resolveCitySql(pool);
    const result = await pool.query(
      `SELECT
         si.id            AS inventory_id,
         si.price,
         si.discount_price,
         si.moq,
         si.stock,
         si.shipping_days,
         si.visibility,
         si.status,
         p.id             AS product_id,
         p.name,
         p.category,
         p.description,
         COALESCE(si.image_url, p.global_image_url) AS image,
         u.id             AS supplier_id,
         COALESCE(wp.company_name, u.first_name || ' ' || u.last_name) AS company_name,
         ${citySql} AS city,
         wp.country,
         wp.is_verified,
         wp.contact_phone
       FROM supplier_inventory si
       JOIN products p ON p.id = si.product_id
       JOIN users u ON u.id = si.supplier_id
       LEFT JOIN wholesaler_profiles wp ON wp.user_id = si.supplier_id
       WHERE si.id = $1 AND si.status = 'Active'`,
      [inventoryId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Listing not found" });
    }

    const row = result.rows[0];
    return res.status(200).json({
      inventoryId: row.inventory_id,
      productId: row.product_id,
      name: row.name,
      category: row.category,
      description: row.description,
      image: row.image,
      price: Number(row.price) || 0,
      discountPrice: row.discount_price ? Number(row.discount_price) : null,
      moq: row.moq,
      stock: row.stock,
      shippingDays: row.shipping_days,
      visibility: row.visibility,
      // A private listing has no storefront to fall back to, so the page says
      // so rather than linking the buyer somewhere that will not show it.
      onStorefront: row.visibility !== "private",
      supplier: {
        id: row.supplier_id,
        companyName: row.company_name,
        city: row.city,
        country: row.country,
        verified: row.is_verified ?? false,
        contactPhone: row.contact_phone,
      },
    });
  } catch (err) {
    console.error("Error fetching listing:", err);
    res.status(500).json({ message: "Server error fetching listing" });
  }
};

// @desc    Public wholesaler profile with their active listings
// @route   GET /api/products/wholesaler/:id
exports.getWholesalerById = async (req, res) => {
  const { id } = req.params;
  try {
    const { citySql } = await resolveCitySql(pool);
    const profileResult = await pool.query(
      `SELECT
         u.id,
         u.first_name || ' ' || u.last_name AS contact_name,
         u.email,
         wp.company_name,
         ${citySql} AS city,
         wp.country,
         wp.is_verified,
         -- wholesaler_profiles.gst_verified is a boolean nothing has ever
         -- written, so it is false for everybody and this chip never showed,
         -- while the comparison screen showed it to anyone with a non empty
         -- box. Two screens, the same fact, wrong in opposite directions.
         -- Both now read the number's own shape.
         (wp.gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$') AS gst_verified,
         wp.years_in_business,
         wp.contact_phone,
         u.created_at AS member_since
       FROM users u
       LEFT JOIN wholesaler_profiles wp ON wp.user_id = u.id
       WHERE u.id = $1`,
      [id],
    );

    if (profileResult.rows.length === 0) {
      return res.status(404).json({ message: "Wholesaler not found" });
    }

    // The storefront is the one place a wholesaler's off-catalogue range is
    // shown. 'private' listings stay out of it: those are dashboard only.
    // Storefront items are listed first, because they are the reason to visit.
    const listingsResult = await pool.query(
      `SELECT
         si.id            AS inventory_id,
         si.price,
         si.discount_price,
         si.moq,
         si.stock,
         si.shipping_days,
         si.visibility,
         p.id             AS product_id,
         p.name,
         p.category,
         p.description,
         COALESCE(si.image_url, p.global_image_url) AS image
       FROM supplier_inventory si
       JOIN products p ON p.id = si.product_id
       WHERE si.supplier_id = $1
         AND si.status = 'Active'
         AND si.visibility IN ('public', 'storefront')
       ORDER BY (si.visibility = 'storefront') DESC, si.created_at DESC`,
      [id],
    );

    // Orders actually fulfilled: a fact, unlike the trust score it replaces.
    let fulfilledOrders = 0;
    try {
      const fulfilled = await pool.query(
        `SELECT COUNT(*)::int AS count
         FROM orders o
         LEFT JOIN supplier_inventory si ON si.id = o.inventory_item_id
         WHERE (o.supplier_id = $1 OR si.supplier_id = $1)
           AND o.status IN ('delivered', 'completed')`,
        [id],
      );
      fulfilledOrders = fulfilled.rows[0]?.count || 0;
    } catch (err) {
      console.warn("Fulfilled order count failed:", err.message);
    }

    // Seller rating is best-effort: the table may be empty on a new profile.
    let ratingRow = { average_rating: 0, total_reviews: 0 };
    try {
      const ratingResult = await pool.query(
        `SELECT COALESCE(AVG(overall_experience), 0)::numeric(10,2) AS average_rating,
                COUNT(*) FILTER (WHERE status = 'active')          AS total_reviews
         FROM seller_reviews WHERE seller_id = $1`,
        [id],
      );
      ratingRow = ratingResult.rows[0] || ratingRow;
    } catch (ratingErr) {
      console.warn("Seller rating query failed:", ratingErr.message);
    }

    const profile = profileResult.rows[0];
    return res.status(200).json({
      id: profile.id,
      companyName: profile.company_name || profile.contact_name,
      contactName: profile.contact_name,
      city: profile.city,
      country: profile.country,
      verified: profile.is_verified ?? false,
      gstVerified: profile.gst_verified ?? false,
      yearsInBusiness: profile.years_in_business,
      contactPhone: profile.contact_phone,
      memberSince: profile.member_since,
      rating: Number(ratingRow.average_rating) || 0,
      totalReviews: Number(ratingRow.total_reviews) || 0,
      productCount: listingsResult.rows.length,
      // How much of the range is only available here. The storefront uses it
      // to decide whether to show the "only here" section at all.
      exclusiveCount: listingsResult.rows.filter(
        (row) => row.visibility === "storefront",
      ).length,
      fulfilledOrders,
      products: listingsResult.rows.map((row) => ({
        id: row.product_id,
        inventoryId: row.inventory_id,
        name: row.name,
        category: row.category,
        description: row.description,
        image: row.image,
        price: Number(row.price) || 0,
        discountPrice: row.discount_price ? Number(row.discount_price) : null,
        moq: row.moq,
        stock: row.stock,
        shippingDays: row.shipping_days,
        visibility: row.visibility,
        // A storefront item has no comparison page to link to, because it is
        // deliberately absent from the shared catalogue.
        exclusive: row.visibility === "storefront",
      })),
    });
  } catch (err) {
    console.error("Error fetching wholesaler:", err);
    res.status(500).json({ message: "Server error fetching wholesaler" });
  }
};

/// @desc    Update a supplier's inventory listing (price, stock, MOQ, etc.)
// @route   PUT /api/products/inventory/:id
exports.updateInventoryItem = async (req, res) => {
  const { id } = req.params;
  const supplierId = businessId(req);
  const {
    price,
    bulkPrice,
    moq,
    stock,
    shippingDays,
    imageUrl,
    status,
    visibility,
    unit,
    packSize,
    hsnCode,
    gstPercent,
    notes,
  } = req.body;

  try {
    let nextVisibility;
    if (visibility !== undefined && visibility !== null && visibility !== "") {
      nextVisibility = normalizeVisibility(visibility, null);
      if (!nextVisibility) {
        return res.status(400).json({
          message: `Visibility must be one of: ${VISIBILITY_LEVELS.join(", ")}`,
        });
      }
    }

    // Same check as when a product is added, for the same reason.
    const hsn = checkHsn(hsnCode, { minDigits: await minHsnDigits() });
    if (!hsn.ok) return res.status(400).json({ message: hsn.reason });

    /**
     * Only the columns the caller actually sent are written.
     *
     * This used to COALESCE every column against itself, which kept a screen
     * that sends one field from blanking the rest, but it also meant null
     * read as "leave alone" and an emptied box could never clear anything: a
     * wholesaler could put an HSN code on a product and had no way to take a
     * wrong one off again.
     *
     * Absent from the body means leave alone. Present and null means clear.
     * The product screen sends one key when a rate is edited in place, and
     * the edit form sends the lot, and both come out right.
     */
    const sent = (key) => Object.prototype.hasOwnProperty.call(req.body, key);
    const sets = [];
    const params = [];
    const put = (column, value) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };

    if (sent("price")) put("price", price);
    if (sent("bulkPrice")) put("discount_price", bulkPrice);
    if (sent("moq")) put("moq", moq);
    if (sent("stock")) put("stock", stock);
    // Remembered so the ledger can be told by how much, below.
    const stockEdited = sent("stock");
    if (sent("shippingDays")) put("shipping_days", shippingDays);
    if (sent("imageUrl")) put("image_url", imageUrl);
    if (sent("status")) put("status", status);
    if (nextVisibility) put("visibility", nextVisibility);

    // See addProduct: these columns only exist once the migration has run.
    const has = await invoiceRepository.schemaExtras();
    if (has.has_listing_billing) {
      // Unit has no "none": a product is sold by something, so a blank here
      // is a caller not mentioning it rather than a wholesaler clearing it.
      if (sent("unit") && clean(unit)) put("unit", clean(unit));
      if (sent("packSize")) put("pack_size", optionalNumber(packSize));
      if (sent("hsnCode")) put("hsn_code", hsn.hsn);
      if (sent("gstPercent")) put("gst_percent", optionalNumber(gstPercent));
      if (sent("notes")) put("notes", clean(notes));
    }

    if (sets.length === 0) {
      return res.status(400).json({ message: "Nothing to update." });
    }

    params.push(id, supplierId);

    /**
     * ONE TRANSACTION, because editing the stock figure by hand is a stock
     * movement and the ledger has to hear about it.
     *
     * It did not before: the catalogue number changed and the register had no
     * record of who changed it or when, so the two numbers drifted apart with
     * nothing to explain the gap. A correction IS a real event, which is why
     * the ledger has an 'adjustment' kind, and writing the difference rather
     * than the new total keeps the register a list of movements rather than a
     * list of overwrites.
     */
    const client = await pool.connect();
    let result;
    try {
      await client.query("BEGIN");

      /**
       * The figure he types means "this is what I have NOW", so the
       * adjustment is whatever it takes to make the BOOK say that.
       *
       * Not the change to supplier_inventory.stock, which was the first
       * attempt and is wrong: that column is the shop offer and the two
       * numbers are deliberately allowed to differ, so a wholesaler
       * correcting a count to 400 would have got a book of 370 because the
       * offer happened to be 30 ahead. Counting the shelf and typing the
       * answer has to leave the book agreeing with the shelf.
       */
      const before = stockEdited
        ? (await client.query(
            `SELECT COALESCE(p.name, 'Product') AS name, si.unit,
                    COALESCE((SELECT SUM(l.quantity) FROM stock_ledger l
                               WHERE l.wholesaler_id = si.supplier_id
                                 AND l.product_id = si.id), 0) AS book
               FROM supplier_inventory si
               LEFT JOIN products p ON p.id = si.product_id
              WHERE si.id = $1 AND si.supplier_id = $2`,
            [id, supplierId])).rows[0]
        : null;

      result = await client.query(
        `UPDATE supplier_inventory
            SET ${sets.join(", ")}
          WHERE id = $${params.length - 1} AND supplier_id = $${params.length}
          RETURNING *`,
        params,
      );

      if (result.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({
          message: "Listing not found or you don't have permission to edit it",
        });
      }

      if (before) {
        const delta =
          Number(result.rows[0].stock || 0) - Number(before.book || 0);
        if (delta !== 0) {
          await stockLedger.record(client, supplierId, {
            kind: "adjustment",
            documentId: id,
            documentNumber: null,
            direction: delta > 0 ? "in" : "out",
            note: "Stock corrected by hand on the product",
            lines: [{
              itemName: before.name,
              productId: id,
              quantity: Math.abs(delta),
              unit: result.rows[0].unit || before.unit || null,
            }],
          });
        }
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    // Postgres CHECK constraint violation (e.g. discount_price > price, stock < 0, etc.)
    if (err.code === "23514") {
      return res.status(400).json({
        message:
          "Invalid values - check that bulk price isn't higher than base price, and stock/MOQ aren't negative.",
      });
    }
    res.status(500).json({ message: "Server error while updating product" });
  }
};

// @desc    Get a single inventory listing (to prefill the edit form)
// @route   GET /api/products/inventory/:id
exports.getInventoryItemById = async (req, res) => {
  const { id } = req.params;
  const supplierId = businessId(req);

  try {
    const result = await pool.query(
      `SELECT si.*, p.name, p.category, p.description, p.global_image_url
       FROM supplier_inventory si
       JOIN products p ON p.id = si.product_id
       WHERE si.id = $1 AND si.supplier_id = $2`,
      [id, supplierId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Listing not found" });
    }

    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error fetching listing" });
  }
};

// @desc    Delete (or soft-delete to Draft if active orders exist)
// @route   DELETE /api/products/inventory/:id
exports.deleteInventoryItem = async (req, res) => {
  const { id } = req.params;
  const supplierId = businessId(req);

  try {
    const listing = await pool.query(
      `SELECT id FROM supplier_inventory WHERE id = $1 AND supplier_id = $2`,
      [id, supplierId],
    );

    if (listing.rows.length === 0) {
      return res.status(404).json({
        message: "Listing not found or you don't have permission to delete it",
      });
    }

    /**
     * Two bugs lived in this query.
     *
     * The statuses are lowercase everywhere, and the CHECK constraint on
     * `orders` proves it, but this tested 'Delivered' and 'Cancelled'
     * capitalised. `'delivered' NOT IN ('Delivered','Cancelled')` is TRUE, so
     * every listing that had ever been delivered counted as having a live
     * order and could never be deleted.
     *
     * And it read `orders.inventory_item_id` only, which is the single item
     * leftover. An order placed through the cart keeps its contents in
     * `order_items`, so a listing with a genuinely live cart order was not
     * protected at all and got hard deleted. That is the trap CLAUDE.md warns
     * about, and it was here, failing in BOTH directions at once.
     */
    const activeOrders = await pool.query(
      `SELECT o.id FROM orders o
        WHERE LOWER(o.status) NOT IN ('delivered', 'cancelled', 'refunded')
          AND (o.inventory_item_id = $1
               OR EXISTS (SELECT 1 FROM order_items oi
                           WHERE oi.order_id = o.id
                             AND oi.inventory_item_id = $1))
        LIMIT 1`,
      [id],
    );

    if (activeOrders.rows.length > 0) {
      await pool.query(
        `UPDATE supplier_inventory SET status = 'Draft' WHERE id = $1`,
        [id],
      );
      return res.status(200).json({
        message:
          "Listing has active orders - marked as Draft instead of deleted",
        softDeleted: true,
      });
    }

    await pool.query(`DELETE FROM supplier_inventory WHERE id = $1`, [id]);
    res
      .status(200)
      .json({ message: "Listing deleted successfully", softDeleted: false });
  } catch (err) {
    console.error(err);
    if (err.code === "23503") {
      await pool.query(
        `UPDATE supplier_inventory SET status = 'Draft' WHERE id = $1`,
        [id],
      );
      return res.status(200).json({
        message:
          "Listing has order history - marked as Draft instead of deleted",
        softDeleted: true,
      });
    }
    res.status(500).json({ message: "Server error while deleting product" });
  }
};

// @desc    Get WhatsApp contact link for supplier
// @route   GET /api/products/:id/contact
exports.contactSupplier = async (req, res) => {
  const { id } = req.params;
  const { supplierId } = req.query;
  const buyer = req.user;

  console.log("Contact supplier request:", { productId: id, supplierId, buyerRole: buyer.role, buyerId: buyer.id });

  // Check if user is a buyer
  if (!["buyer", "both"].includes(buyer.role)) {
    console.log("Unauthorized contact attempt - user role:", buyer.role);
    return res.status(403).json({
      success: false,
      message: "Only buyers can contact suppliers"
    });
  }

  try {
    // Get product details with supplier information
    let query = `
      SELECT 
        p.id as product_id,
        p.name as product_name,
        si.supplier_id,
        wp.contact_phone,
        ${SELLER_NAME} AS company_name,
        su.phone as user_phone
      FROM products p
      JOIN supplier_inventory si ON p.id = si.product_id
      ${SELLER_JOIN}
      WHERE p.id = $1 AND si.status = 'Active' AND si.visibility <> 'private'
    `;

    let queryParams = [id];

    // If specific supplierId is provided, filter by it
    if (supplierId) {
      query += ` AND si.supplier_id = $2`;
      queryParams.push(supplierId);
    }

    console.log("Executing query with params:", queryParams);
    const result = await pool.query(query, queryParams);
    console.log("Query result rows:", result.rows.length);

    if (result.rows.length === 0) {
      console.log("No active suppliers found for product:", id);
      return res.status(404).json({
        success: false,
        message: "Product not found or no active suppliers"
      });
    }

    const productData = result.rows[0];
    console.log("Product data:", {
      productId: productData.product_id,
      productName: productData.product_name,
      supplierId: productData.supplier_id,
      contactPhone: productData.contact_phone,
      userPhone: productData.user_phone
    });

    // Check if supplier has contact phone
    const supplierPhone = productData.contact_phone || productData.user_phone;

    if (!supplierPhone) {
      console.log("No contact phone found for supplier:", productData.supplier_id);
      return res.status(404).json({
        success: false,
        message: "Supplier contact information not available"
      });
    }

    // Default message, used only when the client does not supply its own.
    const message =
      typeof req.query.message === "string" && req.query.message.trim()
        ? req.query.message.trim()
        : `Hello, I am interested in your ${productData.product_name} product. Please share more details.`;

    const normalizedPhone = String(supplierPhone).replace(/\D/g, "");
    const whatsappUrl = `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message)}`;

    console.log("WhatsApp URL generated successfully");
    return res.json({
      success: true,
      whatsappUrl,
      // Returned so the client can compose the buyer's chosen message itself
      phone: normalizedPhone,
      productName: productData.product_name,
      companyName: productData.company_name,
    });

  } catch (err) {
    console.error("Contact supplier error:", err);
    res.status(500).json({
      success: false,
      message: "Server error while generating contact link"
    });
  }
};
