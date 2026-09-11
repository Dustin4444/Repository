'use strict';

/**
 * Jest manual mock for the `rust-gbt` native module.
 *
 * Strategy:
 *  - In CI (after `npm ci` which runs the Rust preinstall build) the real
 *    compiled module is present in backend/rust-gbt/.  We load it directly so
 *    GBT tests continue to exercise the genuine Rust implementation.
 *  - In local dev environments where Rust has not been compiled, the require
 *    call throws and we fall back to a minimal stub.  This stub lets every
 *    other test suite run without needing a compiled Rust binary.  The
 *    GBT-specific test suite will fail with an assertion error (expected vs
 *    actual output) rather than a fatal module-not-found crash.
 */
const path = require('path');
const fs = require('fs');

// The preinstall script copies the compiled binary here: backend/rust-gbt/
const compiledIndexPath = path.resolve(__dirname, '../rust-gbt/index.js');

if (fs.existsSync(compiledIndexPath)) {
  // Real compiled module available – use it so GBT tests run correctly.
  module.exports = require(compiledIndexPath);
} else {
  // Fallback stub for environments without a compiled Rust binary.
  class GbtGenerator {
    constructor(_maxBlockWeight, _maxBlocks) {}

    async make(_mempool, _accelerations, _maxUid) {
      return { blocks: [], blockWeights: [], clusters: [], rates: [], overflow: [] };
    }

    async update(_newTxs, _removeTxs, _accelerations, _maxUid) {
      return { blocks: [], blockWeights: [], clusters: [], rates: [], overflow: [] };
    }
  }

  module.exports = {
    GbtGenerator,
    GbtResult: {},
    ThreadTransaction: {},
    ThreadAcceleration: {},
  };
}
