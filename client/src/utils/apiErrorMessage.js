export const apiErrorMessage = (error, fallback) => {
  if (!error.response) {
    return error.code === "ECONNABORTED" || error.code === "ETIMEDOUT"
      ? "The request took too long. Please try again."
      : "Could not reach the server. Check your connection and try again.";
  }

  if (error.response.status === 503) {
    return "The service is temporarily unavailable. Please try again shortly.";
  }
  if (error.response.status >= 500) {
    return "Something went wrong on our side. Please try again.";
  }

  return error.response.data?.message || fallback;
};
