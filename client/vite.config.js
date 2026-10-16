import { defineConfig } from "vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
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
});
