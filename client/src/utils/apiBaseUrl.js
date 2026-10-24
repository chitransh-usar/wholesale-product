const apiBaseUrl =
  import.meta.env.VITE_API_BASE_URL?.trim() ||
  (import.meta.env.DEV ? "http://localhost:5000" : "");

if (!apiBaseUrl) {
  throw new Error("VITE_API_BASE_URL must be configured for production.");
}

export default apiBaseUrl;
