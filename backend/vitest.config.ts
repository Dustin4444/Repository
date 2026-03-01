import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.vitest.ts'],
    globals: false,
    pool: 'forks',
  },
});
