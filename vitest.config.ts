import { defineConfig } from "vite-plus";

// Unit tests run in Node, without the Cloudflare and app plugins that vite.config.ts loads.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
