import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@engine": resolve(__dirname, "src/engine"),
      "@grid": resolve(__dirname, "src/grid"),
      "@rules": resolve(__dirname, "src/rules"),
      "@effects": resolve(__dirname, "src/effects"),
      "@io": resolve(__dirname, "src/io"),
      "@rendering": resolve(__dirname, "src/rendering"),
      "@store": resolve(__dirname, "src/store"),
      "@ui": resolve(__dirname, "src/ui"),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
