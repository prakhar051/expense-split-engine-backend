require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const prisma = require('../utils/prisma');
const { startRecurringScheduler, getSchedulerHealth } = require('../scheduler/recurringScheduler');
const recurringService = require('../services/recurringExpenseService');

const TEST_PORT = 5055;
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
  console.log('PHASE 24 RECURRING EXPENSES & SCHEDULER VERIFICATION CHECKS');
  console.log('================================================================\n');

  let passedAll = true;

  // Initialize test server
  const app = express();
  app.use(express.json());

  // Mount routes
  const recurringRoutes = require('../routes/recurringExpenseRoutes');
  const groupRoutes = require('../routes/groupRoutes');
  app.use('/api/recurring', recurringRoutes);
  app.use('/api/groups', groupRoutes);

  // Centralized error handler
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ success: false, message: err.message });
  });

  const server = http.createServer(app);

  await new Promise((resolve) => {
    server.listen(TEST_PORT, () => {
      console.log(`[Test Server] Started listening on port ${TEST_PORT}\n`);
      resolve();
    });
  });

  // Create test credentials
  const testUserId = crypto.randomUUID();
  const testUserEmail = `scheduler-test-${Date.now()}@example.com`;
  const validToken = jwt.sign({ id: testUserId, email: testUserEmail }, JWT_SECRET, { expiresIn: '1h' });
  const authHeader = { 'Authorization': `Bearer ${validToken}` };

  let testGroupId = crypto.randomUUID();

  try {
    // 1. Seed database with User & Group for test scope
    await prisma.user.create({
      data: {
        id: testUserId,
        name: 'Scheduler Tester',
        email: testUserEmail,
        password: 'hashedpw'
      }
    });

    await prisma.group.create({
      data: {
        id: testGroupId,
        name: 'Scheduler Test Group',
        description: 'Test group desc',
        createdById: testUserId
      }
    });

    await prisma.groupMember.create({
      data: {
        groupId: testGroupId,
        userId: testUserId,
        role: 'OWNER'
      }
    });

    printPass('Database environment seeded successfully');
  } catch (err) {
    printFail('Database environment seeded successfully', err);
    passedAll = false;
  }

  // 2. Scheduler lock helper abstraction test
  try {
    const lock1 = await recurringService.acquireSchedulerLock();
    const lock2 = await recurringService.acquireSchedulerLock();
    await recurringService.releaseSchedulerLock();
    const lock3 = await recurringService.acquireSchedulerLock();
    await recurringService.releaseSchedulerLock();

    if (lock1 === true && lock2 === false && lock3 === true) {
      printPass('Distributed Lock Abstraction (In-Memory Helper)');
    } else {
      throw new Error(`Lock states were not expected: lock1=${lock1}, lock2=${lock2}, lock3=${lock3}`);
    }
  } catch (err) {
    printFail('Distributed Lock Abstraction (In-Memory Helper)', err);
    passedAll = false;
  }

  // 3. Scheduler singleton initialization test
  try {
    const init1 = startRecurringScheduler();
    const init2 = startRecurringScheduler();

    if (init1 && init2 && init1.cronJobMinute === init2.cronJobMinute) {
      printPass('Scheduler Singleton Initialization Check');
    } else {
      throw new Error('Duplicate initialization did not return the original instance refs');
    }
  } catch (err) {
    printFail('Scheduler Singleton Initialization Check', err);
    passedAll = false;
  }

  // 4. Timezone-safe UTC calculations check
  try {
    const base = new Date('2026-03-08T00:00:00Z'); // DST shift boundary in some timezones
    const nextDaily = recurringService.calculateNextRun(base, 'DAILY', 1);
    const nextWeekly = recurringService.calculateNextRun(base, 'WEEKLY', 2);
    const nextMonthly = recurringService.calculateNextRun(base, 'MONTHLY', 1);
    const nextYearly = recurringService.calculateNextRun(base, 'YEARLY', 1);

    const isDailyOk = nextDaily.toISOString() === '2026-03-09T00:00:00.000Z';
    const isWeeklyOk = nextWeekly.toISOString() === '2026-03-22T00:00:00.000Z';
    const isMonthlyOk = nextMonthly.toISOString() === '2026-04-08T00:00:00.000Z';
    const isYearlyOk = nextYearly.toISOString() === '2027-03-08T00:00:00.000Z';

    if (isDailyOk && isWeeklyOk && isMonthlyOk && isYearlyOk) {
      printPass('UTC Timezone-safe execution date calculations');
    } else {
      throw new Error(`Calculations mismatch: Daily=${nextDaily.toISOString()}, Weekly=${nextWeekly.toISOString()}, Monthly=${nextMonthly.toISOString()}, Yearly=${nextYearly.toISOString()}`);
    }
  } catch (err) {
    printFail('UTC Timezone-safe execution date calculations', err);
    passedAll = false;
  }

  // 5. REST API CRUD & Soft Delete Verification
  let createdTemplateId = null;
  try {
    // A. Create Template
    const createPayload = {
      title: 'Rent Bill',
      description: 'Auto-monthly rent payment',
      amount: 150000, // $1500.00
      category: 'RENT',
      splitType: 'EQUAL',
      recurrenceType: 'MONTHLY',
      interval: 1,
      startDate: new Date('2026-07-01T00:00:00Z').toISOString(),
      payload: {
        groupId: testGroupId,
        title: 'Rent Bill',
        amount: 150000,
        category: 'RENT',
        splitType: 'EQUAL',
        participants: [{ userId: testUserId }],
        paidById: testUserId
      }
    };

    const resCreate = await fetchJson(`/api/groups/${testGroupId}/recurring`, {
      method: 'POST',
      headers: authHeader,
      body: JSON.stringify(createPayload)
    });

    if (resCreate.status === 201 && resCreate.data.template.id) {
      createdTemplateId = resCreate.data.template.id;
      printPass('CRUD - Create Recurring Template');
    } else {
      throw new Error(`Create returned status ${resCreate.status}: ${JSON.stringify(resCreate.data)}`);
    }

    // B. Optimistic Concurrency Update
    const updatePayload = {
      title: 'Updated Rent Bill',
      amount: 160000,
      category: 'RENT',
      splitType: 'EQUAL',
      recurrenceType: 'MONTHLY',
      interval: 1,
      startDate: new Date('2026-07-01T00:00:00Z').toISOString(),
      isActive: true,
      version: 1, // Correct version
      payload: {
        groupId: testGroupId,
        title: 'Updated Rent Bill',
        amount: 160000,
        category: 'RENT',
        splitType: 'EQUAL',
        participants: [{ userId: testUserId }],
        paidById: testUserId
      }
    };

    const resUpdate = await fetchJson(`/api/recurring/${createdTemplateId}`, {
      method: 'PUT',
      headers: authHeader,
      body: JSON.stringify(updatePayload)
    });

    if (resUpdate.status === 200 && resUpdate.data.template.version === 2) {
      printPass('CRUD - Optimistic Concurrency Control (SUCCESS)');
    } else {
      throw new Error(`Update returned status ${resUpdate.status}: ${JSON.stringify(resUpdate.data)}`);
    }

    // C. Optimistic Concurrency Conflict (409)
    const resConflict = await fetchJson(`/api/recurring/${createdTemplateId}`, {
      method: 'PUT',
      headers: authHeader,
      body: JSON.stringify({
        ...updatePayload,
        version: 1 // Stale version
      })
    });

    if (resConflict.status === 409) {
      printPass('CRUD - Optimistic Concurrency Control (HTTP 409 CONFLICT)');
    } else {
      throw new Error(`Expected HTTP 409 conflict, got ${resConflict.status}`);
    }

    // D. Soft Delete Verification
    const resDelete = await fetchJson(`/api/recurring/${createdTemplateId}`, {
      method: 'DELETE',
      headers: authHeader
    });

    const deletedTemplate = await prisma.recurringExpense.findUnique({
      where: { id: createdTemplateId }
    });

    if (
      resDelete.status === 200 &&
      deletedTemplate.deletedAt !== null &&
      deletedTemplate.isActive === false
    ) {
      printPass('CRUD - Soft Delete template (deletedAt set & isActive=false)');
    } else {
      throw new Error(`Delete failed. deletedAt=${deletedTemplate.deletedAt}, isActive=${deletedTemplate.isActive}`);
    }
  } catch (err) {
    printFail('REST API CRUD & Soft Delete Verification', err);
    passedAll = false;
  }

  // 6. Manual Execution Now Endpoint (Run Only vs Run and Advance)
  let runOnlyTemplateId = null;
  try {
    // Create new template
    const template = await prisma.recurringExpense.create({
      data: {
        groupId: testGroupId,
        createdById: testUserId,
        title: 'Subscription',
        amount: 1500,
        recurrenceType: 'WEEKLY',
        interval: 1,
        startDate: new Date('2026-06-01T00:00:00Z'),
        nextRunAt: new Date('2026-06-08T00:00:00Z'),
        payload: {
          groupId: testGroupId,
          title: 'Subscription',
          amount: 1500,
          category: 'GENERAL',
          splitType: 'EQUAL',
          participants: [{ userId: testUserId }],
          paidById: testUserId
        }
      }
    });

    runOnlyTemplateId = template.id;

    // A. Run Only (Advance = false)
    const resRunOnly = await fetchJson(`/api/recurring/${template.id}/run-now`, {
      method: 'POST',
      headers: authHeader,
      body: JSON.stringify({ advanceSchedule: false })
    });

    const checkRunOnly = await prisma.recurringExpense.findUnique({ where: { id: template.id } });

    if (
      resRunOnly.status === 201 &&
      resRunOnly.data.expense.id &&
      checkRunOnly.nextRunAt.getTime() === new Date('2026-06-08T00:00:00Z').getTime()
    ) {
      printPass('Manual Run Now: Run Only (does not advance schedule)');
    } else {
      throw new Error(`Run Only failed. nextRunAt=${checkRunOnly.nextRunAt.toISOString()}`);
    }

    // B. Run and Advance Schedule (Advance = true)
    const resRunAdvance = await fetchJson(`/api/recurring/${template.id}/run-now`, {
      method: 'POST',
      headers: authHeader,
      body: JSON.stringify({ advanceSchedule: true })
    });

    const checkRunAdvance = await prisma.recurringExpense.findUnique({ where: { id: template.id } });

    if (
      resRunAdvance.status === 201 &&
      resRunAdvance.data.expense.id &&
      checkRunAdvance.nextRunAt.getTime() === new Date('2026-06-15T00:00:00Z').getTime()
    ) {
      printPass('Manual Run Now: Run and Advance Schedule (advances nextRunAt)');
    } else {
      throw new Error(`Run and Advance failed. nextRunAt=${checkRunAdvance.nextRunAt.toISOString()}`);
    }
  } catch (err) {
    printFail('Manual Execution Now Verification', err);
    passedAll = false;
  }

  // 7. Metadata Generation & Execution History verification
  try {
    const recentExpense = await prisma.expense.findFirst({
      where: {
        title: 'Subscription',
        groupId: testGroupId
      },
      orderBy: { createdAt: 'desc' }
    });

    const recentExecution = await prisma.recurringExecution.findFirst({
      where: { templateId: runOnlyTemplateId },
      orderBy: { executedAt: 'desc' }
    });

    const hasMeta =
      recentExpense &&
      recentExpense.metadata &&
      recentExpense.metadata.recurringTemplateId === runOnlyTemplateId &&
      recentExpense.metadata.generatedAutomatically === false;

    const hasHistory =
      recentExecution &&
      recentExecution.status === 'SUCCESS' &&
      recentExecution.expenseId === recentExpense.id;

    if (hasMeta && hasHistory) {
      printPass('Generated Expense Metadata & Execution History Log saved');
    } else {
      throw new Error(`History check failed: Meta=${JSON.stringify(recentExpense?.metadata)}, History=${JSON.stringify(recentExecution)}`);
    }
  } catch (err) {
    printFail('Metadata Generation & Execution History', err);
    passedAll = false;
  }

  // 8. Manual Retry of Failed Executions
  try {
    // Create a failed execution record
    const failedExecId = crypto.randomUUID();
    await prisma.recurringExecution.create({
      data: {
        id: failedExecId,
        templateId: runOnlyTemplateId,
        status: 'FAILED',
        executionKey: `test-failed-${Date.now()}`,
        executionTimeMs: 0,
        errorMessage: 'Connection lost during save'
      }
    });

    const resRetry = await fetchJson(`/api/recurring/executions/${failedExecId}/retry`, {
      method: 'POST',
      headers: authHeader
    });

    const checkRetryLog = await prisma.recurringExecution.findUnique({ where: { id: failedExecId } });

    if (resRetry.status === 201 && checkRetryLog.status === 'SUCCESS' && checkRetryLog.expenseId) {
      printPass('Manual Retry: Retry failed executions successfully');
    } else {
      throw new Error(`Retry returned status ${resRetry.status}. Log state status=${checkRetryLog.status}`);
    }
  } catch (err) {
    printFail('Manual Retry of Failed Executions', err);
    passedAll = false;
  }

  // 9. Catch-Up Recovery & 100 Execution Bounding Limit
  try {
    // Seed 105 past-due executions for a template
    const catchupTemplate = await prisma.recurringExpense.create({
      data: {
        groupId: testGroupId,
        createdById: testUserId,
        title: 'Catch-up Temp',
        amount: 100,
        recurrenceType: 'DAILY',
        interval: 1,
        startDate: new Date('2025-01-01T00:00:00Z'),
        nextRunAt: new Date('2025-01-01T00:00:00Z'), // Far in the past
        payload: {
          groupId: testGroupId,
          title: 'Catch-up Temp',
          amount: 100,
          category: 'GENERAL',
          splitType: 'EQUAL',
          participants: [{ userId: testUserId }],
          paidById: testUserId
        }
      }
    });

    // Reset metrics
    recurringService.schedulerMetrics.totalProcessed = 0;
    recurringService.schedulerMetrics.successfulRuns = 0;

    // Trigger catch-up processing
    await recurringService.processDueRecurringExpenses();

    // Verify executions bounded at 100 limit
    const successfulCount = recurringService.schedulerMetrics.successfulRuns;
    if (successfulCount === 100) {
      printPass('Catch-up Recovery bounded at maximum 100 execution limit');
    } else {
      throw new Error(`Expected exactly 100 executions, got ${successfulCount}`);
    }
  } catch (err) {
    printFail('Catch-up Recovery & 100 Execution Bounding Limit', err);
    passedAll = false;
  }

  // 10. Health & Metrics API Endpoints
  try {
    const resHealth = await fetchJson('/api/recurring/health', { headers: authHeader });
    const resMetrics = await fetchJson('/api/recurring/metrics', { headers: authHeader });

    const isHealthOk = resHealth.status === 200 && resHealth.data.health.uptime !== undefined;
    const isMetricsOk = resMetrics.status === 200 && resMetrics.data.metrics.totalProcessed !== undefined;

    if (isHealthOk && isMetricsOk) {
      printPass('API Endpoints - Health & Metrics summaries');
    } else {
      throw new Error(`Endpoint check mismatch: HealthOk=${isHealthOk}, MetricsOk=${isMetricsOk}`);
    }
  } catch (err) {
    printFail('API Endpoints - Health & Metrics summaries', err);
    passedAll = false;
  }

  // 11. Stale log cleanup job
  try {
    // Create an execution older than 365 days
    const staleDate = new Date();
    staleDate.setUTCDate(staleDate.getUTCDate() - 370);

    const oldExecId = crypto.randomUUID();
    await prisma.recurringExecution.create({
      data: {
        id: oldExecId,
        templateId: runOnlyTemplateId,
        status: 'SUCCESS',
        executionKey: `stale-key-${Date.now()}`,
        executionTimeMs: 0,
        executedAt: staleDate
      }
    });

    // Execute cleanup
    const count = await recurringService.runCleanupJob();
    const checkStale = await prisma.recurringExecution.findUnique({ where: { id: oldExecId } });

    if (count > 0 && !checkStale) {
      printPass('Weekly Cleanup Job: Removes execution history older than retention limit');
    } else {
      throw new Error(`Cleanup failed. Stale log exists=${!!checkStale}, clean count=${count}`);
    }
  } catch (err) {
    printFail('Weekly Cleanup Job', err);
    passedAll = false;
  }

  // Cleanup seeded test database environment
  try {
    await prisma.recurringExecution.deleteMany({
      where: { template: { groupId: testGroupId } }
    });
    await prisma.recurringExpense.deleteMany({
      where: { groupId: testGroupId }
    });
    
    // Clean up expenses and participations under testGroupId
    const expenses = await prisma.expense.findMany({ where: { groupId: testGroupId } });
    const expIds = expenses.map(e => e.id);
    
    await prisma.expenseParticipant.deleteMany({ where: { expenseId: { in: expIds } } });
    await prisma.expense.deleteMany({ where: { groupId: testGroupId } });

    await prisma.groupMember.deleteMany({ where: { groupId: testGroupId } });
    await prisma.group.delete({ where: { id: testGroupId } });
    await prisma.user.delete({ where: { id: testUserId } });

    printPass('DB environment cleanup executed successfully');
  } catch (err) {
    console.error('Failed cleaning test database items:', err);
  }

  // Shutdown test server
  await new Promise((resolve) => {
    server.close(() => {
      console.log('\n[Test Server] Shutdown successful.');
      resolve();
    });
  });

  console.log('\n================================================================');
  if (passedAll) {
    console.log('ALL PHASE 24 VERIFICATION CHECKS PASSED SUCCESSFULLY');
    console.log('================================================================');
    process.exit(0);
  } else {
    console.error('✗ SOME PHASE 24 VERIFICATION CHECKS FAILED');
    console.error('================================================================');
    process.exit(1);
  }
}

run();
