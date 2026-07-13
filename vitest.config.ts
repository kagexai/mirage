import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Alias "@/..." to the project root so tests resolve the same paths the
// extension bundle does. import.meta.glob + ?raw (used by the plugin registry)
// work because Vitest runs through Vite.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
