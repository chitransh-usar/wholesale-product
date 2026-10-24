import { defineConfig, loadEnv } from "vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { dirname } from "node:path";
import { env as processEnv } from "node:process";
import { fileURLToPath } from "node:url";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  if (mode === "production") {
    const envDirectory = dirname(fileURLToPath(import.meta.url));
    const env = loadEnv(mode, envDirectory, "VITE_");
    const apiBaseUrl =
      processEnv.VITE_API_BASE_URL || env.VITE_API_BASE_URL;

    let parsedApiUrl;
    try {
      parsedApiUrl = new URL(apiBaseUrl);
    } catch {
      throw new Error(
        "Production builds require VITE_API_BASE_URL to be an HTTPS backend origin.",
      );
    }

    const hostname = parsedApiUrl.hostname
      .toLowerCase()
      .replace(/^\[|\]$/g, "");
    const isLoopback =
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.startsWith("127.") ||
      hostname === "::1" ||
      hostname === "0.0.0.0";
    if (
      parsedApiUrl.protocol !== "https:" ||
      parsedApiUrl.origin !== apiBaseUrl.replace(/\/$/, "") ||
      isLoopback ||
      parsedApiUrl.username ||
      parsedApiUrl.password
    ) {
      throw new Error(
        "Production VITE_API_BASE_URL must be an HTTPS backend origin without credentials or a path.",
      );
    }
  }

  return {
    plugins: [
      react(),
      babel({ presets: [reactCompilerPreset()] }),
      tailwindcss(),
    ],
    optimizeDeps: {
      // Pre-bundle every bare import the app actually uses (including subpaths
      // like `gsap/all`, which the scanner would otherwise only discover once a
      // lazy route loads). Declaring them up front means the dep cache is written
      // once at startup instead of being rewritten mid-session, which is when
      // "file does not exist in the optimize deps directory" errors show up.
      include: [
        "axios",
        "gsap",
        "gsap/all",
        "lucide-react",
        // Loaded only inside the order pages, so the scanner would otherwise
        // discover it mid-session and rewrite the dep cache while serving.
        "maplibre-gl",
        "prop-types",
        "qrcode.react",
        "react",
        "react-dom",
        "react-dom/client",
        "react-router",
        "react-router-dom",
        "socket.io-client",
        "sonner",
      ],
    },
  };
});
