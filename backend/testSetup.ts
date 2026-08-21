jest.mock('./mempool-config.json', () => ({}), { virtual: true });
jest.mock('./src/logger.ts', () => ({
  emerg: jest.fn(),
  alert: jest.fn(),
  crit: jest.fn(),
  err: jest.fn(),
  warn: jest.fn(),
  notice: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  updateNetwork: jest.fn(),
  tags: {
    mining: 'mining',
    ln: 'ln',
    goggles: 'goggles',
  },
}), { virtual: true });
jest.mock('./src/api/rbf-cache.ts', () => ({}), { virtual: true });
jest.mock('./src/api/mempool.ts', () => ({}), { virtual: true });
jest.mock('./src/api/memory-cache.ts', () => ({}), { virtual: true });
// Prevent tests that transitively import mempool-blocks from trying to load
// the rust-gbt native module at runtime.  The moduleNameMapper in jest.config.ts
// already handles direct imports of rust-gbt; this mock stops the entire
// mempool-blocks module tree from being evaluated in unrelated test suites.
jest.mock('./src/api/mempool-blocks.ts', () => ({
  getMempoolBlocks: jest.fn(() => []),
  getMempoolBlocksWithTransactions: jest.fn(() => []),
  getMempoolBlockDeltas: jest.fn(() => []),
  getBlocks: jest.fn(() => []),
  updateMempoolBlockTimestamps: jest.fn(),
}), { virtual: true });
