import preact from '@preact/preset-vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/flight-13/',
  plugins: [preact()],
  build: { target: 'es2022', sourcemap: true },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
