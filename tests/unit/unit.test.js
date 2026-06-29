// Mock external dependencies before requiring services
require('../utils/mockGemini');
require('../utils/mockSocket');

// Mock Redis to avoid actual network calls during tests
jest.mock('../../src/utils/redis', () => {
  const mockClient = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    status: 'ready',
    on: jest.fn(),
    quit: jest.fn().mockResolvedValue('OK')
  };
  return mockClient;
});

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const prisma = require('../../src/utils/prisma');
const testFactory = require('../utils/testFactory');
const cleanupTestData = require('../utils/cleanupTestData');

// Import services and helpers
const permissionService = require('../../src/services/permissionService');
const exchangeRateService = require('../../src/services/exchangeRateService');
const { authenticateToken } = require('../../src/middleware/authMiddleware');
const settlementService = require('../../src/services/settlementService');
const forecastService = require('../../src/services/forecastService');
const expenseService = require('../../src/services/expenseService');
const aiInsightsService = require('../../src/services/aiInsightsService');
const aiCategorizationService = require('../../src/services/aiCategorizationService');
const budgetService = require('../../src/services/budgetService');
const recurringExpenseService = require('../../src/services/recurringExpenseService');
const env = require('../../src/utils/envValidator');
const { logger } = require('../../src/utils/logger');
const analyticsCache = require('../../src/utils/analyticsCache');

