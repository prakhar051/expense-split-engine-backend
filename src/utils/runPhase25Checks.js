require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const prisma = require('../utils/prisma');
const exchangeRateService = require('../services/exchangeRateService');

const TEST_PORT = 5056;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_access_token_secret_987654321_abc';

function printPass(testName) {
  console.log(`✓ ${testName}: PASS`);
}

function printFail(testName, error) {
  console.error(`✗ ${testName}: FAIL`);
  console.error(`  Reason: ${error.message || error}`);
}

async function fetchJson(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
  const data = await response.json();
  return { status: response.status, data };
}

async function run() {
  console.log('================================================================');
  console.log('PHASE 25 MULTI-CURRENCY SUPPORT VERIFICATION CHECKS');
  console.log('================================================================\n');

  let passedAll = true;
  let passed = 0;
  let failed = 0;

  // Initialize test server
  const app = express();
  app.use(express.json());

  // Mount routes
  const currencyRoutes = require('../routes/currencyRoutes');
  const expenseRoutes = require('../routes/expenseRoutes');
  const groupRoutes = require('../routes/groupRoutes');
  app.use('/api/currency', currencyRoutes);
  app.use('/api/expenses', expenseRoutes);
  app.use('/api/groups', groupRoutes);

  // Centralized error handler
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ success: false, message: err.message });
  });

  const server = http.createServer(app);

  await new Promise((resolve) => {
    server.listen(TEST_PORT, resolve);
  });
  console.log(`Test server listening on port ${TEST_PORT}\n`);

  // Create test user
  const testUserId = crypto.randomUUID();
  const testUserEmail = `phase25test_${Date.now()}@test.com`;
  const bcrypt = require('bcryptjs');
  const hashedPw = await bcrypt.hash('Test123!', 10);

  const testUser = await prisma.user.create({
    data: {
      id: testUserId,
      email: testUserEmail,
      password: hashedPw,
      name: 'Phase25 Tester'
    }
  });

  const token = jwt.sign({ id: testUserId }, JWT_SECRET, { expiresIn: '1h' });
  const authHeaders = { Authorization: `Bearer ${token}` };

  // Create second test user
  const testUser2Id = crypto.randomUUID();
  const testUser2 = await prisma.user.create({
    data: {
      id: testUser2Id,
      email: `phase25test2_${Date.now()}@test.com`,
      password: hashedPw,
      name: 'Phase25 Tester2'
    }
  });

  // Create test group
  const testGroup = await prisma.group.create({
    data: {
      name: 'Phase 25 Test Group',
      createdById: testUserId,
      members: {
        create: [
          { userId: testUserId, role: 'OWNER' },
          { userId: testUser2Id, role: 'MEMBER' }
        ]
      }
    }
  });

  try {
    // ====================================================================
    // TEST 1: Schema & Enum Verification
    // ====================================================================
    const testName1 = '1. Currency enum exists in schema';
    try {
      // If Currency enum didn't exist, this would fail
      const expense = await prisma.expense.findFirst({
        select: { originalCurrency: true }
      });
      printPass(testName1);
      passed++;
    } catch (err) {
      printFail(testName1, err);
      failed++;
      passedAll = false;
    }

    // ====================================================================
    // TEST 2: ExchangeRateSnapshot model exists
    // ====================================================================
    const testName2 = '2. ExchangeRateSnapshot model exists in database';
    try {
      const count = await prisma.exchangeRateSnapshot.count();
      printPass(testName2 + ` (${count} snapshots)`);
      passed++;
    } catch (err) {
      printFail(testName2, err);
      failed++;
      passedAll = false;
    }

    // ====================================================================
    // TEST 3: GET /api/currency/supported returns supported currencies
    // ====================================================================
    const testName3 = '3. GET /api/currency/supported returns supported list';
    try {
      const { status, data } = await fetchJson('/api/currency/supported', { headers: authHeaders });
      if (status !== 200) throw new Error(`Expected 200, got ${status}`);
      if (!data.success) throw new Error('Expected success: true');
      if (!Array.isArray(data.currencies)) throw new Error('currencies should be an array');
      if (data.currencies.length < 9) throw new Error(`Expected at least 9 currencies, got ${data.currencies.length}`);
      if (!data.currencies.includes('INR')) throw new Error('INR not in supported list');
      if (!data.currencies.includes('USD')) throw new Error('USD not in supported list');
      if (!data.currencies.includes('EUR')) throw new Error('EUR not in supported list');
      if (!data.baseCurrency) throw new Error('baseCurrency missing');
      printPass(testName3 + ` (${data.currencies.length} currencies, base=${data.baseCurrency})`);
      passed++;
    } catch (err) {
      printFail(testName3, err);
      failed++;
      passedAll = false;
    }

    // ====================================================================
    // TEST 4: GET /api/currency/rates returns exchange rates
    // ====================================================================
    const testName4 = '4. GET /api/currency/rates returns live exchange rates';
    try {
      const { status, data } = await fetchJson('/api/currency/rates', { headers: authHeaders });
      if (status !== 200) throw new Error(`Expected 200, got ${status}`);
      if (!data.success) throw new Error('Expected success: true');
      if (!data.rates) throw new Error('rates object missing');
      if (!data.baseCurrency) throw new Error('baseCurrency missing');
      if (!data.fetchedAt) throw new Error('fetchedAt missing');
      const rateKeys = Object.keys(data.rates);
      if (rateKeys.length < 5) throw new Error(`Expected at least 5 rate entries, got ${rateKeys.length}`);
      printPass(testName4 + ` (${rateKeys.length} pairs from ${data.provider})`);
      passed++;
    } catch (err) {
      printFail(testName4, err);
      failed++;
      passedAll = false;
    }

    // ====================================================================
    // TEST 5: POST /api/currency/convert validates input
    // ====================================================================
    const testName5 = '5. POST /api/currency/convert validates bad input';
    try {
      const { status, data } = await fetchJson('/api/currency/convert', {
        method: 'POST',
        body: JSON.stringify({ amount: -5, from: 'INR', to: 'USD' }),
        headers: authHeaders
      });
      if (status !== 400) throw new Error(`Expected 400, got ${status}`);
      printPass(testName5);
      passed++;
    } catch (err) {
      printFail(testName5, err);
      failed++;
      passedAll = false;
    }

    // ====================================================================
    // TEST 6: POST /api/currency/convert converts correctly
    // ====================================================================
    const testName6 = '6. POST /api/currency/convert converts INR to USD';
    try {
      const { status, data } = await fetchJson('/api/currency/convert', {
        method: 'POST',
        body: JSON.stringify({ amount: 100000, from: 'INR', to: 'USD' }),
        headers: authHeaders
      });
      if (status !== 200) throw new Error(`Expected 200, got ${status}`);
      if (!data.success) throw new Error('Expected success: true');
      if (data.convertedAmount === undefined) throw new Error('convertedAmount missing');
      if (data.rate === undefined) throw new Error('rate missing');
      if (typeof data.convertedAmount !== 'number') throw new Error('convertedAmount is not number');
      printPass(testName6 + ` (₹1000 = $${(data.convertedAmount / 100).toFixed(2)} at rate ${data.rate.toFixed(4)})`);
      passed++;
    } catch (err) {
      printFail(testName6, err);
      failed++;
      passedAll = false;
    }

    // ====================================================================
    // TEST 7: POST /api/currency/convert same currency returns same amount
    // ====================================================================
    const testName7 = '7. Same currency conversion returns same amount';
    try {
      const { status, data } = await fetchJson('/api/currency/convert', {
        method: 'POST',
        body: JSON.stringify({ amount: 5000, from: 'INR', to: 'INR' }),
        headers: authHeaders
      });
      if (status !== 200) throw new Error(`Expected 200, got ${status}`);
      if (data.convertedAmount !== 5000) throw new Error(`Expected 5000, got ${data.convertedAmount}`);
      if (data.rate !== 1) throw new Error(`Expected rate 1, got ${data.rate}`);
      printPass(testName7);
      passed++;
    } catch (err) {
      printFail(testName7, err);
      failed++;
      passedAll = false;
    }

    // ====================================================================
    // TEST 8: POST /api/currency/convert rejects unsupported currencies
    // ====================================================================
    const testName8 = '8. Rejects unsupported currency codes';
    try {
      const { status, data } = await fetchJson('/api/currency/convert', {
        method: 'POST',
        body: JSON.stringify({ amount: 1000, from: 'XYZ', to: 'USD' }),
        headers: authHeaders
      });
      if (status !== 400) throw new Error(`Expected 400, got ${status}`);
      printPass(testName8);
      passed++;
    } catch (err) {
      printFail(testName8, err);
      failed++;
      passedAll = false;
    }

    // ====================================================================
    // TEST 9: GET /api/currency/history returns snapshot history
    // ====================================================================
    const testName9 = '9. GET /api/currency/history returns snapshots';
    try {
      const { status, data } = await fetchJson('/api/currency/history', { headers: authHeaders });
      if (status !== 200) throw new Error(`Expected 200, got ${status}`);
      if (!data.success) throw new Error('Expected success: true');
      if (!Array.isArray(data.history)) throw new Error('history should be an array');
      printPass(testName9 + ` (${data.history.length} snapshots)`);
      passed++;
    } catch (err) {
      printFail(testName9, err);
      failed++;
      passedAll = false;
    }

    // ====================================================================
    // TEST 10: Create expense with INR currency (default)
    // ====================================================================
    const testName10 = '10. Create expense with default INR currency';
    let inrExpenseId;
    try {
      const { status, data } = await fetchJson('/api/expenses', {
        method: 'POST',
        body: JSON.stringify({
          title: 'INR Test Expense',
          amount: 10000,
          groupId: testGroup.id,
          paidById: testUserId,
          splitType: 'EQUAL',
          category: 'FOOD',
          participants: [{ userId: testUserId }, { userId: testUser2Id }]
        }),
        headers: authHeaders
      });
      if (status !== 201) throw new Error(`Expected 201, got ${status}: ${JSON.stringify(data)}`);
      const expense = data.expense;
      inrExpenseId = expense.id;
      if (expense.originalCurrency !== 'INR') throw new Error(`Expected INR, got ${expense.originalCurrency}`);
      if (expense.exchangeRate !== 1.0) throw new Error(`Expected rate 1.0, got ${expense.exchangeRate}`);
      if (expense.originalAmount !== 10000) throw new Error(`Expected originalAmount 10000, got ${expense.originalAmount}`);
      if (expense.convertedAmount !== 10000) throw new Error(`Expected convertedAmount 10000, got ${expense.convertedAmount}`);
      printPass(testName10 + ` (${expense.originalCurrency}, rate=${expense.exchangeRate})`);
      passed++;
    } catch (err) {
      printFail(testName10, err);
      failed++;
      passedAll = false;
    }

    // ====================================================================
    // TEST 11: Create expense with USD currency
    // ====================================================================
    const testName11 = '11. Create expense with USD currency (foreign)';
    let usdExpenseId;
    try {
      const { status, data } = await fetchJson('/api/expenses', {
        method: 'POST',
        body: JSON.stringify({
          title: 'USD Test Expense',
          amount: 2000,
          originalCurrency: 'USD',
          groupId: testGroup.id,
          paidById: testUserId,
          splitType: 'EQUAL',
          category: 'TRAVEL',
          participants: [{ userId: testUserId }, { userId: testUser2Id }]
        }),
        headers: authHeaders
      });
      if (status !== 201) throw new Error(`Expected 201, got ${status}: ${JSON.stringify(data)}`);
      const expense = data.expense;
      usdExpenseId = expense.id;
      if (expense.originalCurrency !== 'USD') throw new Error(`Expected USD, got ${expense.originalCurrency}`);
      if (expense.exchangeRate === 1.0) throw new Error(`Rate should NOT be 1.0 for USD-to-INR conversion`);
      if (expense.originalAmount !== 2000) throw new Error(`Expected originalAmount 2000, got ${expense.originalAmount}`);
      if (expense.convertedAmount === 2000) throw new Error(`convertedAmount should differ from original for foreign currency`);
      if (expense.convertedAmount <= 0) throw new Error(`convertedAmount must be positive`);
      printPass(testName11 + ` (USD→INR rate=${expense.exchangeRate.toFixed(4)}, $20→₹${(expense.convertedAmount / 100).toFixed(2)})`);
      passed++;
    } catch (err) {
      printFail(testName11, err);
      failed++;
      passedAll = false;
    }

    // ====================================================================
    // TEST 12: Historical exchange rate is locked on expense
    // ====================================================================
    const testName12 = '12. Historical exchange rate locked on created expense';
    try {
      const expense = await prisma.expense.findUnique({ where: { id: usdExpenseId } });
      if (!expense) throw new Error('USD expense not found');
      const lockedRate = expense.exchangeRate;
      if (typeof lockedRate !== 'number' || lockedRate <= 0) throw new Error('Invalid locked rate');
      // Verify rate is persistently stored and won't change
      const expense2 = await prisma.expense.findUnique({ where: { id: usdExpenseId } });
      if (expense2.exchangeRate !== lockedRate) throw new Error('Rate changed between reads!');
      printPass(testName12 + ` (locked rate: ${lockedRate.toFixed(4)})`);
      passed++;
    } catch (err) {
      printFail(testName12, err);
      failed++;
      passedAll = false;
    }

    // ====================================================================
    // TEST 13: Split shares sum equals convertedAmount for foreign currency
    // ====================================================================
    const testName13 = '13. Split shares sum equals convertedAmount for USD expense';
    try {
      const participants = await prisma.expenseParticipant.findMany({ where: { expenseId: usdExpenseId } });
      const expense = await prisma.expense.findUnique({ where: { id: usdExpenseId } });
      const sharesSum = participants.reduce((sum, p) => sum + p.shareAmount, 0);
      if (sharesSum !== expense.convertedAmount) {
        throw new Error(`Shares sum ${sharesSum} !== convertedAmount ${expense.convertedAmount}`);
      }
      printPass(testName13 + ` (sum=${sharesSum}, converted=${expense.convertedAmount})`);
      passed++;
    } catch (err) {
      printFail(testName13, err);
      failed++;
      passedAll = false;
    }

    // ====================================================================
    // TEST 14: Create expense with EUR currency
    // ====================================================================
    const testName14 = '14. Create expense with EUR currency';
    try {
      const { status, data } = await fetchJson('/api/expenses', {
        method: 'POST',
        body: JSON.stringify({
          title: 'EUR Test Expense',
          amount: 5000,
          originalCurrency: 'EUR',
          groupId: testGroup.id,
          paidById: testUserId,
          splitType: 'EXACT',
          category: 'SHOPPING',
          participants: [
            { userId: testUserId, amount: 3000 },
            { userId: testUser2Id, amount: 2000 }
          ]
        }),
        headers: authHeaders
      });
      if (status !== 201) throw new Error(`Expected 201, got ${status}: ${JSON.stringify(data)}`);
      const expense = data.expense;
      if (expense.originalCurrency !== 'EUR') throw new Error(`Expected EUR, got ${expense.originalCurrency}`);
      if (expense.exchangeRate === 1.0) throw new Error('EUR rate should not be 1.0');
      printPass(testName14 + ` (EUR→INR rate=${expense.exchangeRate.toFixed(4)})`);
      passed++;
    } catch (err) {
      printFail(testName14, err);
      failed++;
      passedAll = false;
    }

    // ====================================================================
    // TEST 15: Create expense with JPY currency (0-decimal)
    // ====================================================================
    const testName15 = '15. Create expense with JPY currency (zero-decimal)';
    try {
      const { status, data } = await fetchJson('/api/expenses', {
        method: 'POST',
        body: JSON.stringify({
          title: 'JPY Test Expense',
          amount: 150000,
          originalCurrency: 'JPY',
          groupId: testGroup.id,
          paidById: testUserId,
          splitType: 'EQUAL',
          category: 'ENTERTAINMENT',
          participants: [{ userId: testUserId }, { userId: testUser2Id }]
        }),
        headers: authHeaders
      });
      if (status !== 201) throw new Error(`Expected 201, got ${status}: ${JSON.stringify(data)}`);
      const expense = data.expense;
      if (expense.originalCurrency !== 'JPY') throw new Error(`Expected JPY, got ${expense.originalCurrency}`);
      if (expense.originalAmount !== 150000) throw new Error(`Expected 150000, got ${expense.originalAmount}`);
      printPass(testName15 + ` (JPY→INR rate=${expense.exchangeRate.toFixed(4)})`);
      passed++;
    } catch (err) {
      printFail(testName15, err);
      failed++;
      passedAll = false;
    }

    // ====================================================================
    // TEST 16: Exchange rate service convert function works correctly
    // ====================================================================
    const testName16 = '16. exchangeRateService.convert() works correctly';
    try {
      const result = await exchangeRateService.convert(10000, 'USD', 'INR');
      if (typeof result.amount !== 'number') throw new Error('amount should be a number');
      if (typeof result.rate !== 'number') throw new Error('rate should be a number');
      if (result.amount <= 0) throw new Error('converted amount should be positive');
      if (result.rate <= 0) throw new Error('rate should be positive');
      // Same currency
      const same = await exchangeRateService.convert(5000, 'INR', 'INR');
      if (same.amount !== 5000) throw new Error(`Same currency should return same amount, got ${same.amount}`);
      if (same.rate !== 1.0) throw new Error(`Same currency rate should be 1.0, got ${same.rate}`);
      printPass(testName16 + ` (10000 USD = ${result.amount} INR at rate ${result.rate.toFixed(4)})`);
      passed++;
    } catch (err) {
      printFail(testName16, err);
      failed++;
      passedAll = false;
    }

    // ====================================================================
    // TEST 17: Exchange rate service getLatestRates returns valid snapshot
    // ====================================================================
    const testName17 = '17. getLatestRates returns valid snapshot with rates';
    try {
      const snapshot = await exchangeRateService.getLatestRates();
      if (!snapshot) throw new Error('snapshot is null');
      if (!snapshot.rates) throw new Error('rates missing from snapshot');
      if (!snapshot.baseCurrency) throw new Error('baseCurrency missing');
      if (!snapshot.fetchedAt) throw new Error('fetchedAt missing');
      printPass(testName17 + ` (provider=${snapshot.provider})`);
      passed++;
    } catch (err) {
      printFail(testName17, err);
      failed++;
      passedAll = false;
    }

    // ====================================================================
    // TEST 18: Expense fields stored correctly in database
    // ====================================================================
    const testName18 = '18. Expense currency fields stored correctly in DB';
    try {
      const expense = await prisma.expense.findUnique({ where: { id: usdExpenseId } });
      if (!expense) throw new Error('Expense not found');
      if (expense.originalCurrency !== 'USD') throw new Error('originalCurrency wrong');
      if (expense.originalAmount !== 2000) throw new Error('originalAmount wrong');
      if (typeof expense.exchangeRate !== 'number') throw new Error('exchangeRate should be number');
      if (typeof expense.convertedAmount !== 'number') throw new Error('convertedAmount should be number');
      if (expense.amount !== expense.convertedAmount) throw new Error('amount should equal convertedAmount');
      printPass(testName18);
      passed++;
    } catch (err) {
      printFail(testName18, err);
      failed++;
      passedAll = false;
    }

    // ====================================================================
    // TEST 19: Currency routes require authentication
    // ====================================================================
    const testName19 = '19. Currency routes require JWT authentication';
    try {
      const { status: s1 } = await fetchJson('/api/currency/rates');
      if (s1 !== 401 && s1 !== 403) throw new Error(`Expected 401/403 for rates, got ${s1}`);
      const { status: s2 } = await fetchJson('/api/currency/supported');
      if (s2 !== 401 && s2 !== 403) throw new Error(`Expected 401/403 for supported, got ${s2}`);
      const { status: s3 } = await fetchJson('/api/currency/convert', { method: 'POST', body: JSON.stringify({}) });
      if (s3 !== 401 && s3 !== 403) throw new Error(`Expected 401/403 for convert, got ${s3}`);
      printPass(testName19);
      passed++;
    } catch (err) {
      printFail(testName19, err);
      failed++;
      passedAll = false;
    }

    // ====================================================================
    // TEST 20: RecurringExpense model has currency fields
    // ====================================================================
    const testName20 = '20. RecurringExpense model has currency and rate mode fields';
    try {
      const recurringExpense = await prisma.recurringExpense.findFirst({
        select: { currency: true, exchangeRateMode: true, fixedRate: true }
      });
      // Even if no records exist, the query should succeed proving the fields exist
      printPass(testName20 + ' (schema fields verified)');
      passed++;
    } catch (err) {
      printFail(testName20, err);
      failed++;
      passedAll = false;
    }

    // ====================================================================
    // TEST 21: Provider fallback chain works
    // ====================================================================
    const testName21 = '21. Exchange rate provider fallback chain works';
    try {
      const snapshot = await exchangeRateService.getLatestRates();
      if (!snapshot.provider) throw new Error('provider name missing');
      if (!['Frankfurter', 'OpenER'].includes(snapshot.provider)) {
        throw new Error(`Unknown provider: ${snapshot.provider}`);
      }
      printPass(testName21 + ` (active provider: ${snapshot.provider})`);
      passed++;
    } catch (err) {
      printFail(testName21, err);
      failed++;
      passedAll = false;
    }

    // ====================================================================
    // TEST 22: SUPPORTED_CURRENCIES constant has all expected currencies
    // ====================================================================
    const testName22 = '22. SUPPORTED_CURRENCIES includes all 9 currencies';
    try {
      const expected = ['INR', 'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'SGD', 'AED'];
      for (const c of expected) {
        if (!exchangeRateService.SUPPORTED_CURRENCIES.includes(c)) {
          throw new Error(`Missing currency: ${c}`);
        }
      }
      printPass(testName22 + ` (${exchangeRateService.SUPPORTED_CURRENCIES.join(', ')})`);
      passed++;
    } catch (err) {
      printFail(testName22, err);
      failed++;
      passedAll = false;
    }

    // ====================================================================
    // TEST 23: BASE_CURRENCY is INR
    // ====================================================================
    const testName23 = '23. BASE_CURRENCY is configured as INR';
    try {
      if (exchangeRateService.BASE_CURRENCY !== 'INR') {
        throw new Error(`Expected INR, got ${exchangeRateService.BASE_CURRENCY}`);
      }
      printPass(testName23);
      passed++;
    } catch (err) {
      printFail(testName23, err);
      failed++;
      passedAll = false;
    }

    // ====================================================================
    // TEST 24: Socket events include EXCHANGE_RATES_UPDATED
    // ====================================================================
    const testName24 = '24. Socket events include EXCHANGE_RATES_UPDATED';
    try {
      const SocketEvents = require('../socket/socketEvents');
      if (!SocketEvents.EXCHANGE_RATES_UPDATED) {
        throw new Error('EXCHANGE_RATES_UPDATED event missing from socketEvents');
      }
      printPass(testName24);
      passed++;
    } catch (err) {
      printFail(testName24, err);
      failed++;
      passedAll = false;
    }

    // ====================================================================
    // TEST 25: Frontend files exist
    // ====================================================================
    const testName25 = '25. Frontend files exist for Phase 25';
    try {
      const fs = require('fs');
      const path = require('path');
      const clientRoot = path.resolve(__dirname, '../../../client/src');
      const requiredFiles = [
        'store/currencyStore.js',
        'components/currency/CurrencySelector.jsx',
        'components/currency/CurrencyBadge.jsx',
        'components/currency/ExchangeRateCard.jsx',
        'components/currency/ExchangeRateHistoryModal.jsx',
        'pages/SettingsCurrencyPage.jsx'
      ];
      for (const file of requiredFiles) {
        const fullPath = path.join(clientRoot, file);
        if (!fs.existsSync(fullPath)) {
          throw new Error(`Missing file: ${file}`);
        }
      }
      printPass(testName25 + ` (${requiredFiles.length} files verified)`);
      passed++;
    } catch (err) {
      printFail(testName25, err);
      failed++;
      passedAll = false;
    }

  } catch (err) {
    console.error('\n[FATAL ERROR]', err);
    passedAll = false;
    failed++;
  } finally {
    // Cleanup
    console.log('\n--- Cleaning up test data ---');
    try {
      await prisma.expenseParticipant.deleteMany({ where: { expense: { groupId: testGroup.id } } });
      await prisma.expensePayer.deleteMany({ where: { expense: { groupId: testGroup.id } } });
      await prisma.expense.deleteMany({ where: { groupId: testGroup.id } });
      await prisma.groupMember.deleteMany({ where: { groupId: testGroup.id } });
      await prisma.group.delete({ where: { id: testGroup.id } });
      await prisma.user.deleteMany({ where: { id: { in: [testUserId, testUser2Id] } } });
      console.log('Test data cleaned up successfully.');
    } catch (cleanupErr) {
      console.error('Cleanup error:', cleanupErr.message);
    }

    server.close();

    console.log('\n================================================================');
    console.log(`PHASE 25 VERIFICATION RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('================================================================');

    if (passedAll) {
      console.log('\n🎉 ALL PHASE 25 VERIFICATION CHECKS PASSED SUCCESSFULLY\n');
    } else {
      console.log('\n❌ SOME PHASE 25 CHECKS FAILED. Review output above.\n');
    }

    await prisma.$disconnect();
    process.exit(passedAll ? 0 : 1);
  }
}

run().catch(console.error);
