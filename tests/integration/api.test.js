// Mock Redis and Gemini before booting server
require('../utils/mockGemini');
require('../utils/mockSocket');

jest.mock('../../src/utils/redis', () => {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    status: 'ready',
    on: jest.fn(),
    quit: jest.fn().mockResolvedValue('OK')
  };
});

jest.mock('../../src/utils/cloudinary', () => {
  return {
    uploadToCloudinary: jest.fn().mockResolvedValue({
      secure_url: 'https://res.cloudinary.com/demo/image/upload/receipt.jpg',
      public_id: 'receipt_id_123'
    }),
    deleteFromCloudinary: jest.fn().mockResolvedValue({ result: 'ok' })
  };
});

// Configure ephemeral ports for parallel safety
process.env.PORT = '0';
process.env.SERVER_PORT = '0';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../src/server');
const prisma = require('../../src/utils/prisma');
const testFactory = require('../utils/testFactory');
const cleanupTestData = require('../utils/cleanupTestData');
const { validateContract } = require('../utils/contractValidator');

describe('Expense Split Engine - API Integration Tests', () => {
  let user1, user2, token1, token2, group;

  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    await cleanupTestData();

    // Create baseline test data
    user1 = await testFactory.createUser({ email: 'owner@api.com', name: 'Owner Api' });
    user2 = await testFactory.createUser({ email: 'admin@api.com', name: 'Admin Api' });

    token1 = jwt.sign({ id: user1.id, email: user1.email }, process.env.JWT_SECRET || 'test_secret');
    token2 = jwt.sign({ id: user2.id, email: user2.email }, process.env.JWT_SECRET || 'test_secret');

    group = await testFactory.createGroup(user1.id, { name: 'Trip Group' });
    await testFactory.addMember(group.id, user2.id, 'ADMIN');
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  // 1. Health & System endpoints
  describe('System & Health endpoints', () => {
    test('GET /health returns 200 UP', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      validateContract(res.body, 'success', { requiredKeys: ['status'] });
      expect(res.body.status).toBe('UP');
    });

    test('GET /ready returns database status check', async () => {
      const res = await request(app).get('/ready');
      expect(res.status).toBe(200);
      validateContract(res.body, 'success', { requiredKeys: ['components'] });
      expect(res.body.components.database).toBe('UP');
    });

    test('GET /metrics returns system runtime statistics', async () => {
      const res = await request(app).get('/metrics');
      expect(res.status).toBe(200);
      validateContract(res.body, 'success', { requiredKeys: ['uptime', 'memory'] });
    });

    test('GET /version returns current build release information', async () => {
      const res = await request(app).get('/version');
      expect(res.status).toBe(200);
      validateContract(res.body, 'success', { requiredKeys: ['appVersion'] });
      expect(res.body.appVersion).toBe('1.0.0');
    });
  });

  // 2. Authentication API Tests
  describe('Authentication Routes', () => {
    test('POST /api/auth/register creates user and returns tokens', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'New Registered User',
          email: 'register@api.com',
          password: 'securePassword123'
        });

      expect(res.status).toBe(201);
      validateContract(res.body, 'success', { requiredKeys: ['user', 'accessToken'] });
      expect(res.body.user).toBeDefined();
    });

    test('POST /api/auth/login validates credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'owner@api.com',
          password: 'password123'
        });

      expect(res.status).toBe(200);
      validateContract(res.body, 'success', { requiredKeys: ['accessToken'] });
    });

    test('GET /api/auth/me returns current authenticated user details', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token1}`);

      expect(res.status).toBe(200);
      validateContract(res.body, 'success', { requiredKeys: ['user'] });
      expect(res.body.user.email).toBe('owner@api.com');
    });
  });

  // 3. Groups & Admin Permissions API Tests
  describe('Groups & Administration APIs', () => {
    test('POST /api/groups creates group and binds creator as owner', async () => {
      const res = await request(app)
        .post('/api/groups')
        .set('Authorization', `Bearer ${token1}`)
        .send({
          name: 'Weekend Getaway',
          description: 'Expenses for weekend trip'
        });

      expect(res.status).toBe(201);
      validateContract(res.body, 'success', { requiredKeys: ['group'] });
      expect(res.body.group.name).toBe('Weekend Getaway');
    });

    test('PATCH /api/groups/:groupId/members/:memberId/promote increases roles to ADMIN', async () => {
      const user3 = await testFactory.createUser({ email: 'promo@api.com' });
      const membership = await testFactory.addMember(group.id, user3.id, 'MEMBER');

      const res = await request(app)
        .patch(`/api/groups/${group.id}/members/${user3.id}/promote`)
        .set('Authorization', `Bearer ${token1}`)
        .set('If-Match', String(group.version))
        .send();

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const updated = await prisma.groupMember.findUnique({ where: { id: membership.id } });
      expect(updated.role).toBe('ADMIN');
    });
  });

  // 4. Expense API Tests
  describe('Expense APIs', () => {
    test('POST /api/expenses creates transaction and calculates splits', async () => {
      const res = await request(app)
        .post('/api/expenses')
        .set('Authorization', `Bearer ${token1}`)
        .send({
          title: 'Dinner bill',
          amount: 4000,
          groupId: group.id,
          splitType: 'EQUAL',
          category: 'FOOD',
          originalCurrency: 'INR',
          paidById: user1.id,
          participants: [
            { userId: user1.id },
            { userId: user2.id }
          ]
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      validateContract(res.body, 'success', { requiredKeys: ['expense'] });
    });

    test('GET /api/expenses/:id returns single expense record', async () => {
      const expense = await testFactory.createExpense(group.id, user1.id, {
        amount: 3000,
        splitType: 'EQUAL',
        paidById: user1.id,
        participants: [
          { userId: user1.id, shareAmount: 1500 },
          { userId: user2.id, shareAmount: 1500 }
        ]
      });

      const res = await request(app)
        .get(`/api/expenses/${expense.id}`)
        .set('Authorization', `Bearer ${token1}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.expense.id).toBe(expense.id);
    });
  });

  // 5. Budgets & Analytics APIs
  describe('Budgets & Analytics API endpoints', () => {
    test('POST /api/v1/budgets creates and restricts budget limits', async () => {
      const res = await request(app)
        .post('/api/v1/budgets')
        .set('Authorization', `Bearer ${token1}`)
        .send({
          groupId: group.id,
          category: 'FOOD',
          amount: 15000,
          currency: 'INR',
          period: 'MONTHLY'
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.budget.category).toBe('FOOD');
    });

    test('GET /api/v1/analytics/dashboard returns calculated metrics', async () => {
      const res = await request(app)
        .get('/api/v1/analytics/dashboard')
        .set('Authorization', `Bearer ${token1}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalExpenses).toBeDefined();
    });

    test('GET /api/v1/analytics/forecast returns projected spends', async () => {
      const res = await request(app)
        .get(`/api/v1/analytics/forecast?groupId=${group.id}`)
        .set('Authorization', `Bearer ${token1}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.trend).toBeDefined();
    });
  });

  // 6. AI & OCR APIs
  describe('AI Insights & Receipt OCR APIs', () => {
    test('POST /api/ai/categorize-receipt processes OCR strings', async () => {
      const res = await request(app)
        .post('/api/ai/categorize-receipt')
        .set('Authorization', `Bearer ${token1}`)
        .send({
          rawText: "Dinner Starbucks Total: 45.00 INR"
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.suggestion.category).toBe('FOOD');
    });
  });
});
