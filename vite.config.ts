import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  base: "./",
  publicDir: "static/assets",
  build: {
    outDir: "static/app",
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "react",
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
            },
            {
              name: "temporal",
              test: /node_modules[\\/](@js-temporal|jsbi)[\\/]/,
            },
            { name: "validation", test: /node_modules[\\/]zod[\\/]/ },
          ],
        },
      },
    },
  },
  server: { port: 4185, strictPort: true },
  preview: { port: 4185, strictPort: true },
});
