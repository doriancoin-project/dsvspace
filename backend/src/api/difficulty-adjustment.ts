import config from '../config';
import { IDifficultyAdjustment } from '../mempool.interfaces';
import blocks from './blocks';

export interface DifficultyAdjustment {
  progressPercent: number;       // For LWMA: always 100 (adjusts every block)
  difficultyChange: number;      // Estimated percent change for next block
  estimatedRetargetDate: number; // For LWMA: next block time estimate
  remainingBlocks: number;       // For LWMA: always 1
  remainingTime: number;         // Time until next block (based on avg)
  previousRetarget: number;      // Previous difficulty change percent (same as estimate for LWMA)
  previousTime: number;          // Unix time in ms
  nextRetargetHeight: number;    // For LWMA: current height + 1
  timeAvg: number;               // Average block time in ms
  timeOffset: number;            // (Testnet) Time since last block
  expectedBlocks: number;        // Expected blocks in period
}

// Doriancoin LWMA parameters
const LWMA_WINDOW = 45;                    // 45-block averaging window
const BLOCK_SECONDS_TARGET = 150;          // 2.5 minutes target
const LWMA_V2_ACTIVATION_HEIGHT = 1244300; // LWMAv2 activation on mainnet
const LWMA_V2_ACTIVATION_HEIGHT_TESTNET = 200;

/**
 * Calculate LWMA (Linearly Weighted Moving Average) difficulty adjustment estimate.
 *
 * Doriancoin uses LWMA which adjusts difficulty every block based on a weighted
 * average of the last 45 blocks. Newer blocks have higher weight.
 *
 * LWMAv2 (after block 1244300) uses the window-start block's difficulty as
 * reference instead of the previous block, which fixes oscillation issues.
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
  let weightedAvgSecs = BLOCK_SECONDS_TARGET;

  // Calculate LWMA-based difficulty estimate if we have enough blocks
  if (blocksCache.length >= 3) {
    const lwmaResult = calculateLWMAEstimate(blocksCache, network);
    difficultyChange = lwmaResult.difficultyChange;
    weightedAvgSecs = lwmaResult.weightedAvgSolvetime;
  }

  // Testnet handling
  let timeOffset = 0;
  if (network === 'testnet') {
    if (weightedAvgSecs > TESTNET_MAX_BLOCK_SECONDS) {
      weightedAvgSecs = TESTNET_MAX_BLOCK_SECONDS;
    }
    const secondsSinceLastBlock = nowSeconds - latestBlockTimestamp;
    if (secondsSinceLastBlock + weightedAvgSecs > TESTNET_MAX_BLOCK_SECONDS) {
      timeOffset = -Math.min(secondsSinceLastBlock, TESTNET_MAX_BLOCK_SECONDS) * 1000;
    }
  }

  const timeAvg = Math.floor(weightedAvgSecs * 1000);

  return {
    progressPercent: 100,  // LWMA: always 100% (adjusts every block)
    difficultyChange,      // LWMA-based estimate
    estimatedRetargetDate: nowSeconds * 1000 + timeAvg,
    remainingBlocks: 1,    // LWMA: next adjustment is next block
    remainingTime: timeAvg,
    previousRetarget: difficultyChange,  // For LWMA, previous = estimate (adjusts every block)
    previousTime: DATime,
    nextRetargetHeight: blockHeight + 1,
    timeAvg,
    timeOffset,
    expectedBlocks: 1,
  };
}

/**
 * Calculate the LWMA difficulty adjustment estimate from recent blocks.
 *
 * This implements the same algorithm as Doriancoin Core's LWMA/LWMAv2:
 * - Weighted average of solve times (newer blocks weighted more heavily)
 * - Solve times clamped between 1 second and 6×target (900 seconds)
 * - LWMAv2 uses window-start difficulty as reference
 *
 * Exported for testing.
 */
