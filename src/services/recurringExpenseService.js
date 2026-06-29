const prisma = require('../utils/prisma');
const crypto = require('crypto');
const { createExpense } = require('./expenseService');
const { createExpenseSchema } = require('../validators/expenseValidator');
const permissionService = require('./permissionService');

const assertAdminOrOwner = async (groupId, userId) => {
  const isAllowed = await permissionService.isAdmin(groupId, userId);
  if (!isAllowed) {
    const err = new Error('Access denied. Administrator privileges required.');
    err.status = 403;
    throw err;
  }
};

const schedulerMetrics = {
  totalProcessed: 0,
  successfulRuns: 0,
  failedRuns: 0,
  skippedRuns: 0,
  averageExecutionTime: 0,
  retriesPerformed: 0,
  templatesExecutedToday: 0
};

// Track executions today
let executionsToday = [];

function recordExecutionToday() {
  const now = Date.now();
  executionsToday.push(now);
  // Keep logs of today only (last 24 hours)
  executionsToday = executionsToday.filter((t) => now - t < 24 * 60 * 60 * 1000);
  schedulerMetrics.templatesExecutedToday = executionsToday.length;
}

// Concurrency locks
let localSchedulerLock = false;

async function acquireSchedulerLock() {
  if (localSchedulerLock) return false;
  localSchedulerLock = true;
  return true;
}

async function releaseSchedulerLock() {
  localSchedulerLock = false;
}

// Timezone-safe UTC date calculations
function calculateNextRun(baseDate, recurrenceType, interval) {
  const next = new Date(baseDate);
  switch (recurrenceType) {
    case 'DAILY':
      next.setUTCDate(next.getUTCDate() + interval);
      break;
    case 'WEEKLY':
      next.setUTCDate(next.getUTCDate() + (7 * interval));
      break;
    case 'MONTHLY':
      next.setUTCMonth(next.getUTCMonth() + interval);
      break;
    case 'YEARLY':
      next.setUTCFullYear(next.getUTCFullYear() + interval);
      break;
    default:
      throw new Error(`Unsupported recurrence type: ${recurrenceType}`);
  }
  return next;
}

