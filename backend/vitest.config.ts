import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    include: ['src/__vitest__/**/*.vitest.ts'],
    environment: 'node',
    env: {
      MEMPOOL_CONFIG_FILE: path.resolve(__dirname, 'mempool-config.test.json'),
    },
  },
});
