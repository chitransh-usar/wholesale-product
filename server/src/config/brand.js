/**
 * The product's name, on the server side.
 *
 * Mirrors client/src/config/brand.js. Two copies rather than a shared package,
 * because the client and the server are separate npm projects here and one
 * constant is not worth a build step, but they must say the same thing.
 *
 * Used for what goes out under the platform's own name: email headers, the
 * welcome notification, and the fallback on a document when a wholesaler has
 * not filled in their own company name.
 *
 * "Marketplace" as an ordinary noun, meaning the browsing and ordering half of
 * the product, is not the brand and is left alone.
 */
const BRAND = {
  name: "KhazanaBMS",
  /** One line, for an email header. */
  tagline: "Wholesale billing and khata for Indian trade",
};

module.exports = { BRAND };