export function calculateLWMAEstimate(
  blocksCache: { height: number; timestamp: number; difficulty: number }[],
  network: string
): { difficultyChange: number; weightedAvgSolvetime: number } {
  const T = BLOCK_SECONDS_TARGET;
  const N = LWMA_WINDOW;

  // Sort blocks by height descending (newest first)
  const sortedBlocks = [...blocksCache].sort((a, b) => b.height - a.height);
  const currentBlock = sortedBlocks[0];
  const blocksAvailable = Math.min(sortedBlocks.length - 1, N);

  if (blocksAvailable < 2) {
    return { difficultyChange: 0, weightedAvgSolvetime: T };
  }

  // Determine if we're using LWMAv2 based on block height
  const lwmaV2Height = network === 'testnet'
    ? LWMA_V2_ACTIVATION_HEIGHT_TESTNET
    : LWMA_V2_ACTIVATION_HEIGHT;
  const useLWMAv2 = currentBlock.height >= lwmaV2Height;

  // Calculate weighted solve times
  // Weight increases from 1 (oldest) to N (newest)
  let sumWeightedSolvetimes = 0;
  let sumWeights = 0;

  for (let i = 0; i < blocksAvailable; i++) {
    const block = sortedBlocks[i];
    const prevBlock = sortedBlocks[i + 1];

    if (!prevBlock) break;

    let solvetime = block.timestamp - prevBlock.timestamp;

    // Clamp solvetime like the actual algorithm does
    if (solvetime < 1) solvetime = 1;
    if (solvetime > 6 * T) solvetime = 6 * T;

    // Weight: newer blocks get higher weight
    // When iterating from newest (i=0) to oldest (i=blocksAvailable-1)
    // Weight should be: blocksAvailable for newest, 1 for oldest
    const weight = blocksAvailable - i;

    sumWeightedSolvetimes += solvetime * weight;
    sumWeights += weight;
  }

  if (sumWeights === 0) {
    return { difficultyChange: 0, weightedAvgSolvetime: T };
  }

  const weightedAvgSolvetime = sumWeightedSolvetimes / sumWeights;

  // Calculate difficulty change percentage
  let difficultyChange: number;

  if (useLWMAv2 && blocksAvailable >= 3) {
    // LWMAv2: nextTarget = windowStartTarget * ratio
    // nextDifficulty = windowStartDifficulty / ratio
    // percentChange = (nextDifficulty - currentDifficulty) / currentDifficulty * 100
    const windowStartBlock = sortedBlocks[blocksAvailable];
    const currentDifficulty = currentBlock.difficulty;
    const windowStartDifficulty = windowStartBlock?.difficulty || currentDifficulty;

    // ratio = sumWeightedSolvetimes / expectedWeightedSolvetimes
    const expectedWeightedSolvetimes = sumWeights * T;
    const lwmaRatio = sumWeightedSolvetimes / expectedWeightedSolvetimes;

    // nextDifficulty = windowStartDifficulty / lwmaRatio
    const nextDifficulty = windowStartDifficulty / lwmaRatio;
    difficultyChange = ((nextDifficulty - currentDifficulty) / currentDifficulty) * 100;

    // Apply LWMAv2's tighter caps (max 3x adjustment)
    // 3x increase means +200%, 3x decrease means -66.67%
    if (difficultyChange > 200) difficultyChange = 200;
    if (difficultyChange < -66.67) difficultyChange = -66.67;
  } else {
    // LWMAv1: nextTarget = prevTarget * ratio
    // nextDifficulty = prevDifficulty / ratio
    // percentChange = (1/ratio - 1) * 100 = (T/weightedAvg - 1) * 100
    const targetRatio = T / weightedAvgSolvetime;
    difficultyChange = (targetRatio - 1) * 100;

    // Apply LWMAv1's caps (max 10x adjustment)
    if (difficultyChange > 100) difficultyChange = 100;
    if (difficultyChange < -90) difficultyChange = -90;
  }

  return { difficultyChange, weightedAvgSolvetime };
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
