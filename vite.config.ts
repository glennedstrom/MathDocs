import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  publicDir: "market/static",
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.png"],
      manifest: {
        name: "MathDocs",
        short_name: "MathDocs",
        description: "An offline-first mathematical workpad with step checking.",
        theme_color: "#18232c",
        background_color: "#151d24",
        display: "standalone",
        start_url: ".",
        icons: [
          {
            src: "favicon.png",
            sizes: "500x500",
            type: "image/png",
            purpose: "any"
          }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,woff,woff2}"],
        navigateFallback: "index.html",
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024
      }
    })
  ],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"]
  }
});
