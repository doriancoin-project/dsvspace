import { calculateLWMAEstimate } from '../../api/difficulty-adjustment';

// Mock block type for tests
interface MockBlock {
  height: number;
  timestamp: number;
  difficulty: number;
}

describe('LWMA Difficulty Adjustment', () => {
  test('should return zero change with insufficient blocks', () => {
    // Only 2 blocks - not enough for LWMA calculation (need at least 3)
    const mockBlocks: MockBlock[] = [
      { height: 1244400, timestamp: 1000, difficulty: 100 },
      { height: 1244401, timestamp: 1150, difficulty: 100 },
    ];

    const result = calculateLWMAEstimate(mockBlocks, 'mainnet');

    // With insufficient blocks, should return defaults
    expect(result.difficultyChange).toBe(0);
    expect(result.weightedAvgSolvetime).toBe(150); // Default target
  });

  test('should calculate negative difficulty change when blocks are slow', () => {
    // Create blocks with slow solve times (average > 150 seconds)
    // This should result in difficulty decrease
    const baseTime = 1700000000;
    const mockBlocks: MockBlock[] = [];

    // Generate 10 blocks with ~200 second intervals (slow)
    for (let i = 0; i < 10; i++) {
      mockBlocks.push({
        height: 1244400 + i,
        timestamp: baseTime + i * 200, // 200 second intervals
        difficulty: 100,
      });
    }

    const result = calculateLWMAEstimate(mockBlocks, 'mainnet');

    // With blocks averaging 200s vs target 150s, difficulty should decrease
    expect(result.difficultyChange).toBeLessThan(0);
    // Weighted average should be close to 200
    expect(result.weightedAvgSolvetime).toBeGreaterThan(190);
    expect(result.weightedAvgSolvetime).toBeLessThan(210);
  });

  test('should calculate positive difficulty change when blocks are fast', () => {
    // Create blocks with fast solve times (average < 150 seconds)
    // This should result in difficulty increase
    const baseTime = 1700000000;
    const mockBlocks: MockBlock[] = [];

    // Generate 10 blocks with ~100 second intervals (fast)
    for (let i = 0; i < 10; i++) {
      mockBlocks.push({
        height: 1244400 + i,
        timestamp: baseTime + i * 100, // 100 second intervals
        difficulty: 100,
      });
    }

    const result = calculateLWMAEstimate(mockBlocks, 'mainnet');

    // With blocks averaging 100s vs target 150s, difficulty should increase
    expect(result.difficultyChange).toBeGreaterThan(0);
    // Weighted average should be close to 100
    expect(result.weightedAvgSolvetime).toBeGreaterThan(90);
    expect(result.weightedAvgSolvetime).toBeLessThan(110);
  });

  test('should calculate near-zero change when blocks are on target', () => {
    // Create blocks with target solve times (150 seconds)
    const baseTime = 1700000000;
    const mockBlocks: MockBlock[] = [];

    // Generate 10 blocks with exactly 150 second intervals
    for (let i = 0; i < 10; i++) {
      mockBlocks.push({
        height: 1244400 + i,
        timestamp: baseTime + i * 150, // Target 150 second intervals
        difficulty: 100,
      });
    }

    const result = calculateLWMAEstimate(mockBlocks, 'mainnet');

    // With blocks exactly at target, difficulty change should be near zero
    expect(Math.abs(result.difficultyChange)).toBeLessThan(1);
    // Weighted average should be exactly 150
    expect(result.weightedAvgSolvetime).toBeCloseTo(150, 1);
  });

  test('should clamp solve times to valid range', () => {
    // Test with extreme solve times that should be clamped
    const baseTime = 1700000000;
    const mockBlocks: MockBlock[] = [
      { height: 1244400, timestamp: baseTime, difficulty: 100 },
      { height: 1244401, timestamp: baseTime + 0, difficulty: 100 },      // 0s solve time (clamped to 1s)
      { height: 1244402, timestamp: baseTime + 1500, difficulty: 100 },   // 1500s solve time (clamped to 900s)
      { height: 1244403, timestamp: baseTime + 1650, difficulty: 100 },   // 150s solve time
    ];

    const result = calculateLWMAEstimate(mockBlocks, 'mainnet');

    // Should not throw and should return valid result
    expect(typeof result.difficultyChange).toBe('number');
    expect(isNaN(result.difficultyChange)).toBe(false);
    // Weighted average should be between clamped values
    expect(result.weightedAvgSolvetime).toBeGreaterThan(0);
    expect(result.weightedAvgSolvetime).toBeLessThanOrEqual(900);
  });

  test('should handle LWMAv2 caps (max 3x adjustment)', () => {
    // Create very slow blocks to trigger LWMAv2's tighter caps
    const baseTime = 1700000000;
    const mockBlocks: MockBlock[] = [];

    // Generate blocks with ~900 second intervals (6x slower than target, at max clamp)
    // This would produce a large negative change, but should be capped at -66.67%
    for (let i = 0; i < 10; i++) {
      mockBlocks.push({
        height: 1244400 + i,
        timestamp: baseTime + i * 900, // Max clamped time
        difficulty: 100 + i * 10, // Varying difficulty
      });
    }

    const result = calculateLWMAEstimate(mockBlocks, 'mainnet');

    // LWMAv2 caps at -66.67% (1/3x) and +200% (3x)
    expect(result.difficultyChange).toBeGreaterThanOrEqual(-66.67);
    expect(result.difficultyChange).toBeLessThanOrEqual(200);
  });

  test('should use LWMAv1 for blocks before activation height', () => {
    // Use block heights before LWMAv2 activation (1244300 on mainnet)
    const baseTime = 1700000000;
    const mockBlocks: MockBlock[] = [];

    for (let i = 0; i < 10; i++) {
      mockBlocks.push({
        height: 1244200 + i, // Before LWMAv2 activation
        timestamp: baseTime + i * 200,
        difficulty: 100,
      });
    }

    const result = calculateLWMAEstimate(mockBlocks, 'mainnet');

    // LWMAv1 has different caps (-90% to +100%)
    expect(result.difficultyChange).toBeGreaterThanOrEqual(-90);
    expect(result.difficultyChange).toBeLessThanOrEqual(100);
  });

  test('should use testnet activation heights', () => {
    // Use block heights after testnet LWMAv2 activation (200)
    const baseTime = 1700000000;
    const mockBlocks: MockBlock[] = [];

    for (let i = 0; i < 10; i++) {
      mockBlocks.push({
        height: 250 + i, // After testnet LWMAv2 activation
        timestamp: baseTime + i * 150,
        difficulty: 100,
      });
    }

    const result = calculateLWMAEstimate(mockBlocks, 'testnet');

    // Should calculate without error
    expect(typeof result.difficultyChange).toBe('number');
    expect(Math.abs(result.difficultyChange)).toBeLessThan(1); // Near target time
  });

  test('should weight newer blocks more heavily', () => {
    const baseTime = 1700000000;

    // Create blocks where older blocks are slow, newer blocks are fast
    const mockBlocks: MockBlock[] = [
      { height: 1244400, timestamp: baseTime, difficulty: 100 },
      { height: 1244401, timestamp: baseTime + 300, difficulty: 100 }, // 300s (slow)
      { height: 1244402, timestamp: baseTime + 600, difficulty: 100 }, // 300s (slow)
      { height: 1244403, timestamp: baseTime + 700, difficulty: 100 }, // 100s (fast)
      { height: 1244404, timestamp: baseTime + 800, difficulty: 100 }, // 100s (fast)
      { height: 1244405, timestamp: baseTime + 900, difficulty: 100 }, // 100s (fast)
    ];

    const result = calculateLWMAEstimate(mockBlocks, 'mainnet');

    // Simple average would be (300+300+100+100+100)/5 = 180
    // Weighted average should be less than 180 because newer fast blocks have higher weight
    expect(result.weightedAvgSolvetime).toBeLessThan(180);
  });

  test('should handle 45-block window correctly', () => {
    const baseTime = 1700000000;
    const mockBlocks: MockBlock[] = [];

    // Generate 50 blocks (more than the 45-block window)
    for (let i = 0; i < 50; i++) {
      mockBlocks.push({
        height: 1244400 + i,
        timestamp: baseTime + i * 150,
        difficulty: 100,
      });
    }

    const result = calculateLWMAEstimate(mockBlocks, 'mainnet');

    // Should calculate without error and use only 45 blocks
    expect(typeof result.difficultyChange).toBe('number');
    expect(Math.abs(result.difficultyChange)).toBeLessThan(1);
  });

  test('should return correct weighted average solve time', () => {
    const baseTime = 1700000000;
    const mockBlocks: MockBlock[] = [];

    // Generate 10 blocks with exactly 180 second intervals
    for (let i = 0; i < 10; i++) {
      mockBlocks.push({
        height: 1244400 + i,
        timestamp: baseTime + i * 180,
        difficulty: 100,
      });
    }

    const result = calculateLWMAEstimate(mockBlocks, 'mainnet');

    // Weighted average should be close to 180 seconds
    expect(result.weightedAvgSolvetime).toBeGreaterThan(175);
    expect(result.weightedAvgSolvetime).toBeLessThan(185);
  });
});
