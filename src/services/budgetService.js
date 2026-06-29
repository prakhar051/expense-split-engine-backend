const prisma = require('../utils/prisma');
const exchangeRateService = require('./exchangeRateService');
const { broadcastToUser, sendToUser } = require('../socket/socketServer');
const SocketEvents = require('../socket/socketEvents');
const { logActivity, createNotification } = require('./activityService');
const { generateForecast } = require('./forecastService');
const permissionService = require('./permissionService');

const BASE_CURRENCY = process.env.BASE_CURRENCY || 'INR';

// In-memory locks to prevent concurrent budget calculations
const budgetCalculationLocks = new Set();

/**
 * Helper to get date boundaries for current period
 */
function getPeriodBoundaries(period) {
  const now = new Date();
  let startPeriod, endPeriod;
  if (period === 'MONTHLY') {
    startPeriod = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    endPeriod = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  } else {
    // YEARLY
    startPeriod = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    endPeriod = new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 0, 23, 59, 59, 999));
  }
  return { startPeriod, endPeriod, periodKey: getPeriodKey(period, now) };
}

function getPeriodKey(period, date) {
  const d = date || new Date();
  if (period === 'MONTHLY') {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  return `${d.getUTCFullYear()}`;
}

/**
 * Calculates current spent and remaining amount for a budget, updating database.
 * Uses in-memory locking to prevent duplicate calculations.
 */
const calculateBudgetUsage = async (budgetId) => {
  if (budgetCalculationLocks.has(budgetId)) {
    // Lock active, return current budget values
    return prisma.budget.findUnique({ where: { id: budgetId } });
  }

  budgetCalculationLocks.add(budgetId);

  try {
    const budget = await prisma.budget.findUnique({ where: { id: budgetId } });
    if (!budget) return null;

    const { startPeriod, endPeriod } = getPeriodBoundaries(budget.period);

    // Query all expense participants of user during period in the scoped group/category
    const filters = {
      userId: budget.userId,
      expense: {
        createdAt: {
          gte: startPeriod,
          lte: endPeriod
        }
      }
    };

    if (budget.groupId) {
      filters.expense.groupId = budget.groupId;
    }
    if (budget.category) {
      filters.expense.category = budget.category;
    }

    const participants = await prisma.expenseParticipant.findMany({
      where: filters,
      select: { shareAmount: true }
    });

    const totalSpentBase = participants.reduce((sum, p) => sum + p.shareAmount, 0);

    // Convert base currency (INR cents) spent into budget's target currency
    let spentAmount = totalSpentBase;
    if (budget.currency !== BASE_CURRENCY) {
      const converted = await exchangeRateService.convert(totalSpentBase, BASE_CURRENCY, budget.currency);
      spentAmount = converted.amount;
    }

    const remainingAmount = budget.amount - spentAmount;

    const updatedBudget = await prisma.budget.update({
      where: { id: budgetId },
      data: {
        spentAmount,
        remainingAmount
      }
    });

    return updatedBudget;
  } finally {
    budgetCalculationLocks.delete(budgetId);
  }
};

/**
 * CRUD: Create Budget
 */
const createBudget = async (userId, data) => {
  if (data.groupId) {
    const isGroupOwner = await permissionService.isOwner(data.groupId, userId);
    if (!isGroupOwner) {
      const err = new Error('Access denied. Only the group OWNER can manage group budgets.');
      err.status = 403;
      throw err;
    }
  }

  const budget = await prisma.budget.create({
    data: {
      userId,
      groupId: data.groupId || null,
      category: data.category || null,
      amount: parseInt(data.amount, 10),
      currency: data.currency || 'INR',
      period: data.period || 'MONTHLY',
      warningThreshold: data.warningThreshold ? parseFloat(data.warningThreshold) : 0.80,
      version: 1
    }
  });

  const finalBudget = await calculateBudgetUsage(budget.id);

  // Log activity
  await logActivity(userId, 'BUDGET_CREATED', `Created a ${finalBudget.period.toLowerCase()} budget of ${finalBudget.amount / 100} ${finalBudget.currency}.`, finalBudget.groupId);

  // Socket broadcast
  sendToUser(userId, 'BUDGET_CREATED', { budget: finalBudget });

  return finalBudget;
};

/**
 * CRUD: Update Budget with Optimistic Concurrency Control (OCC)
 */
const updateBudget = async (budgetId, userId, data, clientVersion) => {
  // Find current budget
  const budget = await prisma.budget.findUnique({
    where: { id: budgetId }
  });
  if (!budget) {
    const err = new Error('Budget not found');
    err.status = 404;
    throw err;
  }

  if (budget.groupId) {
    const isGroupOwner = await permissionService.isOwner(budget.groupId, userId);
    if (!isGroupOwner) {
      const err = new Error('Access denied. Only the group OWNER can manage group budgets.');
      err.status = 403;
      throw err;
    }
  } else {
    if (budget.userId !== userId) {
      const err = new Error('Unauthorized');
      err.status = 403;
      throw err;
    }
  }

  // Version check
  if (budget.version !== parseInt(clientVersion, 10)) {
    const err = new Error('This budget has been modified by another client. Please refresh.');
    err.status = 409;
    throw err;
  }

  // Update
  const updatedBudgets = await prisma.budget.updateMany({
    where: {
      id: budgetId,
      userId,
      version: budget.version
    },
    data: {
      groupId: data.groupId === undefined ? budget.groupId : (data.groupId || null),
      category: data.category === undefined ? budget.category : (data.category || null),
      amount: data.amount === undefined ? budget.amount : parseInt(data.amount, 10),
      currency: data.currency === undefined ? budget.currency : data.currency,
      period: data.period === undefined ? budget.period : data.period,
      warningThreshold: data.warningThreshold === undefined ? budget.warningThreshold : parseFloat(data.warningThreshold),
      version: { increment: 1 }
    }
  });

  if (updatedBudgets.count === 0) {
    const err = new Error('This budget has been modified by another client. Please refresh.');
    err.status = 409;
    throw err;
  }

  const finalBudget = await calculateBudgetUsage(budgetId);

  // Log activity
  await logActivity(userId, 'BUDGET_UPDATED', `Updated budget for period ${finalBudget.period.toLowerCase()}.`, finalBudget.groupId);

  // Socket broadcast
  sendToUser(userId, 'BUDGET_UPDATED', { budget: finalBudget });

  return finalBudget;
};

/**
 * CRUD: Delete Budget
 */
const deleteBudget = async (budgetId, userId) => {
  const budget = await prisma.budget.findUnique({
    where: { id: budgetId }
  });
  if (!budget) {
    const err = new Error('Budget not found');
    err.status = 404;
    throw err;
  }
  
  if (budget.groupId) {
    const isGroupOwner = await permissionService.isOwner(budget.groupId, userId);
    if (!isGroupOwner) {
      const err = new Error('Access denied. Only the group OWNER can manage group budgets.');
      err.status = 403;
      throw err;
    }
  } else {
    if (budget.userId !== userId) {
      const err = new Error('Unauthorized');
      err.status = 403;
      throw err;
    }
  }

  await prisma.budget.delete({
    where: { id: budgetId }
  });

  // Log activity
  await logActivity(userId, 'BUDGET_DELETED', `Deleted a ${budget.period.toLowerCase()} budget.`, budget.groupId);

  // Socket broadcast
  sendToUser(userId, 'BUDGET_DELETED', { id: budgetId });

  return { success: true };
};

/**
 * Get all budgets for user with usage calculations
 */
const getBudgets = async (userId) => {
  const budgets = await prisma.budget.findMany({
    where: { userId }
  });

  const updatedBudgets = [];
  for (const b of budgets) {
    const updated = await calculateBudgetUsage(b.id);
    updatedBudgets.push(updated);
  }

  return updatedBudgets;
};

/**
 * Check budget alerts for a user following a new expense creation or edit.
 * Implements cooldown logic via alertMetadata to prevent duplicate alerts.
 */
const checkBudgetAlerts = async (userId, groupId, category) => {
  // Find all budgets for this user that could be affected
  const budgets = await prisma.budget.findMany({
    where: {
      userId,
      OR: [
        { groupId: null, category: null },
        { groupId, category: null },
        { groupId: null, category },
        { groupId, category }
      ]
    }
  });

  for (const b of budgets) {
    const finalBudget = await calculateBudgetUsage(b.id);
    if (!finalBudget) continue;

    const utilization = finalBudget.spentAmount / finalBudget.amount;
    const { periodKey } = getPeriodBoundaries(finalBudget.period);

    // Initialize/read alerted thresholds
    let metadata = typeof finalBudget.alertMetadata === 'string' 
      ? JSON.parse(finalBudget.alertMetadata) 
      : finalBudget.alertMetadata;
    if (!metadata) metadata = {};
    if (!metadata.sentAlerts) metadata.sentAlerts = {};
    if (!metadata.sentAlerts[periodKey]) metadata.sentAlerts[periodKey] = [];

    const alertedList = metadata.sentAlerts[periodKey];

    let thresholdToAlert = null;
    let messageType = 'BUDGET_THRESHOLD_REACHED';

    if (utilization >= 1.0) {
      thresholdToAlert = 100;
      messageType = 'BUDGET_EXCEEDED';
    } else if (utilization >= 0.9) {
      thresholdToAlert = 90;
    } else if (utilization >= 0.8) {
      thresholdToAlert = 80;
    }

    if (thresholdToAlert && !alertedList.includes(thresholdToAlert)) {
      // Breached and not yet alerted in this period
      alertedList.push(thresholdToAlert);

      // Save alert state to DB
      await prisma.budget.update({
        where: { id: finalBudget.id },
        data: {
          alertMetadata: metadata
        }
      });

      const currencyStr = finalBudget.currency;
      const budgetLimit = finalBudget.amount / 100;
      const currentSpent = finalBudget.spentAmount / 100;
      const thresholdText = thresholdToAlert === 100 
        ? `exceeded (100% utilization: spent ${currentSpent} ${currencyStr} of ${budgetLimit} ${currencyStr})`
        : `reached ${thresholdToAlert}% utilization (spent ${currentSpent} ${currencyStr} of ${budgetLimit} ${currencyStr})`;

      const title = thresholdToAlert === 100 ? 'Budget Exceeded!' : 'Budget Warning Alert';
      const msg = `Your ${finalBudget.period.toLowerCase()} budget has ${thresholdText}.`;

      // Log activity
      await logActivity(userId, messageType, msg, finalBudget.groupId, {
        budgetId: finalBudget.id,
        threshold: thresholdToAlert,
        spent: finalBudget.spentAmount,
        limit: finalBudget.amount
      });

      // Create notification
      await createNotification(userId, title, msg);

      // Socket broadcast
      sendToUser(userId, 'BUDGET_THRESHOLD_REACHED', {
        budget: finalBudget,
        threshold: thresholdToAlert,
        utilization
      });
    }
  }
};

/**
 * Budget Reset Scheduler: Resets budgets at the start of their period.
 * Automatically archives the previous period to BudgetHistory, resets spent to 0.
 */
const resetBudgets = async (periodType) => {
  const budgets = await prisma.budget.findMany({
    where: { period: periodType }
  });

  const now = new Date();
  let periodStart, periodEnd;

  if (periodType === 'MONTHLY') {
    // History is for the month that just ended (previous month)
    const prevMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    periodStart = prevMonth;
    periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59, 999));
  } else {
    // YEARLY
    const prevYear = now.getUTCFullYear() - 1;
    periodStart = new Date(Date.UTC(prevYear, 0, 1));
    periodEnd = new Date(Date.UTC(prevYear, 11, 31, 23, 59, 59, 999));
  }

  for (const b of budgets) {
    // 1. Calculate final usage for previous period
    const finalBudget = await calculateBudgetUsage(b.id);
    if (!finalBudget) continue;

    // 2. Save previous period to history
    const historyEntry = await prisma.budgetHistory.create({
      data: {
        budgetId: b.id,
        periodStart,
        periodEnd,
        amount: finalBudget.amount,
        spent: finalBudget.spentAmount,
        remaining: finalBudget.remainingAmount,
        currency: finalBudget.currency
      }
    });

    // 3. Reset budget fields and metadata
    const resetBudget = await prisma.budget.update({
      where: { id: b.id },
      data: {
        spentAmount: 0,
        remainingAmount: b.amount,
        alertMetadata: {}, // clear cooldown for next period
        version: { increment: 1 }
      }
    });

    // 4. Log activity
    await logActivity(b.userId, 'BUDGET_RESET', `Budget reset completed for period starting ${now.toISOString().split('T')[0]}.`, b.groupId);

    // 5. Create notification
    await createNotification(b.userId, 'Budget Reset Successful', `Your ${b.period.toLowerCase()} budget has been reset for the new period.`);

    // 6. Socket emit
    sendToUser(b.userId, 'BUDGET_RESET', {
      budget: resetBudget,
      history: historyEntry
    });
  }
};

module.exports = {
  createBudget,
  updateBudget,
  deleteBudget,
  getBudgets,
  calculateBudgetUsage,
  checkBudgetAlerts,
  resetBudgets
};