describe('Expense Split Engine - Unit Tests', () => {
  let user1, user2, user3, group;

  beforeAll(async () => {
    // Sync DB schema and establish baseline
    await prisma.$connect();
    jest.retryTimes(2);
  });

  beforeEach(async () => {
    await cleanupTestData();
    
    // Seed common user/group mocks
    user1 = await testFactory.createUser({ email: 'owner@test.com', name: 'Owner User' });
    user2 = await testFactory.createUser({ email: 'admin@test.com', name: 'Admin User' });
    user3 = await testFactory.createUser({ email: 'member@test.com', name: 'Member User' });
    
    group = await testFactory.createGroup(user1.id, { name: 'Splitwise Group' });
    await testFactory.addMember(group.id, user2.id, 'ADMIN');
    await testFactory.addMember(group.id, user3.id, 'MEMBER');
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  // 1. Environment & Utility Tests
  describe('Environment & Logger Utilities', () => {
    test('Environment Validator parses configurations cleanly', () => {
      expect(env.BASE_CURRENCY).toBe('INR');
      expect(env.APP_VERSION).toBe('1.0.0');
    });

    test('Pino Logger creates child context logger instances', () => {
      const childLogger = logger.child({ customParam: 'test' });
      expect(childLogger).toBeDefined();
      expect(childLogger.info).toBeDefined();
    });

    test('In-memory Analytics Cache stores and invalidates user cache entries', () => {
      analyticsCache.set(user1.id, '/dashboard', {}, { total: 100 });
      const cached = analyticsCache.get(user1.id, '/dashboard', {});
      expect(cached).toEqual({ total: 100 });

      analyticsCache.invalidateUserCache(user1.id);
      const invalidated = analyticsCache.get(user1.id, '/dashboard', {});
      expect(invalidated).toBeNull();
      
      const metrics = analyticsCache.getMetrics();
      expect(metrics.cacheSize).toBeDefined();
    });

    // Simulated flaky test to check that retries work and report flakiness
    let flakyCounter = 0;
    test('Simulated Flaky Test for detection assertions', () => {
      flakyCounter++;
      if (flakyCounter === 1) {
        throw new Error('Simulated transient error');
      }
      expect(flakyCounter).toBe(2);
    });
  });

  // 2. Auth & JWT Tests
  describe('Authentication & JWT middlewares', () => {
    test('authenticateToken middleware rejects requests without tokens', () => {
      const req = { headers: {} };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      authenticateToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, message: expect.stringContaining('Access Denied') })
      );
      expect(next).not.toHaveBeenCalled();
    });

    test('authenticateToken middleware rejects expired or tampered tokens', () => {
      const req = { headers: { authorization: 'Bearer invalid_secret_token_12345' } };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      authenticateToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, message: expect.stringContaining('Invalid or expired') })
      );
      expect(next).not.toHaveBeenCalled();
    });

    test('authenticateToken middleware accepts valid tokens and populates user context', () => {
      const token = jwt.sign({ id: user1.id, email: user1.email }, process.env.JWT_SECRET || 'test_secret');
      const req = { headers: { authorization: `Bearer ${token}` } };
      const res = {};
      const next = jest.fn();

      authenticateToken(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user).toBeDefined();
      expect(req.user.id).toBe(user1.id);
    });
  });

  // 3. Permission Service (RBAC) Tests
  describe('RBAC Permissions Gate Service', () => {
    test('Owner user has maximum role clearances', async () => {
      expect(await permissionService.hasPermission(group.id, user1.id, 'ADMIN')).toBe(true);
      expect(await permissionService.hasPermission(group.id, user2.id, 'MEMBER')).toBe(true);
      expect(await permissionService.hasPermission(group.id, user3.id, 'OWNER')).toBe(false);

      expect(await permissionService.canRemoveMember(group.id, user2.id, user1.id)).toBe(true);
      expect(await permissionService.canTransferOwnership(group.id, user1.id)).toBe(true);
    });

    test('Member user cannot Demote or Ban Owners or Peers', async () => {
      expect(await permissionService.canRemoveMember(group.id, user2.id, user3.id)).toBe(false);
      expect(await permissionService.canRemoveMember(group.id, user1.id, user3.id)).toBe(false);
    });

    test('Admin user can Demote/Remove Members, but not Owners or peers', async () => {
      expect(await permissionService.canRemoveMember(group.id, user3.id, user2.id)).toBe(true);
      expect(await permissionService.canRemoveMember(group.id, user1.id, user2.id)).toBe(false);
    });
  });

  // 4. Currency Engine & Exchange Rates
  describe('Multi-Currency Engine', () => {
    test('Converts currencies using rates accurately', async () => {
      // Create a fresh snapshot in the database so that getLatestRates picks it up immediately
      await prisma.exchangeRateSnapshot.create({
        data: {
          baseCurrency: 'INR',
          provider: 'MockProvider',
          fetchedAt: new Date(),
          rates: {
            INR: 1.0,
            USD: 0.012,
            EUR: 0.011
          }
        }
      });
      
      const amountInUSD = 100; // $100.00
      const converted = await exchangeRateService.convert(amountInUSD * 100, 'USD', 'INR');
      expect(converted.amount).toBe(833333); // 10000 / 0.012 = 833333
    });

    test('Currency conversion handles base-to-base conversion quickly', async () => {
      const conversion = await exchangeRateService.convert(5000, 'INR', 'INR');
      expect(conversion.amount).toBe(5000);
      expect(conversion.rate).toBe(1.0);
    });
  });

  // 5. Split Algorithms
  describe('Expense Split Engine Algorithms', () => {
    test('EQUAL Split divides amount evenly and resolves remainder rounding cents', async () => {
      const expense = await expenseService.createExpense(user1.id, {
        title: 'Lunch Split',
        amount: 1000,
        groupId: group.id,
        splitType: 'EQUAL',
        category: 'FOOD',
        originalCurrency: 'INR',
        paidById: user1.id,
        participants: [
          { userId: user1.id },
          { userId: user2.id },
          { userId: user3.id }
        ]
      });

      expect(expense.participants).toHaveLength(3);
      
      const share1 = expense.participants.find(p => p.userId === user1.id).shareAmount;
      const share2 = expense.participants.find(p => p.userId === user2.id).shareAmount;
      const share3 = expense.participants.find(p => p.userId === user3.id).shareAmount;

      expect(share1 + share2 + share3).toBe(1000);
      
      const sortedShares = [share1, share2, share3].sort();
      expect(sortedShares[0]).toBe(333);
      expect(sortedShares[1]).toBe(333);
      expect(sortedShares[2]).toBe(334);
    });

    test('EXACT Split verifies sum equals the total amount', async () => {
      await expect(
        expenseService.createExpense(user1.id, {
          title: 'Rent exact',
          amount: 5000,
          groupId: group.id,
          splitType: 'EXACT',
          category: 'RENT',
          originalCurrency: 'INR',
          paidById: user1.id,
          participants: [
            { userId: user1.id, amount: 2000 },
            { userId: user2.id, amount: 2000 },
            { userId: user3.id, amount: 500 } // total 4500 !== 5000
          ]
        })
      ).rejects.toThrow('Sum of exact amounts');
    });

    test('PERCENTAGE Split validates sum matches 100%', async () => {
      await expect(
        expenseService.createExpense(user1.id, {
          title: 'Movie split',
          amount: 3000,
          groupId: group.id,
          splitType: 'PERCENTAGE',
          category: 'ENTERTAINMENT',
          originalCurrency: 'INR',
          paidById: user1.id,
          participants: [
            { userId: user1.id, percentage: 40 },
            { userId: user2.id, percentage: 40 },
            { userId: user3.id, percentage: 30 } // total 110%
          ]
        })
      ).rejects.toThrow('Sum of percentages must equal exactly 100');
    });

    test('SHARE Split calculates shares proportionally', async () => {
      const expense = await expenseService.createExpense(user1.id, {
        title: 'Cab ride share',
        amount: 6000,
        groupId: group.id,
        splitType: 'SHARE',
        category: 'TRAVEL',
        originalCurrency: 'INR',
        paidById: user1.id,
        participants: [
          { userId: user1.id, shares: 3 },
          { userId: user2.id, shares: 2 },
          { userId: user3.id, shares: 1 }
        ]
      });

      expect(expense.participants.find(p => p.userId === user1.id).shareAmount).toBe(3000);
      expect(expense.participants.find(p => p.userId === user2.id).shareAmount).toBe(2000);
      expect(expense.participants.find(p => p.userId === user3.id).shareAmount).toBe(1000);
    });

    test('MULTI_PAYER splits sum checks and validation', async () => {
      await expect(
        expenseService.createExpense(user1.id, {
          title: 'Heavy food bill',
          amount: 10000,
          groupId: group.id,
          splitType: 'MULTI_PAYER',
          category: 'FOOD',
          originalCurrency: 'INR',
          payers: [
            { userId: user1.id, amount: -100 }, // invalid negative amount
            { userId: user2.id, amount: 10100 }
          ],
          participants: [
            { userId: user1.id },
            { userId: user2.id }
          ]
        })
      ).rejects.toThrow('Payer amount must be a positive integer');
    });
  });

  // 6. Settlement Optimizer
  describe('Settlement Optimizer Service', () => {
    test('Greedily minimizes balances and returns transaction list', async () => {
      // User 1 owes User 2, User 2 owes User 3
      // User 1 balance = -1000 (debtor)
      // User 2 balance = 0 (settled)
      // User 3 balance = 1000 (creditor)
      // Optimizer outputs direct transaction User 1 -> User 3 (1 transaction instead of 2)
      await testFactory.createExpense(group.id, user2.id, {
        amount: 3000,
        splitType: 'EQUAL',
        paidById: user2.id,
        participants: [
          { userId: user1.id, shareAmount: 1500 },
          { userId: user2.id, shareAmount: 1500 }
        ]
      });

      await testFactory.createExpense(group.id, user3.id, {
        amount: 3000,
        splitType: 'EQUAL',
        paidById: user3.id,
        participants: [
          { userId: user2.id, shareAmount: 1500 },
          { userId: user3.id, shareAmount: 1500 }
        ]
      });

      const settlements = await settlementService.generateSettlements(group.id, user1.id);
      
      expect(settlements.settlements).toBeDefined();
      expect(settlements.summary.totalTransactions).toBe(1);
      expect(settlements.settlements[0].payer.id).toBe(user1.id);
      expect(settlements.settlements[0].payee.id).toBe(user3.id);
      expect(settlements.settlements[0].amount).toBe(1500);
    });
  });

  // 7. Budget & Alerts Cooldown
  describe('Budget & Alerts Service', () => {
    test('Cooldown prevents budget notifications from resending multiple times', async () => {
      const budget = await testFactory.createBudget(user3.id, group.id, {
        category: 'FOOD',
        limit: 1000, // 10.00 limit
      });

      // Add expense exceeding 90% (e.g. 950 spent)
      await testFactory.createExpense(group.id, user3.id, {
        amount: 950,
        category: 'FOOD',
        paidById: user3.id,
        participants: [{ userId: user3.id, shareAmount: 950 }]
      });

      // Triggers alert 90%
      await budgetService.checkBudgetAlerts(user3.id, group.id, 'FOOD');
      
      const dbBudget = await prisma.budget.findUnique({ where: { id: budget.id } });
      expect(dbBudget.alertMetadata).toBeDefined();
      expect(JSON.stringify(dbBudget.alertMetadata)).toContain('90');

      // Attempting check again should skip due to cooldown (alert list length remains 1)
      await budgetService.checkBudgetAlerts(user3.id, group.id, 'FOOD');
      const dbBudgetAfter = await prisma.budget.findUnique({ where: { id: budget.id } });
      const now = new Date();
      const periodKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
      const sent = dbBudgetAfter.alertMetadata?.sentAlerts?.[periodKey] || [];
      expect(sent.filter(x => x === 90)).toHaveLength(1);
    });
  });

  // 8. Forecasting & Analytics
  describe('Forecasting & Analytics Service', () => {
    test('Forecast service computes linear regressions, exhaustion dates, and daily averages', async () => {
      // Seed daily expenses to build history
      const historyList = [];
      const now = new Date();
      for (let i = 10; i >= 1; i--) {
        const d = new Date();
        d.setDate(now.getDate() - i);
        historyList.push({
          amount: 500, // 5.00 INR
          createdAt: d
        });
      }

      const summary = forecastService.calculateLinearRegression(historyList, 10000); // 100.00 limit
      expect(summary.trend).toBeDefined();
      expect(summary.expectedDailyAverage).toBe(500);
      expect(summary.expectedMonthlySpend).toBe(15000);
      expect(summary.estimatedRemainingDays).toBeGreaterThan(0);
    });
  });

  // 9. AI Insights & Categorization
  describe('AI Insights & Receipt Categorization Services', () => {
    test('AI Insights aggregates monthly categories and suggests budgets', async () => {
      // Add expenses to create spending history
      await testFactory.createExpense(group.id, user1.id, {
        amount: 3000,
        category: 'FOOD',
        paidById: user1.id,
        participants: [{ userId: user1.id, shareAmount: 3000 }]
      });

      const insights = await aiInsightsService.getAISpendingInsights(user1.id);
      expect(insights.success).toBe(true);
      expect(insights.summary).toBeDefined();
      expect(insights.recommendations).toHaveLength(3);
    });

    test('AI Categorizer extracts data from raw OCR texts', async () => {
      const response = await aiCategorizationService.categorizeReceipt("Starbucks Cafe \nTotal: 15.00 USD", user1.id);
      expect(response.success).toBe(true);
      expect(response.suggestion.category).toBe('FOOD');
      expect(response.suggestion.merchant).toBe('Starbucks');
    });
  });

  // 10. Recurring Expenses & miss execution recovery
  describe('Recurring Scheduler & Templates recovery', () => {
    test('Recurring service processes scheduled templates and schedules next run', async () => {
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 2); // 2 months ago

      const template = await testFactory.createRecurringExpense(group.id, user1.id, {
        amount: 1500,
        interval: 'MONTHLY',
        startDate,
        nextRunAt: startDate // due 2 months ago
      });

      // Run scheduler processor
      await recurringExpenseService.processDueRecurringExpenses();
      const stats = recurringExpenseService.schedulerMetrics;
      expect(stats.totalProcessed).toBeGreaterThanOrEqual(1);

      // Verify that nextRunAt was updated to future
      const updated = await prisma.recurringExpense.findUnique({ where: { id: template.id } });
      expect(new Date(updated.nextRunAt).getTime()).toBeGreaterThan(Date.now());
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });
});
