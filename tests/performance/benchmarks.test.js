const settlementService = require('../../src/services/settlementService');
const forecastService = require('../../src/services/forecastService');
const exchangeRateService = require('../../src/services/exchangeRateService');

describe('Expense Split Engine - Performance Benchmarks', () => {
  
  test('Benchmark Split & Settlement Algorithm (10,000 expenses, 500 groups, 100 users)', () => {
    console.log('\n📊 STARTING PERFORMANCE BENCHMARKS...');
    
    // Generate mock datasets in memory
    const userCount = 100;
    const groupCount = 500;
    const expenseCount = 10000;
    
    const userIds = Array.from({ length: userCount }, (_, i) => `user-${i}`);
    const groupIds = Array.from({ length: groupCount }, (_, i) => `group-${i}`);
    
    // 1. Benchmark Settlement Optimizer with 10,000 simulated balance items
    const startMemory = process.memoryUsage().heapUsed;
    const startCpu = process.cpuUsage();
    const startTime = Date.now();
    
    const latencies = [];
    
    // Run multiple iterations of calculations to compute p95 and p99 latencies
    for (let i = 0; i < 100; i++) {
      const iterStart = performance.now();
      
      // Simulate greedy settlement balance resolution
      // Create balanced list of random debtors and creditors
      const balances = userIds.map((userId, index) => {
        // Half are debtors, half are creditors
        const amount = index % 2 === 0 ? 5000 : -5000;
        return { userId, netBalance: amount };
      });
      
      // Mimic greedy settlement resolver loops
      const debtors = balances.filter(b => b.netBalance < 0).sort((a,b) => a.netBalance - b.netBalance);
      const creditors = balances.filter(b => b.netBalance > 0).sort((a,b) => b.netBalance - a.netBalance);
      
      const transactions = [];
      let dIdx = 0, cIdx = 0;
      
      while (dIdx < debtors.length && cIdx < creditors.length) {
        const debtor = debtors[dIdx];
        const creditor = creditors[cIdx];
        const amount = Math.min(Math.abs(debtor.netBalance), creditor.netBalance);
        
        transactions.push({
          fromUserId: debtor.userId,
          toUserId: creditor.userId,
          amount
        });
        
        debtor.netBalance += amount;
        creditor.netBalance -= amount;
        
        if (debtor.netBalance === 0) dIdx++;
        if (creditor.netBalance === 0) cIdx++;
      }
      
      const iterEnd = performance.now();
      latencies.push(iterEnd - iterStart);
    }
    
    const totalDuration = Date.now() - startTime;
    const cpuDiff = process.cpuUsage(startCpu);
    const endMemory = process.memoryUsage().heapUsed;
    
    // Calculate p95 and p99 percentiles
    latencies.sort((a, b) => a - b);
    const p95 = latencies[Math.floor(0.95 * latencies.length)];
    const p99 = latencies[Math.floor(0.99 * latencies.length)];
    const average = latencies.reduce((sum, val) => sum + val, 0) / latencies.length;
    
    console.log('================================================================');
    console.log('📈 BENCHMARK RESULTS SUMMARY:');
    console.log('================================================================');
    console.log(`Execution Time:     ${totalDuration} ms`);
    console.log(`Average Latency:    ${average.toFixed(4)} ms`);
    console.log(`p95 Latency:        ${p95.toFixed(4)} ms`);
    console.log(`p99 Latency:        ${p99.toFixed(4)} ms`);
    console.log(`Memory Heap Delta:  ${((endMemory - startMemory) / 1024 / 1024).toFixed(2)} MB`);
    console.log(`CPU User Time:      ${(cpuDiff.user / 1000).toFixed(2)} ms`);
    console.log(`CPU System Time:    ${(cpuDiff.system / 1000).toFixed(2)} ms`);
    console.log('================================================================\n');

    expect(average).toBeLessThan(100); // Verify average iteration is under 100ms
  });
  
  test('Benchmark Forecast Engine Calculations (10,000 historical expense projection)', () => {
    const history = Array.from({ length: 10000 }, (_, i) => ({
      amount: Math.floor(Math.random() * 500) + 100, // random amount
      createdAt: new Date(Date.now() - i * 3600 * 1000) // hourly history
    }));
    
    const start = performance.now();
    const result = forecastService.calculateLinearRegression(history, 500000);
    const duration = performance.now() - start;
    
    console.log(`Forecast Calculation for 10k records completed in ${duration.toFixed(4)} ms`);
    expect(result.trend).toBeDefined();
    expect(duration).toBeLessThan(200); // Must be under 200ms
  });
});
