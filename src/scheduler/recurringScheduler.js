const cron = require('node-cron');
const {
  processDueRecurringExpenses,
  runCleanupJob,
  acquireSchedulerLock,
  releaseSchedulerLock
} = require('../services/recurringExpenseService');

let schedulerRunning = false;
let cronJobMinute = null;
let cronJobWeekly = null;
let lastSuccessfulRun = null;
let lastFailedRun = null;
const schedulerUptimeStart = Date.now();

function startRecurringScheduler() {
  // Singleton pattern check: ignore if already initialized
  if (cronJobMinute && cronJobWeekly) {
    console.log('[Scheduler] Recurring scheduler is already running. Ignoring duplicate initialization.');
    return {
      cronJobMinute,
      cronJobWeekly
    };
  }

  console.log('[Scheduler] Initializing automated recurring expense cron scheduler...');

  // Every minute tick schedule: * * * * *
  cronJobMinute = cron.schedule('* * * * *', async () => {
    // Acquire scheduler lock to prevent overlapping runs
    const lockAcquired = await acquireSchedulerLock();
    if (!lockAcquired) {
      console.warn('[Scheduler] Previous tick is still active. Skipping current execution.');
      return;
    }

    try {
      schedulerRunning = true;
      await processDueRecurringExpenses();
      lastSuccessfulRun = new Date();
    } catch (err) {
      console.error('[Scheduler Error] Automatic execution cycle failed:', err);
      lastFailedRun = new Date();
    } finally {
      schedulerRunning = false;
      await releaseSchedulerLock();
    }
  });

  // Weekly cleanup schedule: 0 0 * * 0 (Midnight every Sunday)
  cronJobWeekly = cron.schedule('0 0 * * 0', async () => {
    console.log('[Scheduler] Triggering weekly history logs cleanup...');
    try {
      await runCleanupJob();
    } catch (err) {
      console.error('[Scheduler Error] Weekly cleanup job failed:', err);
    }
  });

  // Exchange rates refresh schedule: 0 */12 * * * (Every 12 hours)
  const { runScheduledRefresh } = require('../services/exchangeRateService');
  cron.schedule('0 */12 * * *', () => {
    runScheduledRefresh();
  });

  // Budget Resets schedules
  const budgetService = require('../services/budgetService');
  // Monthly: Midnight of 1st day of month
  cron.schedule('0 0 1 * *', async () => {
    console.log('[Scheduler] Running monthly budget reset...');
    try {
      await budgetService.resetBudgets('MONTHLY');
    } catch (err) {
      console.error('[Scheduler Error] Monthly budget reset failed:', err);
    }
  });

  // Yearly: Midnight of January 1
  cron.schedule('0 0 1 1 *', async () => {
    console.log('[Scheduler] Running yearly budget reset...');
    try {
      await budgetService.resetBudgets('YEARLY');
    } catch (err) {
      console.error('[Scheduler Error] Yearly budget reset failed:', err);
    }
  });

  // Analytics Snapshot schedules
  const analyticsService = require('../services/analyticsService');
  
  // Daily snapshot: 1:00 AM daily
  cron.schedule('0 1 * * *', async () => {
    console.log('[Scheduler] Generating daily analytics snapshots...');
    try {
      const users = await prisma.user.findMany({ select: { id: true } });
      const todayStr = new Date().toISOString().split('T')[0];
      for (const u of users) {
        await analyticsService.generateSnapshot(u.id, `daily-${todayStr}`);
      }
    } catch (err) {
      console.error('[Scheduler Error] Daily snapshot generation failed:', err);
    }
  });

  // Weekly snapshot: 2:00 AM every Sunday
  cron.schedule('0 2 * * 0', async () => {
    console.log('[Scheduler] Generating weekly analytics snapshots...');
    try {
      const users = await prisma.user.findMany({ select: { id: true } });
      // Find week key
      const now = new Date();
      const oneJan = new Date(now.getFullYear(), 0, 1);
      const numberOfDays = Math.floor((now - oneJan) / (24 * 60 * 60 * 1000));
      const resultWeek = Math.ceil((now.getDay() + 1 + numberOfDays) / 7);
      const weekKey = `${now.getFullYear()}-W${resultWeek}`;
      for (const u of users) {
        await analyticsService.generateSnapshot(u.id, `weekly-${weekKey}`);
      }
    } catch (err) {
      console.error('[Scheduler Error] Weekly snapshot generation failed:', err);
    }
  });

  // Monthly snapshot: 3:00 AM on the 1st of every month
  cron.schedule('0 3 1 * *', async () => {
    console.log('[Scheduler] Generating monthly analytics snapshots...');
    try {
      const users = await prisma.user.findMany({ select: { id: true } });
      const now = new Date();
      const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      for (const u of users) {
        await analyticsService.generateSnapshot(u.id, `monthly-${monthKey}`);
      }
    } catch (err) {
      console.error('[Scheduler Error] Monthly snapshot generation failed:', err);
    }
  });

  // Yearly snapshot: 4:00 AM on January 1
  cron.schedule('0 4 1 1 *', async () => {
    console.log('[Scheduler] Generating yearly analytics snapshots...');
    try {
      const users = await prisma.user.findMany({ select: { id: true } });
      const yearKey = `${new Date().getFullYear()}`;
      for (const u of users) {
        await analyticsService.generateSnapshot(u.id, `yearly-${yearKey}`);
      }
    } catch (err) {
      console.error('[Scheduler Error] Yearly snapshot generation failed:', err);
    }
  });

  // Trigger initial refresh on startup
  setTimeout(() => {
    runScheduledRefresh();
  }, 1000);

  return {
    cronJobMinute,
    cronJobWeekly
  };
}

const prisma = require('../utils/prisma');

function getSchedulerHealth() {
  const uptime = Math.floor((Date.now() - schedulerUptimeStart) / 1000);
  return {
    schedulerRunning,
    uptime,
    lastSuccessfulRun,
    lastFailedRun,
    serverVersion: '1.0.0'
  };
}

module.exports = {
  startRecurringScheduler,
  getSchedulerHealth
};
