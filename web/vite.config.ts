import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { assetsInlineLimit: 4_000_000, rollupOptions: { output: { inlineDynamicImports: true } } },
  base: './',
  test: { environment: 'node', include: ['src/**/*.test.ts'], setupFiles: ['./src/test-setup.ts'] },
});
