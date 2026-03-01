export interface ThreadTransaction {
  uid: number;
  order: number;
  fee: number;
  weight: number;
  sigops: number;
  effectiveFeePerVsize: number;
  inputs: number[];
}

export interface ThreadAcceleration {
  uid: number;
  delta: number;
}

export interface GbtResult {
  blocks: number[][];
  blockWeights: number[];
  rates: [number, number][];
  clusters: number[][];
  overflow: number[];
}

export declare class GbtGenerator {
  constructor(blockWeightUnits: number, blocksAmount: number);
  make(
    mempool: ThreadTransaction[],
    accelerations: ThreadAcceleration[],
    maxUid: number,
  ): Promise<GbtResult>;
  update(
    newTransactions: ThreadTransaction[],
    removedTransactionUids: number[],
    accelerations: ThreadAcceleration[],
    maxUid: number,
  ): Promise<GbtResult>;
}
