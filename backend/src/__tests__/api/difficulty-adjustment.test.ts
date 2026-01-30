import { calculateASERTEstimate } from '../../api/difficulty-adjustment';

// Mock block type for tests
interface MockBlock {
  height: number;
  timestamp: number;
  difficulty: number;
}

describe('ASERT Difficulty Adjustment', () => {
  test('should return zero change with insufficient blocks', () => {
    // Only 2 blocks - not enough for calculation (need at least 3)
    const mockBlocks: MockBlock[] = [
      { height: 1246100, timestamp: 1000, difficulty: 100 },
      { height: 1246101, timestamp: 1150, difficulty: 100 },
    ];

    const result = calculateASERTEstimate(mockBlocks);

    // With insufficient blocks, should return defaults
    expect(result.difficultyChange).toBe(0);
    expect(result.avgSolveTime).toBe(150); // Default target
  });

  test('should calculate negative difficulty change when blocks are slow', () => {
    // Create blocks with slow solve times (average > 150 seconds)
    // This should result in difficulty decrease
    const baseTime = 1700000000;
    const mockBlocks: MockBlock[] = [];

    // Generate 10 blocks with ~200 second intervals (slow)
    for (let i = 0; i < 10; i++) {
      mockBlocks.push({
        height: 1246100 + i,
        timestamp: baseTime + i * 200, // 200 second intervals
        difficulty: 100,
      });
    }

    const result = calculateASERTEstimate(mockBlocks);

    // With blocks averaging 200s vs target 150s, difficulty should decrease
    expect(result.difficultyChange).toBeLessThan(0);
    // ASERT: 2^((150-200)/3600) - 1 ≈ -0.96%
    expect(result.difficultyChange).toBeCloseTo(-0.955, 1);
    // Average should be close to 200
    expect(result.avgSolveTime).toBeGreaterThan(190);
    expect(result.avgSolveTime).toBeLessThan(210);
  });

  test('should calculate positive difficulty change when blocks are fast', () => {
    // Create blocks with fast solve times (average < 150 seconds)
    // This should result in difficulty increase
    const baseTime = 1700000000;
    const mockBlocks: MockBlock[] = [];

    // Generate 10 blocks with ~100 second intervals (fast)
    for (let i = 0; i < 10; i++) {
      mockBlocks.push({
        height: 1246100 + i,
        timestamp: baseTime + i * 100, // 100 second intervals
        difficulty: 100,
      });
    }

    const result = calculateASERTEstimate(mockBlocks);

    // With blocks averaging 100s vs target 150s, difficulty should increase
    expect(result.difficultyChange).toBeGreaterThan(0);
    // ASERT: 2^((150-100)/3600) - 1 ≈ 0.965%
    expect(result.difficultyChange).toBeCloseTo(0.965, 1);
    // Average should be close to 100
    expect(result.avgSolveTime).toBeGreaterThan(90);
    expect(result.avgSolveTime).toBeLessThan(110);
  });

  test('should calculate near-zero change when blocks are on target', () => {
    // Create blocks with target solve times (150 seconds)
    const baseTime = 1700000000;
    const mockBlocks: MockBlock[] = [];

    // Generate 10 blocks with exactly 150 second intervals
    for (let i = 0; i < 10; i++) {
      mockBlocks.push({
        height: 1246100 + i,
        timestamp: baseTime + i * 150, // Target 150 second intervals
        difficulty: 100,
      });
    }

    const result = calculateASERTEstimate(mockBlocks);

    // With blocks exactly at target, difficulty change should be zero
    expect(result.difficultyChange).toBeCloseTo(0, 5);
    // Average should be exactly 150
    expect(result.avgSolveTime).toBeCloseTo(150, 1);
  });

  test('should clamp solve times to valid range', () => {
    // Test with blocks that have extreme solve times
    const baseTime = 1700000000;
    const mockBlocks: MockBlock[] = [
      { height: 1246100, timestamp: baseTime, difficulty: 100 },
      { height: 1246101, timestamp: baseTime + 0, difficulty: 100 },      // 0s → clamped to 1s
      { height: 1246102, timestamp: baseTime + 1500, difficulty: 100 },   // 1500s → clamped to 900s
      { height: 1246103, timestamp: baseTime + 1650, difficulty: 100 },   // 150s
    ];

    const result = calculateASERTEstimate(mockBlocks);

    // Should not throw and should return valid result
    expect(typeof result.difficultyChange).toBe('number');
    expect(isNaN(result.difficultyChange)).toBe(false);
    expect(result.avgSolveTime).toBeGreaterThan(0);
    // Upper clamp is 6*150=900s, so max avg is bounded
    expect(result.avgSolveTime).toBeLessThanOrEqual(900);
  });

  test('should produce small per-block changes due to halflife', () => {
    // ASERT with 3600s halflife produces modest per-block changes
    // Even with very fast blocks (39s avg from screenshot), change should be small
    const baseTime = 1700000000;
    const mockBlocks: MockBlock[] = [];

    // Generate blocks with ~39 second intervals (very fast, like in screenshot)
    for (let i = 0; i < 20; i++) {
      mockBlocks.push({
        height: 1246100 + i,
        timestamp: baseTime + i * 39,
        difficulty: 100,
      });
    }

    const result = calculateASERTEstimate(mockBlocks);

    // ASERT: 2^((150-39)/3600) - 1 ≈ 2.16%
    // NOT 200% like the old LWMA cap would show
    expect(result.difficultyChange).toBeGreaterThan(2);
    expect(result.difficultyChange).toBeLessThan(3);
    expect(result.avgSolveTime).toBeCloseTo(39, 0);
  });

  test('should handle halflife property correctly', () => {
    // ASERT halflife: if avg solve time exceeds target by halflife seconds,
    // difficulty halves. However, solve times are clamped to 6*T = 900s.
    // With the clamp, max avg is 900s, giving:
    //   2^((150 - 900) / 3600) = 2^(-0.2083) ≈ -13.45%
    //
    // Test with unclamped value: 300s avg (within clamp)
    //   2^((150 - 300) / 3600) = 2^(-0.04167) ≈ -2.85%
    const baseTime = 1700000000;
    const mockBlocks: MockBlock[] = [];

    for (let i = 0; i < 10; i++) {
      mockBlocks.push({
        height: 1246100 + i,
        timestamp: baseTime + i * 300,
        difficulty: 100,
      });
    }

    const result = calculateASERTEstimate(mockBlocks);

    // 2^((150 - 300) / 3600) - 1 ≈ -2.85%
    expect(result.difficultyChange).toBeCloseTo(-2.85, 0);
    expect(result.avgSolveTime).toBeCloseTo(300, 1);
  });

  test('should handle blocks exactly 1 halflife ahead of schedule', () => {
    // If chain is 1 halflife ahead of schedule, difficulty doubles
    // This means blocks need to average: T - halflife = 150 - 3600 = -3450
    // But solve times are clamped to minimum 1 second.
    // With 1-second solve times: exponent = (150-1)/3600 ≈ 0.0414
    // change ≈ 2^0.0414 - 1 ≈ 2.91%
    const baseTime = 1700000000;
    const mockBlocks: MockBlock[] = [];

    for (let i = 0; i < 10; i++) {
      mockBlocks.push({
        height: 1246100 + i,
        timestamp: baseTime + i * 1, // 1-second blocks (minimum after clamp)
        difficulty: 100,
      });
    }

    const result = calculateASERTEstimate(mockBlocks);

    // Maximum per-block increase: 2^((150-1)/3600) - 1 ≈ 2.91%
    expect(result.difficultyChange).toBeCloseTo(2.91, 0);
  });

  test('should use up to 45 recent blocks for averaging', () => {
    const baseTime = 1700000000;
    const mockBlocks: MockBlock[] = [];

    // Generate 50 blocks (more than the 45-block window)
    // First 5 blocks: very slow (shouldn't affect result since outside window)
    for (let i = 0; i < 5; i++) {
      mockBlocks.push({
        height: 1246050 + i,
        timestamp: baseTime + i * 900,
        difficulty: 100,
      });
    }
    // Next 46 blocks: at target rate (these fill the 45-block window)
    const offset = baseTime + 5 * 900;
    for (let i = 0; i < 46; i++) {
      mockBlocks.push({
        height: 1246055 + i,
        timestamp: offset + i * 150,
        difficulty: 100,
      });
    }

    const result = calculateASERTEstimate(mockBlocks);

    // Should use only the most recent 45 blocks, which are at target rate
    expect(result.difficultyChange).toBeCloseTo(0, 0);
  });

  test('should return correct average solve time', () => {
    const baseTime = 1700000000;
    const mockBlocks: MockBlock[] = [];

    // Generate 10 blocks with exactly 180 second intervals
    for (let i = 0; i < 10; i++) {
      mockBlocks.push({
        height: 1246100 + i,
        timestamp: baseTime + i * 180,
        difficulty: 100,
      });
    }

    const result = calculateASERTEstimate(mockBlocks);

    // Average should be close to 180 seconds
    expect(result.avgSolveTime).toBeCloseTo(180, 1);
    // Difficulty should decrease: 2^((150-180)/3600) - 1 ≈ -0.574%
    expect(result.difficultyChange).toBeLessThan(0);
    expect(result.difficultyChange).toBeCloseTo(-0.574, 1);
  });

  test('should not have LWMA-style caps', () => {
    // ASERT does not have the +200%/-66.67% caps that LWMA had.
    // With very slow blocks, the change is naturally bounded by the exponential.
    const baseTime = 1700000000;
    const mockBlocks: MockBlock[] = [];

    // Generate blocks with 600s intervals (4x slower than target)
    for (let i = 0; i < 10; i++) {
      mockBlocks.push({
        height: 1246100 + i,
        timestamp: baseTime + i * 600,
        difficulty: 100,
      });
    }

    const result = calculateASERTEstimate(mockBlocks);

    // 2^((150-600)/3600) - 1 = 2^(-0.125) - 1 ≈ -8.3%
    // This is a natural exponential result, not artificially capped
    expect(result.difficultyChange).toBeCloseTo(-8.30, 0);
  });
});
