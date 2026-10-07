import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Cold starts (module load + scrypt) take a few seconds on slower machines.
    testTimeout: 20_000,
  },
});
