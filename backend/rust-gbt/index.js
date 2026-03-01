'use strict';

/**
 * Mock implementation of the rust-gbt native module.
 * Used when the native binary has not been compiled (e.g. in CI unit-test runs).
 */

class GbtGenerator {
  constructor(_blockWeightUnits, _blocksAmount) {}

  async make(_mempool, _accelerations, _maxUid) {
    return { blocks: [], blockWeights: [], rates: [], clusters: [], overflow: [] };
  }

  async update(_newTransactions, _removedUids, _accelerations, _maxUid) {
    return { blocks: [], blockWeights: [], rates: [], clusters: [], overflow: [] };
  }
}

module.exports = { GbtGenerator };
