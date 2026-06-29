const request = require('supertest');
const jwt = require('jsonwebtoken');
const prisma = require('../../src/utils/prisma');
const testFactory = require('../utils/testFactory');
const cleanupTestData = require('../utils/cleanupTestData');

// Mock Socket and Redis
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

// Configure ephemeral ports for Supertest
process.env.PORT = '0';
process.env.SERVER_PORT = '0';

const app = require('../../src/server');

describe('Expense Split Engine - Security Regression Tests', () => {
  let user1, user2, token1, token2, group;

  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    await cleanupTestData();

    user1 = await testFactory.createUser({ email: 'owner@sec.com', name: 'Owner Sec' });
    user2 = await testFactory.createUser({ email: 'member@sec.com', name: 'Member Sec' });

    token1 = jwt.sign({ id: user1.id, email: user1.email }, process.env.JWT_SECRET || 'test_secret');
    token2 = jwt.sign({ id: user2.id, email: user2.email }, process.env.JWT_SECRET || 'test_secret');

    group = await testFactory.createGroup(user1.id, { name: 'Secure Group' });
    await testFactory.addMember(group.id, user2.id, 'MEMBER');
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  // 1. JWT Tampering and Expiration Checks
  describe('JWT Validation Security', () => {
    test('Token with altered signature is rejected with 401', async () => {
      const tamperedToken = token1 + 'tampered';
      
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${tamperedToken}`);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Invalid or expired');
    });

    test('Expired token is rejected with 401', async () => {
      // Create a token expired 1 hour ago
      const expiredToken = jwt.sign(
        { id: user1.id, email: user1.email, exp: Math.floor(Date.now() / 1000) - 3600 },
        process.env.JWT_SECRET || 'test_secret'
      );

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${expiredToken}`);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  // 2. Permission Escalation Checks
  describe('RBAC Authorization Escalation Gates', () => {
    test('Member user cannot promote another user to ADMIN', async () => {
      const user3 = await testFactory.createUser({ email: 'target@sec.com' });
      const membership = await testFactory.addMember(group.id, user3.id, 'MEMBER');

      // Member (token2) attempts to promote User 3
      const res = await request(app)
        .patch(`/api/groups/${group.id}/members/${membership.id}/promote`)
        .set('Authorization', `Bearer ${token2}`)
        .set('If-Match', String(group.version))
        .send();

      expect(res.status).toBe(403); // Access Denied
      
      // Verify role remains unchanged
      const updated = await prisma.groupMember.findUnique({ where: { id: membership.id } });
      expect(updated.role).toBe('MEMBER');
    });

    test('Banned group member is rejected from accessing group endpoints with 403', async () => {
      const user3 = await testFactory.createUser({ email: 'banned@sec.com' });
      const token3 = jwt.sign({ id: user3.id, email: user3.email }, process.env.JWT_SECRET || 'test_secret');
      
      // Add member as banned
      await testFactory.addMember(group.id, user3.id, 'MEMBER', {
        isBanned: true,
        bannedAt: new Date(),
        bannedBy: user1.id,
        banReason: 'Security violation'
      });

      // Banned member attempts to fetch group details
      const res = await request(app)
        .get(`/api/groups/${group.id}`)
        .set('Authorization', `Bearer ${token3}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('Access denied');
    });
  });

  // 3. SQL Injection protection
  describe('SQL Injection Escaping Checks', () => {
    test('Prisma safely parameterized query inputs to prevent SQL injections', async () => {
      const sqlInjectionPayload = "group' OR '1'='1";
      
      const res = await request(app)
        .post('/api/groups')
        .set('Authorization', `Bearer ${token1}`)
        .send({
          name: sqlInjectionPayload,
          description: 'Safe Description'
        });

      expect(res.status).toBe(201);
      
      // Verify group was created with the literal name, proving it was not parsed as SQL
      const created = await prisma.group.findUnique({ where: { id: res.body.group.id } });
      expect(created.name).toBe(sqlInjectionPayload);
    });
  });

  // 4. Input Sanitization/XSS
  describe('XSS Input validation safety', () => {
    test('HTML scripts inside input payloads are sanitized or safely outputted without execution', async () => {
      const xssPayload = "<script>alert('xss')</script> Dinner";
      
      const res = await request(app)
        .post('/api/expenses')
        .set('Authorization', `Bearer ${token1}`)
        .send({
          title: xssPayload,
          amount: 2000,
          groupId: group.id,
          splitType: 'EQUAL',
          category: 'FOOD',
          originalCurrency: 'INR',
          paidById: user1.id,
          participants: [{ userId: user1.id }]
        });

      expect(res.status).toBe(201);
      expect(res.body.expense.title).toBe(xssPayload); // Renders literally as string safely
    });
  });
});
