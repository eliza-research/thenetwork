import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * The client of the four public sites. Every file goes to the root of the build, never inlined, so that the
 * content security policy of the sites (`default-src 'self'`, no `data:` font) holds. sites/sites.ts builds it
 * and prerenders each page.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { assetsDir: "", assetsInlineLimit: 0, modulePreload: { polyfill: false } },
});
