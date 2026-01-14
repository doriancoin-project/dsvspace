import config from '../config';
import { IDifficultyAdjustment } from '../mempool.interfaces';
import blocks from './blocks';

export interface DifficultyAdjustment {
  progressPercent: number;       // For LWMA: always 100 (adjusts every block)
  difficultyChange: number;      // Percent change from previous adjustment
  estimatedRetargetDate: number; // For LWMA: next block time estimate
  remainingBlocks: number;       // For LWMA: always 1
  remainingTime: number;         // Time until next block (based on avg)
  previousRetarget: number;      // Previous difficulty change percent
  previousTime: number;          // Unix time in ms
  nextRetargetHeight: number;    // For LWMA: current height + 1
  timeAvg: number;               // Average block time in ms
  timeOffset: number;            // (Testnet) Time since last block
  expectedBlocks: number;        // Expected blocks in period
}

// Doriancoin uses LWMA (Linearly Weighted Moving Average) difficulty adjustment
// which adjusts difficulty every block based on a 45-block window.
// This simplified implementation returns basic difficulty info without
// epoch-based progress calculations.
export function calcDifficultyAdjustment(
  DATime: number,
  nowSeconds: number,
  blockHeight: number,
  previousRetarget: number,
  network: string,
  latestBlockTimestamp: number,
): DifficultyAdjustment {
  const BLOCK_SECONDS_TARGET = 150; // Doriancoin target: 2.5 minutes (150 seconds)
  const TESTNET_MAX_BLOCK_SECONDS = 1200;

  // For LWMA: difficulty adjusts every block, so there's no "epoch"
  // We calculate average block time from recent blocks instead
  const blocksCache = blocks.getBlocks();
  let timeAvgSecs = BLOCK_SECONDS_TARGET;

  // Calculate average block time from cached blocks (up to 45 blocks for LWMA window)
  if (blocksCache.length >= 2) {
    const windowSize = Math.min(blocksCache.length - 1, 45); // LWMA window is 45 blocks
    const recentBlocks = blocksCache.slice(-windowSize - 1);
    if (recentBlocks.length >= 2) {
      const firstBlock = recentBlocks[0];
      const lastBlock = recentBlocks[recentBlocks.length - 1];
      const timeDiff = lastBlock.timestamp - firstBlock.timestamp;
      const blockCount = recentBlocks.length - 1;
      if (blockCount > 0 && timeDiff > 0) {
        timeAvgSecs = timeDiff / blockCount;
      }
    }
  }

  // Testnet handling
  let timeOffset = 0;
  if (network === 'testnet') {
    if (timeAvgSecs > TESTNET_MAX_BLOCK_SECONDS) {
      timeAvgSecs = TESTNET_MAX_BLOCK_SECONDS;
    }
    const secondsSinceLastBlock = nowSeconds - latestBlockTimestamp;
    if (secondsSinceLastBlock + timeAvgSecs > TESTNET_MAX_BLOCK_SECONDS) {
      timeOffset = -Math.min(secondsSinceLastBlock, TESTNET_MAX_BLOCK_SECONDS) * 1000;
    }
  }

  const timeAvg = Math.floor(timeAvgSecs * 1000);

  // For LWMA: always show 100% progress since adjustment happens every block
  // Next retarget is always the next block
  return {
    progressPercent: 100,  // LWMA: always complete (adjusts every block)
    difficultyChange: previousRetarget,  // Show last difficulty change
    estimatedRetargetDate: nowSeconds * 1000 + timeAvg,  // Next block expected time
    remainingBlocks: 1,  // LWMA: next adjustment is next block
    remainingTime: timeAvg,  // Time until next block
    previousRetarget,
    previousTime: DATime,
    nextRetargetHeight: blockHeight + 1,  // LWMA: next block
    timeAvg,
    timeOffset,
    expectedBlocks: 1,  // LWMA: 1 block per adjustment
  };
}

class DifficultyAdjustmentApi {
  public getDifficultyAdjustment(): IDifficultyAdjustment | null {
    const DATime = blocks.getLastDifficultyAdjustmentTime();
    const previousRetarget = blocks.getPreviousDifficultyRetarget();
    const blockHeight = blocks.getCurrentBlockHeight();
    const blocksCache = blocks.getBlocks();
    const latestBlock = blocksCache[blocksCache.length - 1];
    if (!latestBlock) {
      return null;
    }
    const nowSeconds = Math.floor(new Date().getTime() / 1000);

    return calcDifficultyAdjustment(
      DATime, nowSeconds, blockHeight, previousRetarget,
      config.MEMPOOL.NETWORK, latestBlock.timestamp
    );
  }
}

export default new DifficultyAdjustmentApi();
