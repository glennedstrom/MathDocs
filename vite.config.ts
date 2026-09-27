import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const commit = env.VERCEL_GIT_COMMIT_SHA || env.GITHUB_SHA || "local";
  const branch = env.VERCEL_GIT_COMMIT_REF || env.GITHUB_REF_NAME || "local";

  return {
    publicDir: "market/static",
    define: {
      __BUILD_COMMIT__: JSON.stringify(commit),
      __BUILD_BRANCH__: JSON.stringify(branch),
      __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    },
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
  };
});
