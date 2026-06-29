const forecastService = require('../../src/services/forecastService');
const settlementService = require('../../src/services/settlementService');

describe('Expense Split Engine - Memory Leak Regressions', () => {
  
  test('Assert repeated calculations maintain stable heap usage without continuous leak growth', () => {
    console.log('\n📊 STARTING MEMORY STABILITY LEAK CHECKS...');
    
    // Warm up runs
    const mockHistory = Array.from({ length: 500 }, (_, i) => ({
      amount: 1000,
      createdAt: new Date(Date.now() - i * 60 * 1000)
    }));

    for (let i = 0; i < 5; i++) {
      forecastService.calculateLinearRegression(mockHistory, 50000);
    }
    
    // Capture baseline memory
    if (global.gc) global.gc();
    const baselineMemory = process.memoryUsage().heapUsed;
    
    // Execute many iterations
    const iterations = 50;
    for (let i = 0; i < iterations; i++) {
      // Execute forecasting engine
      forecastService.calculateLinearRegression(mockHistory, 50000);
      
      // Execute settlement calculation simulator
      const mockBalances = Array.from({ length: 50 }, (_, idx) => ({
        userId: `u-${idx}`,
        netBalance: idx % 2 === 0 ? 1000 : -1000
      }));
      
      const debtors = mockBalances.filter(b => b.netBalance < 0);
      const creditors = mockBalances.filter(b => b.netBalance > 0);
      let dIdx = 0, cIdx = 0;
      while (dIdx < debtors.length && cIdx < creditors.length) {
        const amount = Math.min(Math.abs(debtors[dIdx].netBalance), creditors[cIdx].netBalance);
        debtors[dIdx].netBalance += amount;
        creditors[cIdx].netBalance -= amount;
        if (debtors[dIdx].netBalance === 0) dIdx++;
        if (creditors[cIdx].netBalance === 0) cIdx++;
      }
    }
    
    // Capture post-run memory
    if (global.gc) global.gc();
    const endingMemory = process.memoryUsage().heapUsed;
    const delta = endingMemory - baselineMemory;
    const deltaMB = (delta / 1024 / 1024).toFixed(3);
    
    console.log('================================================================');
    console.log('🧠 MEMORY STABILITY REPORT:');
    console.log('================================================================');
    console.log(`Baseline Heap Used: ${((baselineMemory) / 1024 / 1024).toFixed(3)} MB`);
    console.log(`Ending Heap Used:   ${((endingMemory) / 1024 / 1024).toFixed(3)} MB`);
    console.log(`Memory Delta:       ${deltaMB} MB`);
    console.log('================================================================\n');

    // Safe threshold: memory delta after 50 runs should be less than 8MB
    expect(parseFloat(deltaMB)).toBeLessThan(8.0);
  });
});
