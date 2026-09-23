import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/flight-13/',
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
