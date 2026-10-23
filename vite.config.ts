import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Custom worker: precache plus entry-only navigation, with no SKIP_WAITING handler.
      strategies: "injectManifest",
      srcDir: "service-worker",
      filename: "sw.ts",
      // The app registers the worker itself and never reloads for an update.
      injectRegister: false,
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Ko Ho? — Someone's bluffing.",
        short_name: "Ko Ho?",
        description:
          "One phone. Your people. One imposter. A bilingual Nepali-American party game made for your next get-together.",
        lang: "en",
        display: "standalone",
        background_color: "#f6f3eb",
        theme_color: "#f6f3eb",
        categories: ["games", "entertainment"],
        // Relative to the manifest URL, so they follow the resolved base.
        icons: [
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "pwa-maskable-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          { src: "favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
        ],
      },
      injectManifest: {
        rollupFormat: "iife",
        globPatterns: ["**/*.{js,css,html,woff2}"],
      },
      integration: {
        // Runs after Vite resolves `base` (including CLI --base), before the
        // plugin derives start_url/scope from it, so identity matches the deploy path.
        configureOptions(config, options) {
          if (!config.base.startsWith("/")) {
            throw new Error(`The PWA needs an absolute base path such as "/" or "/imposter/"; got "${config.base}".`);
          }
          if (options.manifest) options.manifest.id = config.base;
        },
      },
    }),
  ],
});
