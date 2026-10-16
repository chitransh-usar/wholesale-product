import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  UploadCloud,
  Save,
  Search,
  X,
  CheckCircle2,
  PackagePlus,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import HsnField from "../../components/HsnField";
import api from "../../utils/axios";
import VisibilityPicker from "../../components/VisibilityPicker";
import { useMasters } from "../../hooks/useMasters";

const AddProduct = () => {
  // Units and GST slabs from the platform administrations, falling back to the
  // built in lists so the dropdowns are never empty.
  const { units, taxRates } = useMasters();

  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [fullCatalog, setFullCatalog] = useState([]);

  const [formData, setFormData] = useState({
    name: "",
    category: "",
    description: "",
    price: "",
    moq: "",
    bulkPrice: "",
    stock: "",
    shippingDays: "",
    visibility: "public",
    // What a bill needs. Blank is allowed: a wholesaler who does not know a
    // product's HSN code yet should still be able to list it, and a guessed
    // code on a tax document is worse than none.
    unit: "pcs",
    packSize: "",
    hsnCode: "",
    gstPercent: "",
  });

  // 'undecided'
  // 'existing'
  // 'new'
  const [catalogChoice, setCatalogChoice] = useState("undecided");
  const [matches, setMatches] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);

  // --- Image state ---
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (e.target.name === "name" && catalogChoice !== "undecided") {
      setCatalogChoice("undecided");
      setSelectedProduct(null);
    }
  };

  useEffect(() => {
    const loadCatalog = async () => {
      try {
        const res = await api.get("/api/products");
        setFullCatalog(res.data);
      } catch (err) {
        console.error("Failed to load catalog for search", err);
      }
    };
    loadCatalog();
  }, []);

  useEffect(() => {
    if (catalogChoice !== "undecided") return;
    if (formData.name.trim().length < 3) {
      setMatches([]);
      return;
    }

    const timer = setTimeout(() => {
      const query = formData.name.trim().toLowerCase();
      // Filter against our live database state instead of mockProducts
      const found = fullCatalog
        .filter((p) => p.name.toLowerCase().includes(query))
        .slice(0, 4);

      setMatches(found);

      if (found.length === 0) {
        setCatalogChoice("new");
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [formData.name, catalogChoice, fullCatalog]);

  // Add this inside your AddProduct component:
  useEffect(() => {
    const checkProfileCompleteness = async () => {
      try {
        const res = await api.get("/api/profile");
        const profile = res.data;

        // The Mandatory Fields Guard check
        if (
          !profile.company_name ||
          !profile.contact_phone ||
          !profile.upi_id ||
          !profile.city
        ) {
          toast.error(
            "Profile Incomplete! You must add your Company Name, Phone, City, and UPI ID before listing products.",
            {
              duration: 5000,
            },
          );
          navigate("/seller/settings");
        }
      } catch (err) {
        console.error("Error checking profile:", err);
      }
    };

    checkProfileCompleteness();
  }, [navigate]);

  const handleSelectMatch = (product) => {
    setSelectedProduct(product);
    setCatalogChoice("existing");
    setMatches([]);
    setFormData((prev) => ({
      ...prev,
      name: product.name,
      category: product.category,
      description: product.description,
    }));
  };

  const handleConfirmNew = () => {
    setCatalogChoice("new");
    setMatches([]);
  };

  const handleResetChoice = () => {
    setCatalogChoice("undecided");
    setSelectedProduct(null);
  };

  // --- Image handling ---
  const handleImageSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image file");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be under 5MB");
      return;
    }

    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const handleRemoveImage = () => {
    setImageFile(null);
    setImagePreview(null);
  };

  const uploadImage = async () => {
    if (!imageFile) return null;
    setUploading(true);
    try {
      const data = new FormData();
      data.append("file", imageFile);
      data.append(
        "upload_preset",
        import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET,
      );

      const res = await fetch(
        `https://api.cloudinary.com/v1_1/${import.meta.env.VITE_CLOUDINARY_CLOUD_NAME}/image/upload`,
        { method: "POST", body: data },
      );

      if (!res.ok) throw new Error("Upload failed");
      const json = await res.json();
      return json.secure_url;
    } catch (err) {
      console.error(err);
      toast.error("Image upload failed - you can add one later");
      return null;
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (catalogChoice === "undecided" && formData.name.trim().length >= 3) {
      toast.error("Please confirm whether this matches an existing product");
      return;
    }

    setLoading(true);
    const imageUrl = await uploadImage();

    try {
      const payload = {
        productId:
          catalogChoice === "existing" && selectedProduct
            ? selectedProduct.id
            : null,
        name: formData.name,
        category: formData.category,
        description: formData.description,
        price: Number(formData.price),
        bulkPrice: formData.bulkPrice ? Number(formData.bulkPrice) : null,
        moq: Number(formData.moq),
        stock: Number(formData.stock),
        shippingDays: Number(formData.shippingDays),
        imageUrl: imageUrl,
        visibility: formData.visibility,
        unit: formData.unit,
        // Blank means "not given", which is a real answer and must not become
        // a zero on a bill.
        packSize: formData.packSize === "" ? null : Number(formData.packSize),
        hsnCode: formData.hsnCode.trim() || null,
        gstPercent:
          formData.gstPercent === "" ? null : Number(formData.gstPercent),
      };

      await api.post("/api/products", payload);

      toast.success(
        catalogChoice === "existing"
          ? "Listing added to existing product"
          : "Product added successfully",
      );
      navigate("/seller/products");
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || "Failed to add product");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => navigate("/seller/products")}
          className="p-2 text-slate-500 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h2 className="text-2xl font-black text-espresso">Add New Product</h2>
          <p className="text-sm text-slate-500 font-medium mt-1">
            List your inventory to the wholesale catalog.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Core Information */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800 mb-4">
            Core Information
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2 relative">
              <label className="block text-xs font-semibold text-slate-600 mb-2">
                Product Name
              </label>
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  name="name"
                  required
                  disabled={catalogChoice === "existing"}
                  value={formData.name}
                  onChange={handleChange}
                  className="w-full bg-slate-50 border border-slate-200 focus:border-clay focus:ring-1 focus:ring-clay outline-none rounded-lg pl-9 pr-4 py-2.5 text-sm text-slate-900 transition-colors disabled:bg-slate-100 disabled:text-slate-500"
                  placeholder="e.g. Premium Industrial Packaging Cartons"
                />
              </div>

              {/* Match suggestions - now includes an explicit escape hatch */}
              {catalogChoice === "undecided" && matches.length > 0 && (
                <div className="absolute z-10 mt-1.5 w-full bg-white border border-amber-200 rounded-lg shadow-lg p-2">
                  <p className="text-xs font-semibold text-amber-700 px-2 pb-2">
                    Found similar products - are you listing one of these?
                  </p>
                  {matches.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleSelectMatch(p)}
                      className="flex items-center gap-3 w-full p-2 hover:bg-slate-50 rounded-lg text-left transition-colors cursor-pointer"
                    >
                      <img
                        src={p.image}
                        alt={p.name}
                        className="w-9 h-9 rounded-md object-cover border border-slate-200 shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">
                          {p.name}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {p.category} ·{" "}
                          {p.total_suppliers || p.suppliers?.length || 0}{" "}
                          suppliers
                        </p>
                      </div>
                    </button>
                  ))}
                  <div className="border-t border-slate-100 mt-1 pt-1">
                    <button
                      type="button"
                      onClick={handleConfirmNew}
                      className="flex items-center gap-2 w-full p-2 hover:bg-slate-50 rounded-lg text-left transition-colors cursor-pointer"
                    >
                      <X className="w-4 h-4 text-slate-400 shrink-0" />
                      <span className="text-sm font-semibold text-slate-600">
                        None of these - list as a new product
                      </span>
                    </button>
                  </div>
                </div>
              )}

              {/* Linked-to-existing-product banner */}
              {catalogChoice === "existing" && selectedProduct && (
                <div className="mt-2 flex items-center justify-between gap-3 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <img
                      src={selectedProduct.image}
                      alt={selectedProduct.name}
                      className="w-8 h-8 rounded-md object-cover border border-emerald-200 shrink-0"
                    />
                    <p className="text-xs text-emerald-800 font-medium truncate">
                      Adding your listing to{" "}
                      <span className="font-bold">{selectedProduct.name}</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleResetChoice}
                    className="flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-900 shrink-0 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                    Not this
                  </button>
                </div>
              )}

              {/* Confirmed-new banner - so they can still change their mind */}
              {catalogChoice === "new" && (
                <div className="mt-2 flex items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-lg p-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <PackagePlus className="w-4 h-4 text-slate-500 shrink-0" />
                    <p className="text-xs text-slate-600 font-medium">
                      Listing this as a brand new product
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleResetChoice}
                    className="flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900 shrink-0 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Search again
                  </button>
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-2">
                Category
              </label>
              <select
                name="category"
                required
                disabled={catalogChoice === "existing"}
                value={formData.category}
                onChange={handleChange}
                className="w-full bg-slate-50 border border-slate-200 focus:border-clay focus:ring-1 focus:ring-clay outline-none rounded-lg px-4 py-2.5 text-sm text-slate-900 transition-colors cursor-pointer disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed"
              >
                <option value="">Select a category</option>
                <option value="Packaging">Packaging</option>
                <option value="Raw Materials">Raw Materials</option>
                <option value="Hardware">Hardware</option>
                <option value="Electronics">Electronics</option>
                <option value="Textiles">Textiles</option>
                <option value="Chemicals">Chemicals</option>
              </select>
              {catalogChoice === "existing" && (
                <p className="text-[11px] text-slate-400 mt-1.5">
                  Inherited from the existing catalog entry
                </p>
              )}
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-slate-600 mb-2">
                Description & Specifications
              </label>
              <textarea
                name="description"
                rows={4}
                disabled={catalogChoice === "existing"}
                value={formData.description}
                onChange={handleChange}
                className="w-full bg-slate-50 border border-slate-200 focus:border-clay focus:ring-1 focus:ring-clay outline-none rounded-lg px-4 py-2.5 text-sm text-slate-900 transition-colors resize-none disabled:bg-slate-100 disabled:text-slate-500"
                placeholder="List material, dimensions, grade, etc."
              />
              {catalogChoice === "existing" && (
                <p className="text-[11px] text-slate-400 mt-1.5">
                  Inherited from the existing catalog entry
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Product Photo */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800 mb-1">
            {catalogChoice === "existing"
              ? "Your Listing Photo"
              : "Product Photo"}
          </h3>
          <p className="text-xs text-slate-500 mb-4">
            {catalogChoice === "existing"
              ? "A real photo of your own stock. Buyers see this when they pick you as the supplier."
              : "This becomes the main image shown across the marketplace for this product."}
          </p>

          {imagePreview ? (
            <div className="relative w-40 h-40">
              <img
                src={imagePreview}
                alt="Preview"
                className="w-full h-full object-cover rounded-xl border border-slate-200"
              />
              <button
                type="button"
                onClick={handleRemoveImage}
                className="absolute -top-2 -right-2 bg-white border border-slate-200 rounded-full p-1 shadow-sm hover:bg-rose-50 hover:border-rose-200 hover:text-rose-500 transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <label
              htmlFor="product-image"
              className="flex flex-col items-center justify-center border-2 border-dashed border-slate-300 rounded-xl p-8 cursor-pointer hover:border-clay hover:bg-clay/5 transition-colors w-full sm:w-72"
            >
              <UploadCloud className="w-7 h-7 text-slate-400 mb-2" />
              <span className="text-sm font-medium text-slate-600">
                Click to upload
              </span>
              <span className="text-[11px] text-slate-400 mt-1">
                JPG or PNG, up to 5MB
              </span>
              <input
                id="product-image"
                type="file"
                accept="image/*"
                onChange={handleImageSelect}
                className="hidden"
              />
            </label>
          )}
        </div>

        {/* Rate and minimum */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800 mb-4">
            Your rate
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-2">
                Rate (₹ per {formData.unit || "unit"})
              </label>
              <input
                type="number"
                name="price"
                step="any"
                required
                min="1"
                value={formData.price}
                onChange={handleChange}
                className="w-full bg-slate-50 border border-slate-200 focus:border-clay focus:ring-1 focus:ring-clay outline-none rounded-lg px-4 py-2.5 text-sm text-slate-900 transition-colors"
                placeholder="142"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-2">
                Smallest quantity you will sell
              </label>
              <input
                type="number"
                name="moq"
                step="any"
                required
                min="1"
                value={formData.moq}
                onChange={handleChange}
                className="w-full bg-slate-50 border border-slate-200 focus:border-clay focus:ring-1 focus:ring-clay outline-none rounded-lg px-4 py-2.5 text-sm text-slate-900 transition-colors"
                placeholder="10"
              />
            </div>
            {/* HOW MUCH HE HAS. There was no box for this at all: formData
                carried a `stock` key, the form never asked for it, and the
                server was sent Number("") which is zero. Every product ever
                added through this screen was created with no stock.

                It does two things, which are deliberately not the same thing.
                It sets what the shop page OFFERS, and it opens his book stock
                with an opening row in the stock ledger. Without the second,
                the Stock screen would show nothing until his first sale and
                then show a negative, because goods would be leaving a book
                that never recorded them arriving. */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-2">
                How much do you have now
              </label>
              <input
                type="number"
                name="stock"
                step="any"
                min="0"
                value={formData.stock}
                onChange={handleChange}
                className="w-full bg-slate-50 border border-slate-200 focus:border-clay focus:ring-1 focus:ring-clay outline-none rounded-lg px-4 py-2.5 text-sm text-slate-900 transition-colors"
                placeholder="0"
              />
              <p className="mt-2 text-xs text-slate-500">
                Your opening stock. It starts your stock book and is what
                buyers can order. Leave it empty if you are not counting stock.
              </p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-clay mb-2">
                Bulk rate (₹ per {formData.unit || "unit"}), optional
              </label>
              <input
                type="number"
                name="bulkPrice"
                step="any"
                min="1"
                value={formData.bulkPrice}
                onChange={handleChange}
                className="w-full bg-clay/5 border border-clay/20 focus:border-clay focus:ring-1 focus:ring-clay outline-none rounded-lg px-4 py-2.5 text-sm text-slate-900 transition-colors"
                placeholder="138"
              />
              {/* There used to be a separate "bulk quantity trigger" box here.
                  Nothing read it: the server charges the bulk rate once the
                  order reaches the minimum above, so the box was a number the
                  wholesaler typed and the system threw away. */}
              <p className="mt-2 text-xs text-slate-500">
                Charged automatically once someone orders{" "}
                {formData.moq ? `${formData.moq} ` : "the minimum "}
                {formData.moq ? `${formData.unit || ""} ` : ""}
                or more.
              </p>
            </div>
          </div>
        </div>

        {/* What a bill needs */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800 mb-1">
            For your bills
          </h3>
          <p className="mb-4 text-xs text-slate-500">
            Used when you make a bill for this product. You can leave the HSN
            code and GST blank and add them later.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-2">
                Sold by
              </label>
              <select
                name="unit"
                value={formData.unit}
                onChange={handleChange}
                className="w-full bg-slate-50 border border-slate-200 focus:border-clay focus:ring-1 focus:ring-clay outline-none rounded-lg px-4 py-2.5 text-sm text-slate-900 transition-colors"
              >
                {units.map((u) => (
                  <option key={u.code} value={u.code}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-2">
                How many in one pack, optional
              </label>
              <input
                type="number"
                name="packSize"
                min="0"
                step="any"
                value={formData.packSize}
                onChange={handleChange}
                className="w-full bg-slate-50 border border-slate-200 focus:border-clay focus:ring-1 focus:ring-clay outline-none rounded-lg px-4 py-2.5 text-sm text-slate-900 transition-colors"
                placeholder="100"
              />
            </div>
            <HsnField
              id="add-hsn"
              label="HSN code, optional"
              value={formData.hsnCode}
              onChange={(hsnCode) =>
                setFormData((prev) => ({ ...prev, hsnCode }))
              }
            />
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-2">
                GST rate, optional
              </label>
              <select
                name="gstPercent"
                value={formData.gstPercent}
                onChange={handleChange}
                className="w-full bg-slate-50 border border-slate-200 focus:border-clay focus:ring-1 focus:ring-clay outline-none rounded-lg px-4 py-2.5 text-sm text-slate-900 transition-colors"
              >
                <option value="">Use my usual rate</option>
                {taxRates.map((slab) => (
                  <option key={slab.rate} value={slab.rate}>
                    {slab.rate}%
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Where it appears */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800 mb-1">
            Where This Listing Appears
          </h3>
          <p className="text-xs text-slate-500 mb-4">
            You can change this at any time from My Products.
          </p>
          <VisibilityPicker
            value={formData.visibility}
            onChange={(visibility) =>
              setFormData((prev) => ({ ...prev, visibility }))
            }
          />
        </div>

        {/* Logistics & Fulfillment */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800 mb-4">
            Logistics & Fulfillment
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-2">
                Estimated Shipping (Days)
              </label>
              <input
                type="number"
                name="shippingDays"
                required
                min="1"
                value={formData.shippingDays}
                onChange={handleChange}
                className="w-full bg-slate-50 border border-slate-200 focus:border-clay focus:ring-1 focus:ring-clay outline-none rounded-lg px-4 py-2.5 text-sm text-slate-900 transition-colors"
                placeholder="5"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-4">
          <button
            type="button"
            onClick={() => navigate("/seller/products")}
            className="px-6 py-2.5 rounded-lg text-sm font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading || uploading}
            className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-bold text-white bg-clay hover:bg-espresso transition-colors shadow-sm disabled:opacity-70 disabled:cursor-not-allowed cursor-pointer"
          >
            {catalogChoice === "existing" ? (
              <PackagePlus className="w-4 h-4" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {uploading
              ? "Uploading image..."
              : loading
                ? "Saving..."
                : catalogChoice === "existing"
                  ? "Add My Listing"
                  : "Publish Product"}
          </button>
        </div>
      </form>
    </div>
  );
};

export default AddProduct;
