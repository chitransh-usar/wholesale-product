import axios from "axios";
import apiBaseUrl from "./apiBaseUrl";

const api = axios.create({
  baseURL: apiBaseUrl,
  timeout: 10000,
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
});

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Only 401 means the session is gone. A 403 is a live session being told
    // "not yours" - dropping the token there logged people out whenever any
    // page happened to call an endpoint their role does not cover, and every
    // request after that failed until they reloaded.
    if (error.response?.status === 401) {
      localStorage.removeItem("token");
    }
    return Promise.reject(error);
  },
);

export default api;
