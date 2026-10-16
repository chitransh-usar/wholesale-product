import api from "./axios";

/**
 * Pulls a file through the authenticated axios instance and saves it.
 *
 * window.open on an /api path cannot work here: it resolves against the site
 * origin rather than the API base URL, and it carries no Authorization header,
 * so every export it opened came back as a 404 page or a 401.
 */
export const downloadFile = async (url, filename, { params, timeout } = {}) => {
  try {
    // A timeout is worth overriding for anything the server has to build
    // rather than read. The instance default is ten seconds, which is right
    // for a page of rows and far too short for a whole book with its bills
    // rendered one by one.
    const response = await api.get(url, {
      params,
      responseType: "blob",
      ...(timeout ? { timeout } : {}),
    });
    if (!response?.data) {
      throw new Error("No data received for file download");
    }

    const objectUrl = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement("a");
    link.href = objectUrl;
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(objectUrl);
  } catch (error) {
    let message = error.message;
    if (error.response?.data instanceof Blob) {
      try {
        const text = await error.response.data.text();
        const json = JSON.parse(text);
        if (json.message) message = json.message;
      } catch {
        // keep fallback message
      }
    }
    console.error(`Failed to download file [${filename}]:`, message || error);
    const err = new Error(message || "Failed to download file");
    err.originalError = error;
    throw err;
  }
};
