import type { Config } from '@jest/types';

const config: Config.InitialOptions = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  verbose: true,
  automock: false,
  collectCoverage: true,
  collectCoverageFrom: ['./src/**/**.ts'],
  coverageProvider: 'v8',
  coverageThreshold: {
    global: {
      lines: 1
    }
  },
  setupFiles: [
    './testSetup.ts',
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/__integration_tests__/',
  ],
  // Disable ts-jest type diagnostics so that missing native modules (e.g. rust-gbt
  // before the Rust build step) don't cause unrelated test suites to fail.
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { diagnostics: false }],
  },
  // Map the native rust-gbt package to a lightweight JS mock.
  // When the real package IS present (CI after `npm ci` which compiles Rust), the
  // mock transparently delegates to the real module so GBT tests still work.
  moduleNameMapper: {
    '^rust-gbt$': '<rootDir>/__mocks__/rust-gbt.js',
  },
};
export default config;
