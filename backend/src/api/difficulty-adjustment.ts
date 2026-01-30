import config from '../config';
import { IDifficultyAdjustment } from '../mempool.interfaces';
import blocks from './blocks';

export interface DifficultyAdjustment {
  progressPercent: number;       // Always 100 (ASERT adjusts every block)
  difficultyChange: number;      // Estimated percent change for next block
  estimatedRetargetDate: number; // Next block time estimate
  remainingBlocks: number;       // Always 1 (adjusts every block)
  remainingTime: number;         // Time until next block (based on avg)
  previousRetarget: number;      // Previous difficulty change percent
  previousTime: number;          // Unix time in ms
  nextRetargetHeight: number;    // Current height + 1
  timeAvg: number;               // Average block time in ms
  timeOffset: number;            // (Testnet) Time since last block
  expectedBlocks: number;        // Expected blocks in period
}

// Doriancoin ASERT parameters
const BLOCK_SECONDS_TARGET = 150;   // 2.5 minutes target
const ASERT_HALFLIFE = 3600;        // 1 hour halflife in seconds
const RECENT_BLOCKS_WINDOW = 45;    // Number of recent blocks to average for estimate

/**
 * Calculate ASERT (Absolutely Scheduled Exponentially Rising Targets) difficulty
 * adjustment estimate.
 *
 * Doriancoin uses ASERT which adjusts difficulty every block based on the total
 * time deviation from the expected schedule since an anchor block. The algorithm
 * uses an exponential function with a 1-hour halflife.
 *
 * Per-block difficulty change: 2^((targetTime - actualSolveTime) / halflife) - 1
 */
export function calcDifficultyAdjustment(
  DATime: number,
  nowSeconds: number,
  blockHeight: number,
  previousRetarget: number,
  network: string,
  latestBlockTimestamp: number,
): DifficultyAdjustment {
  const TESTNET_MAX_BLOCK_SECONDS = 1200;
  const blocksCache = blocks.getBlocks();

  // Default values if we don't have enough blocks
  let difficultyChange = 0;
  let avgSolveTimeSecs = BLOCK_SECONDS_TARGET;

  // Calculate ASERT-based difficulty estimate if we have enough blocks
  if (blocksCache.length >= 3) {
    const result = calculateASERTEstimate(blocksCache);
    difficultyChange = result.difficultyChange;
    avgSolveTimeSecs = result.avgSolveTime;
  }

  // Testnet handling
  let timeOffset = 0;
  if (network === 'testnet') {
    if (avgSolveTimeSecs > TESTNET_MAX_BLOCK_SECONDS) {
      avgSolveTimeSecs = TESTNET_MAX_BLOCK_SECONDS;
    }
    const secondsSinceLastBlock = nowSeconds - latestBlockTimestamp;
    if (secondsSinceLastBlock + avgSolveTimeSecs > TESTNET_MAX_BLOCK_SECONDS) {
      timeOffset = -Math.min(secondsSinceLastBlock, TESTNET_MAX_BLOCK_SECONDS) * 1000;
    }
  }

  const timeAvg = Math.floor(avgSolveTimeSecs * 1000);

  return {
    progressPercent: 100,  // ASERT: always 100% (adjusts every block)
    difficultyChange,
    estimatedRetargetDate: nowSeconds * 1000 + timeAvg,
    remainingBlocks: 1,    // ASERT: next adjustment is next block
    remainingTime: timeAvg,
    previousRetarget: difficultyChange,  // For ASERT, previous = estimate (adjusts every block)
    previousTime: DATime,
    nextRetargetHeight: blockHeight + 1,
    timeAvg,
    timeOffset,
    expectedBlocks: 1,
  };
}

/**
 * Calculate the ASERT difficulty adjustment estimate from recent blocks.
 *
 * ASERT computes difficulty from the total time deviation since an anchor block:
 *   target = anchor_target * 2^((time_delta - T * height_delta) / halflife)
 *
 * For the per-block estimate displayed in the UI, we use the average solve time
 * from recent blocks to predict the next block's difficulty change:
 *   difficulty_change = (2^((T - avgSolveTime) / halflife) - 1) * 100
 *
 * With a 3600-second halflife and 150-second target, per-block changes are small
 * (max ~2.9% increase if a block is instant, gradual decrease for slow blocks).
 *
 * Exported for testing.
 */
export function calculateASERTEstimate(
  blocksCache: { height: number; timestamp: number; difficulty: number }[],
): { difficultyChange: number; avgSolveTime: number } {
  const T = BLOCK_SECONDS_TARGET;

  // Sort blocks by height descending (newest first)
  const sortedBlocks = [...blocksCache].sort((a, b) => b.height - a.height);
  const blocksAvailable = Math.min(sortedBlocks.length - 1, RECENT_BLOCKS_WINDOW);

  if (blocksAvailable < 2) {
    return { difficultyChange: 0, avgSolveTime: T };
  }

  // Calculate average solve time from recent blocks
  let totalSolveTime = 0;
  let count = 0;

  for (let i = 0; i < blocksAvailable; i++) {
    const block = sortedBlocks[i];
    const prevBlock = sortedBlocks[i + 1];

    if (!prevBlock) break;

    let solveTime = block.timestamp - prevBlock.timestamp;

    // Clamp solve times to reasonable bounds
    if (solveTime < 1) solveTime = 1;
    if (solveTime > 6 * T) solveTime = 6 * T;

    totalSolveTime += solveTime;
    count++;
  }

  if (count === 0) {
    return { difficultyChange: 0, avgSolveTime: T };
  }

  const avgSolveTime = totalSolveTime / count;

  // ASERT per-block difficulty change:
  // The ratio of next difficulty to current difficulty is:
  //   2^((T - avgSolveTime) / halflife)
  //
  // If blocks are faster than target (avgSolveTime < T), exponent is positive,
  // so difficulty increases. If slower, difficulty decreases.
  const exponent = (T - avgSolveTime) / ASERT_HALFLIFE;
  const ratio = Math.pow(2, exponent);
  const difficultyChange = (ratio - 1) * 100;

  return { difficultyChange, avgSolveTime };
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