function formatExecutionKeyDate(date) {
  const d = new Date(date);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}-${hh}-${min}`;
}

// Validation helper
function validateTemplateInput(data) {
  if (!data.title || data.title.trim().length < 3 || data.title.trim().length > 100) {
    const err = new Error('Title must be between 3 and 100 characters');
    err.status = 400;
    throw err;
  }
  if (!data.interval || data.interval < 1) {
    const err = new Error('Interval must be at least 1');
    err.status = 400;
    throw err;
  }
  if (!data.amount || data.amount <= 0) {
    const err = new Error('Amount must be greater than 0');
    err.status = 400;
    throw err;
  }
  if (!data.startDate) {
    const err = new Error('Start date is required');
    err.status = 400;
    throw err;
  }
  const start = new Date(data.startDate);
  if (isNaN(start.getTime())) {
    const err = new Error('Start date is invalid');
    err.status = 400;
    throw err;
  }
  if (data.endDate) {
    const end = new Date(data.endDate);
    if (isNaN(end.getTime())) {
      const err = new Error('End date is invalid');
      err.status = 400;
      throw err;
    }
    if (end <= start) {
      const err = new Error('End date must be after start date');
      err.status = 400;
      throw err;
    }
  }

  // Validate split details payload
  if (data.payload) {
    try {
      createExpenseSchema.parse(data.payload);
    } catch (zodError) {
      const err = new Error(`Payload validation failed: ${zodError.errors ? zodError.errors.map(e => e.message).join(', ') : zodError.message}`);
      err.status = 400;
      err.name = 'ZodError';
      throw err;
    }
  }
}

// Exponential backoff executor
async function executeWithRetry(fn) {
  let attempt = 0;
  let lastError = null;

  while (attempt < 3) {
    try {
      return await fn();
    } catch (error) {
      attempt++;
      lastError = error;

      // Do not retry permanent validation/permission/409 errors
      const status = error.status || error.statusCode;
      if (status === 400 || status === 401 || status === 403 || status === 404 || status === 409 || error.name === 'ZodError') {
        throw { error, retryCount: attempt - 1, permanent: true };
      }

      // Wait with exponential delays (1s, 2s, 4s)
      if (attempt < 3) {
        schedulerMetrics.retriesPerformed++;
        const delay = Math.pow(2, attempt - 1) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw { error: lastError, retryCount: 2, permanent: false };
}

/**
 * Create a new recurring template
 */
async function createRecurringExpense(creatorId, groupId, data) {
  await assertAdminOrOwner(groupId, creatorId);
  validateTemplateInput({ ...data, groupId });

  // Map startDate to nextRunAt initial state
  const nextRunAt = new Date(data.startDate);

  const template = await prisma.recurringExpense.create({
    data: {
      groupId,
      createdById: creatorId,
      title: data.title,
      description: data.description,
      amount: data.amount,
      category: data.category || 'GENERAL',
      splitType: data.splitType || 'EQUAL',
      recurrenceType: data.recurrenceType,
      interval: data.interval,
      startDate: new Date(data.startDate),
      endDate: data.endDate ? new Date(data.endDate) : null,
      nextRunAt,
      payload: data.payload || {},
      isActive: data.isActive !== undefined ? data.isActive : true
    }
  });

  // Post action activities and socket updates
  const creatorUser = await prisma.user.findUnique({ where: { id: creatorId } });
  const creatorName = creatorUser ? creatorUser.name : 'Someone';
  const { logActivity, notifyGroupMembers } = require('./activityService');
  const { broadcastToGroup } = require('../socket/socketServer');
  const SocketEvents = require('../socket/socketEvents');

  await logActivity(creatorId, 'RECURRING_CREATED', `${creatorName} created recurring template "${template.title}".`, groupId, { templateId: template.id });
  await notifyGroupMembers(groupId, creatorId, 'New Recurring Template', `${creatorName} created recurring template "${template.title}".`);
  
  broadcastToGroup(groupId, SocketEvents.RECURRING_CREATED, { template }, creatorId);

  return template;
}

/**
 * Update recurring template with Optimistic Concurrency Control
 */
async function updateRecurringExpense(id, userId, currentVersion, data) {
  const currentTemplate = await prisma.recurringExpense.findUnique({ where: { id } });
  if (!currentTemplate || currentTemplate.deletedAt) {
    const err = new Error('Recurring template not found');
    err.status = 404;
    throw err;
  }
  await assertAdminOrOwner(currentTemplate.groupId, userId);

  // Validate current template properties
  validateTemplateInput(data);

  // Optimistic concurrency execution: updates only if version matches
  const result = await prisma.recurringExpense.updateMany({
    where: {
      id,
      version: currentVersion,
      deletedAt: null
    },
    data: {
      title: data.title,
      description: data.description,
      amount: data.amount,
      category: data.category,
      splitType: data.splitType,
      recurrenceType: data.recurrenceType,
      interval: data.interval,
      startDate: new Date(data.startDate),
      endDate: data.endDate ? new Date(data.endDate) : null,
      isActive: data.isActive,
      payload: data.payload,
      version: currentVersion + 1
    }
  });

  if (result.count === 0) {
    const err = new Error('This recurring template has been modified by another user. Please refresh.');
    err.status = 409;
    throw err;
  }

  const updated = await prisma.recurringExpense.findUnique({ where: { id } });

  // Post update notifications
  const creatorUser = await prisma.user.findUnique({ where: { id: userId } });
  const creatorName = creatorUser ? creatorUser.name : 'Someone';
  const { logActivity, notifyGroupMembers } = require('./activityService');
  const { broadcastToGroup } = require('../socket/socketServer');
  const SocketEvents = require('../socket/socketEvents');

  await logActivity(userId, 'RECURRING_UPDATED', `${creatorName} updated recurring template "${updated.title}".`, updated.groupId, { templateId: id });
  await notifyGroupMembers(updated.groupId, userId, 'Recurring Template Updated', `${creatorName} updated recurring template "${updated.title}".`);
  
  broadcastToGroup(updated.groupId, SocketEvents.RECURRING_UPDATED, { template: updated }, userId);

  return updated;
}

/**
 * Soft Delete templates
 */
async function deleteRecurringExpense(id, userId) {
  const template = await prisma.recurringExpense.findUnique({ where: { id } });
  if (!template || template.deletedAt) {
    const err = new Error('Recurring template not found');
    err.status = 404;
    throw err;
  }
  await assertAdminOrOwner(template.groupId, userId);

  // Soft delete: sets deletedAt timestamp and turns isActive off
  const updated = await prisma.recurringExpense.update({
    where: { id },
    data: {
      deletedAt: new Date(),
      isActive: false
    }
  });

  const creatorUser = await prisma.user.findUnique({ where: { id: userId } });
  const creatorName = creatorUser ? creatorUser.name : 'Someone';
  const { logActivity, notifyGroupMembers } = require('./activityService');
  const { broadcastToGroup } = require('../socket/socketServer');
  const SocketEvents = require('../socket/socketEvents');

  await logActivity(userId, 'RECURRING_DELETED', `${creatorName} deleted recurring template "${template.title}".`, template.groupId, { templateId: id });
  await notifyGroupMembers(template.groupId, userId, 'Recurring Template Deleted', `${creatorName} deleted recurring template "${template.title}".`);
  
  broadcastToGroup(template.groupId, SocketEvents.RECURRING_DELETED, { templateId: id }, userId);

  return updated;
}

/**
 * Toggle Active Switch Status
 */
async function toggleRecurringExpense(id, userId, isActive) {
  const template = await prisma.recurringExpense.findUnique({ where: { id } });
  if (!template || template.deletedAt) {
    const err = new Error('Recurring template not found');
    err.status = 404;
    throw err;
  }
  await assertAdminOrOwner(template.groupId, userId);

  const updated = await prisma.recurringExpense.update({
    where: { id },
    data: { isActive }
  });

  const creatorUser = await prisma.user.findUnique({ where: { id: userId } });
  const creatorName = creatorUser ? creatorUser.name : 'Someone';
  const { logActivity } = require('./activityService');
  const { broadcastToGroup } = require('../socket/socketServer');
  const SocketEvents = require('../socket/socketEvents');

  const actionName = isActive ? 'RECURRING_ENABLED' : 'RECURRING_DISABLED';
  const actionMsg = isActive ? 'enabled' : 'disabled';

  await logActivity(userId, actionName, `${creatorName} ${actionMsg} recurring template "${template.title}".`, template.groupId, { templateId: id });
  
  broadcastToGroup(template.groupId, SocketEvents.RECURRING_TOGGLED, { template: updated }, userId);

  return updated;
}

/**
 * List Group templates (excludes deleted ones)
 */
async function getRecurringExpenses(groupId) {
  return prisma.recurringExpense.findMany({
    where: {
      groupId,
      deletedAt: null
    },
    orderBy: { createdAt: 'desc' }
  });
}

/**
 * Run template manually right now
 */
async function runRecurringExpense(id, userId, advanceSchedule = false) {
  const template = await prisma.recurringExpense.findUnique({ where: { id } });
  if (!template || template.deletedAt) {
    const err = new Error('Recurring template not found');
    err.status = 404;
    throw err;
  }
  await assertAdminOrOwner(template.groupId, userId);

  const runKey = formatExecutionKeyDate(new Date());
  const executionKey = `manual-${template.id}-${runKey}-${Date.now()}`;

  const start = Date.now();

  try {
    const result = await executeWithRetry(async () => {
      return await prisma.$transaction(async (tx) => {
        // Build metadata details
        const metadata = {
          recurringTemplateId: template.id,
          recurringExecutionId: crypto.randomUUID(),
          templateVersion: template.version,
          generatedAutomatically: false
        };

        const expensePayload = {
          ...template.payload,
          metadata
        };

        // Create the expense inside transaction
        const expense = await createExpense(template.createdById, expensePayload, tx);

        let updatedTemplate = template;
        if (advanceSchedule) {
          const nextRun = calculateNextRun(template.nextRunAt, template.recurrenceType, template.interval);
          updatedTemplate = await tx.recurringExpense.update({
            where: { id: template.id },
            data: {
              lastRunAt: new Date(),
              nextRunAt: nextRun,
              lastExecutionKey: `manual-${runKey}`
            }
          });
        }

        // Log successful execution record
        await tx.recurringExecution.create({
          data: {
            id: metadata.recurringExecutionId,
            templateId: template.id,
            expenseId: expense.id,
            status: 'SUCCESS',
            executionKey,
            executionTimeMs: 0,
            retryCount: 0
          }
        });

        return { expense, updatedTemplate, executionId: metadata.recurringExecutionId };
      });
    });

    const duration = Date.now() - start;

    // Update execution duration
    await prisma.recurringExecution.update({
      where: { id: result.executionId },
      data: { executionTimeMs: duration }
    });

    // Update in-memory metrics
    schedulerMetrics.totalProcessed++;
    schedulerMetrics.successfulRuns++;
    recordExecutionToday();
    schedulerMetrics.averageExecutionTime = 
      (schedulerMetrics.averageExecutionTime * (schedulerMetrics.successfulRuns - 1) + duration) / schedulerMetrics.successfulRuns;

    // Trigger actions outside transaction
    const { logActivity, notifyGroupMembers } = require('./activityService');
    const { broadcastToGroup } = require('../socket/socketServer');
    const SocketEvents = require('../socket/socketEvents');
    const creatorUser = await prisma.user.findUnique({ where: { id: userId } });
    const creatorName = creatorUser ? creatorUser.name : 'Someone';

    await logActivity(userId, 'RECURRING_EXECUTED', `${creatorName} manually executed recurring template "${template.title}".`, template.groupId, { templateId: id, expenseId: result.expense.id });
    await notifyGroupMembers(template.groupId, userId, 'Recurring Expense Generated', `${creatorName} generated a recurring expense "${result.expense.title}".`);
    
    broadcastToGroup(template.groupId, SocketEvents.RECURRING_EXECUTED, {
      template: result.updatedTemplate,
      expense: result.expense
    }, userId);

    // Invalidate cache and check budget alerts for participants
    try {
      const analyticsCache = require('../utils/analyticsCache');
      const budgetService = require('./budgetService');
      const { sendToUser } = require('../socket/socketServer');

      if (result.expense && result.expense.participants) {
        result.expense.participants.forEach(p => {
          analyticsCache.invalidateUserCache(p.userId);
          sendToUser(p.userId, 'CACHE_INVALIDATED', { userId: p.userId });
        });
        for (const p of result.expense.participants) {
          await budgetService.checkBudgetAlerts(p.userId, template.groupId, template.category).catch(console.error);
        }
      }
    } catch (cacheErr) {
      console.error('[Scheduler] Cache invalidation failed for manual execution:', cacheErr);
    }

    return result.expense;
  } catch (errInfo) {
    const duration = Date.now() - start;
    schedulerMetrics.totalProcessed++;
    schedulerMetrics.failedRuns++;

    const errMsg = errInfo.error?.message || String(errInfo.error || errInfo);
    const retryCount = errInfo.retryCount || 0;

    await prisma.recurringExecution.create({
      data: {
        templateId: template.id,
        status: 'FAILED',
        executionKey,
        executionTimeMs: duration,
        errorMessage: errMsg.slice(0, 500),
        retryCount
      }
    });

    throw errInfo.error || errInfo;
  }
}

/**
 * Manually retry a failed execution
 */
async function retryFailedExecution(executionId, userId) {
  const execution = await prisma.recurringExecution.findUnique({
    where: { id: executionId },
    include: { template: true }
  });

  if (!execution) {
    const err = new Error('Execution record not found');
    err.status = 404;
    throw err;
  }

  if (execution.status !== 'FAILED') {
    const err = new Error('Only failed executions can be retried');
    err.status = 400;
    throw err;
  }

  const template = execution.template;
  const start = Date.now();
  const retryKey = `retry-${execution.executionKey}-${Date.now()}`;

  try {
    const result = await executeWithRetry(async () => {
      return await prisma.$transaction(async (tx) => {
        const metadata = {
          recurringTemplateId: template.id,
          recurringExecutionId: executionId,
          templateVersion: template.version,
          generatedAutomatically: false,
          isRetry: true
        };

        const expensePayload = {
          ...template.payload,
          metadata
        };

        // Create expense
        const expense = await createExpense(template.createdById, expensePayload, tx);

        // Update the execution record to success and link expense
        await tx.recurringExecution.update({
          where: { id: executionId },
          data: {
            status: 'SUCCESS',
            expenseId: expense.id,
            errorMessage: null
          }
        });

        return expense;
      });
    });

    const duration = Date.now() - start;
    schedulerMetrics.totalProcessed++;
    schedulerMetrics.successfulRuns++;
    recordExecutionToday();

    // Trigger actions
    const { logActivity } = require('./activityService');
    const { broadcastToGroup } = require('../socket/socketServer');
    const SocketEvents = require('../socket/socketEvents');

    await logActivity(userId, 'RECURRING_EXECUTED', `Manually retried and successfully generated recurring expense "${result.title}".`, template.groupId, { templateId: template.id, expenseId: result.id });
    
    broadcastToGroup(template.groupId, SocketEvents.RECURRING_EXECUTED, {
      template,
      expense: result
    }, userId);

    return result;
  } catch (errInfo) {
    const duration = Date.now() - start;
    schedulerMetrics.totalProcessed++;
    schedulerMetrics.failedRuns++;

    const errMsg = errInfo.error?.message || String(errInfo.error || errInfo);
    
    // Update execution record with new error message
    await prisma.recurringExecution.update({
      where: { id: executionId },
      data: {
        errorMessage: `[Retry Failed]: ${errMsg.slice(0, 450)}`
      }
    });

    throw errInfo.error || errInfo;
  }
}

/**
 * Preview calculations for the next 10 occurrences
 */
function previewRecurringDates(recurrenceType, interval, startDate) {
  const dates = [];
  let current = new Date(startDate);
  
  const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  // Start date is the first execution date
  const now = new Date();
  
  for (let i = 0; i < 10; i++) {
    const dateCopy = new Date(current);
    
    // Calculate days remaining
    const diffTime = dateCopy.getTime() - now.getTime();
    const daysRemaining = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));

    dates.push({
      date: dateCopy.toISOString(),
      weekday: weekdays[dateCopy.getUTCDay()],
      month: months[dateCopy.getUTCMonth()],
      daysRemaining
    });

    current = calculateNextRun(current, recurrenceType, interval);
  }

  return dates;
}

/**
 * Scheduled tick generator
 */
async function processDueRecurringExpenses() {
  const now = new Date();
  
  // 1. Fetch active templates that are due
  const dueTemplates = await prisma.recurringExpense.findMany({
    where: {
      isActive: true,
      deletedAt: null,
      nextRunAt: { lte: now }
    },
    orderBy: { nextRunAt: 'asc' }
  });

  if (dueTemplates.length === 0) return;

  console.log(`[Scheduler] Found ${dueTemplates.length} due templates to process.`);
  
  let executionCount = 0;
  const LIMIT = 100;

  for (const template of dueTemplates) {
    if (executionCount >= LIMIT) {
      console.log(`[Scheduler] Hit maximum catch-up execution limit (${LIMIT}) for this tick. Pausing.`);
      break;
    }

    let currentTemplate = template;

    // recovery catch-up loop
    while (currentTemplate.isActive && currentTemplate.nextRunAt <= now && executionCount < LIMIT) {
      // Validate template schedule limits
      if (currentTemplate.endDate && currentTemplate.nextRunAt > currentTemplate.endDate) {
        currentTemplate = await prisma.recurringExpense.update({
          where: { id: currentTemplate.id },
          data: { isActive: false }
        });
        break;
      }

      const nextRunKey = formatExecutionKeyDate(currentTemplate.nextRunAt);
      const executionKey = `${currentTemplate.id}-${nextRunKey}`;

      // Idempotency check
      if (currentTemplate.lastExecutionKey === executionKey) {
        // Skip duplicate run, advance schedule to avoid loop
        const nextRun = calculateNextRun(currentTemplate.nextRunAt, currentTemplate.recurrenceType, currentTemplate.interval);
        currentTemplate = await prisma.recurringExpense.update({
          where: { id: currentTemplate.id },
          data: { nextRunAt: nextRun }
        });
        schedulerMetrics.skippedRuns++;
        continue;
      }

      executionCount++;
      schedulerMetrics.totalProcessed++;
      const start = Date.now();

      try {
        const result = await executeWithRetry(async () => {
          return await prisma.$transaction(async (tx) => {
            const executionId = crypto.randomUUID();
            
            const metadata = {
              recurringTemplateId: currentTemplate.id,
              recurringExecutionId: executionId,
              templateVersion: currentTemplate.version,
              generatedAutomatically: true
            };

            const expensePayload = {
              ...currentTemplate.payload,
              metadata
            };

            // Re-use core expense split service
            const expense = await createExpense(currentTemplate.createdById, expensePayload, tx);

            // Compute next schedule date
            const nextRun = calculateNextRun(currentTemplate.nextRunAt, currentTemplate.recurrenceType, currentTemplate.interval);

            // Update template status
            const updated = await tx.recurringExpense.update({
              where: { id: currentTemplate.id },
              data: {
                lastRunAt: new Date(),
                nextRunAt: nextRun,
                lastExecutionKey: executionKey
              }
            });

            // Write success execution log
            await tx.recurringExecution.create({
              data: {
                id: executionId,
                templateId: currentTemplate.id,
                expenseId: expense.id,
                status: 'SUCCESS',
                executionKey,
                executionTimeMs: 0,
                retryCount: 0
              }
            });

            return { updated, expense, executionId };
          });
        });

        const duration = Date.now() - start;

        // Record execution duration
        await prisma.recurringExecution.update({
          where: { id: result.executionId },
          data: { executionTimeMs: duration }
        });

        schedulerMetrics.successfulRuns++;
        recordExecutionToday();
        schedulerMetrics.averageExecutionTime = 
          (schedulerMetrics.averageExecutionTime * (schedulerMetrics.successfulRuns - 1) + duration) / schedulerMetrics.successfulRuns;

        currentTemplate = result.updated;

        // Post-commit triggers
        const { logActivity, notifyGroupMembers } = require('./activityService');
        const { broadcastToGroup } = require('../socket/socketServer');
        const SocketEvents = require('../socket/socketEvents');

        await logActivity(
          currentTemplate.createdById,
          'RECURRING_EXECUTED',
          `Recurring expense "${result.expense.title}" was automatically generated.`,
          currentTemplate.groupId,
          { templateId: currentTemplate.id, expenseId: result.expense.id }
        );

        await notifyGroupMembers(
          currentTemplate.groupId,
          currentTemplate.createdById,
          'Recurring Expense Generated',
          `Recurring expense "${result.expense.title}" has been generated automatically.`
        );

        broadcastToGroup(currentTemplate.groupId, SocketEvents.RECURRING_EXECUTED, {
          template: currentTemplate,
          expense: result.expense
        }, currentTemplate.createdById);

        // Invalidate cache and check budget alerts for participants
        try {
          const analyticsCache = require('../utils/analyticsCache');
          const budgetService = require('./budgetService');
          const { sendToUser } = require('../socket/socketServer');

          if (result.expense && result.expense.participants) {
            result.expense.participants.forEach(p => {
              analyticsCache.invalidateUserCache(p.userId);
              sendToUser(p.userId, 'CACHE_INVALIDATED', { userId: p.userId });
            });
            for (const p of result.expense.participants) {
              await budgetService.checkBudgetAlerts(p.userId, currentTemplate.groupId, currentTemplate.category).catch(console.error);
            }
          }
        } catch (cacheErr) {
          console.error('[Scheduler] Cache invalidation failed for automatic execution:', cacheErr);
        }

      } catch (errInfo) {
        const duration = Date.now() - start;
        schedulerMetrics.failedRuns++;

        const errMsg = errInfo.error?.message || String(errInfo.error || errInfo);
        const retryCount = errInfo.retryCount || 0;

        await prisma.recurringExecution.create({
          data: {
            templateId: currentTemplate.id,
            status: 'FAILED',
            executionKey,
            executionTimeMs: duration,
            errorMessage: errMsg.slice(0, 500),
            retryCount
          }
        });

        if (errInfo.permanent) {
          // Disable schedule due to validation failures
          currentTemplate = await prisma.recurringExpense.update({
            where: { id: currentTemplate.id },
            data: { isActive: false }
          });

          const { logActivity } = require('./activityService');
          const { broadcastToGroup } = require('../socket/socketServer');
          const SocketEvents = require('../socket/socketEvents');

          await logActivity(
            currentTemplate.createdById,
            'RECURRING_FAILED',
            `Recurring template "${currentTemplate.title}" failed execution permanently: ${errMsg}`,
            currentTemplate.groupId,
            { templateId: currentTemplate.id, error: errMsg }
          );

          broadcastToGroup(currentTemplate.groupId, SocketEvents.RECURRING_FAILED, {
            template: currentTemplate,
            error: errMsg
          }, currentTemplate.createdById);
        }

        // Halt recovery ticks on error for this template
        break;
      }
    }
  }
}

/**
 * Removes old execution records
 */
async function runCleanupJob() {
  const retentionDays = parseInt(process.env.RECURRING_HISTORY_RETENTION_DAYS, 10) || 365;
  const cutoffDate = new Date();
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - retentionDays);

  console.log(`[Scheduler] Running execution logs cleanup. Retention: ${retentionDays} days. Cutoff date: ${cutoffDate.toISOString()}`);
  
  try {
    const result = await prisma.recurringExecution.deleteMany({
      where: {
        executedAt: { lt: cutoffDate }
      }
    });
    console.log(`[Scheduler] Cleaned up ${result.count} stale execution records.`);
    return result.count;
  } catch (err) {
    console.error('[Scheduler Error] History cleanup failed:', err);
    return 0;
  }
}

module.exports = {
  createRecurringExpense,
  updateRecurringExpense,
  deleteRecurringExpense,
  toggleRecurringExpense,
  getRecurringExpenses,
  runRecurringExpense,
  retryFailedExecution,
  previewRecurringDates,
  processDueRecurringExpenses,
  runCleanupJob,
  acquireSchedulerLock,
  releaseSchedulerLock,
  calculateNextRun,
  schedulerMetrics
};
