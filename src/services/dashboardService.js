const prisma = require('../utils/prisma');
const settlementService = require('./settlementService');

/**
 * Get financial summary for a user across all groups they belong to
 *
 * @param {string} userId - User UUID
 * @returns {Promise<Object>} Dashboard summary
 */
const getDashboardSummary = async (userId) => {
  // 1. Fetch all group memberships of the user
  const memberships = await prisma.groupMember.findMany({
    where: { userId },
    select: { groupId: true }
  });

  const groupIds = memberships.map((m) => m.groupId);
  const groupsCount = groupIds.length;

  let totalOwedToYou = 0;
  let totalYouOwe = 0;

  // 2. Fetch adjusted balances for each group in parallel
  const balancePromises = groupIds.map(async (groupId) => {
    try {
      const adjustedBalances = await settlementService.getGroupAdjustedBalances(groupId, userId);
      const myBalance = adjustedBalances.find((b) => b.user.id === userId);
      return myBalance ? myBalance.netBalance : 0;
    } catch (err) {
      console.error(`[Dashboard Service] Error calculating balance for group ${groupId}:`, err);
      return 0;
    }
  });

  const netBalances = await Promise.all(balancePromises);

  netBalances.forEach((netBalance) => {
    if (netBalance > 0) {
      totalOwedToYou += netBalance;
    } else if (netBalance < 0) {
      totalYouOwe += Math.abs(netBalance);
    }
  });

  const totalNetBalance = totalOwedToYou - totalYouOwe;

  // Query recurring expense scheduler statistics for the dashboard
  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);

  const activeRecurringCount = await prisma.recurringExpense.count({
    where: { createdById: userId, isActive: true, deletedAt: null }
  });

  const pausedRecurringCount = await prisma.recurringExpense.count({
    where: { createdById: userId, isActive: false, deletedAt: null }
  });

  const executionsTodayCount = await prisma.recurringExecution.count({
    where: {
      template: { createdById: userId },
      executedAt: { gte: startOfToday }
    }
  });

  const failedExecutionsCount = await prisma.recurringExecution.count({
    where: {
      template: { createdById: userId },
      status: 'FAILED',
      executedAt: { gte: startOfToday }
    }
  });

  const nextExecution = await prisma.recurringExpense.findFirst({
    where: { createdById: userId, isActive: true, deletedAt: null },
    orderBy: { nextRunAt: 'asc' },
    select: { nextRunAt: true }
  });

  const nextScheduledExecution = nextExecution ? nextExecution.nextRunAt : null;

  return {
    totalNetBalance,
    totalOwedToYou,
    totalYouOwe,
    groups: groupsCount,
    activeRecurringCount,
    pausedRecurringCount,
    executionsTodayCount,
    failedExecutionsCount,
    nextScheduledExecution
  };
};

/**
 * Get analytics for a user (category breakdown & monthly trends)
 *
 * @param {string} userId - User UUID
 * @returns {Promise<Object>} Dashboard analytics
 */
const getDashboardAnalytics = async (userId) => {
  // 1. Fetch all expense participant records for the user in a single query
  // to avoid N+1 queries. Include the associated expense details.
  const participants = await prisma.expenseParticipant.findMany({
    where: { userId },
    select: {
      shareAmount: true,
      expense: {
        select: {
          category: true,
          createdAt: true
        }
      }
    }
  });

  // 2. Category Breakdown
  // Aggregate user's personal shareAmount by category
  const categoryMap = {};
  participants.forEach((p) => {
    const category = p.expense.category;
    categoryMap[category] = (categoryMap[category] || 0) + p.shareAmount;
  });

  // Convert to array and sort by spent descending
  const categoryBreakdown = Object.entries(categoryMap)
    .map(([category, spent]) => ({
      category,
      spent
    }))
    .sort((a, b) => b.spent - a.spent);

  // 3. Monthly Trends
  // Generate exactly the last 6 calendar months chronologically
  const monthlyTrends = [];
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  const today = new Date();
  const lastSix = [];

  for (let i = 5; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    lastSix.push({
      year: d.getFullYear(),
      monthIndex: d.getMonth(),
      name: monthNames[d.getMonth()]
    });
  }

  // Map to store sum of spent for each of the 6 months
  const trendsMap = {};
  lastSix.forEach((m) => {
    trendsMap[`${m.year}-${m.monthIndex}`] = 0;
  });

  // Aggregate user's personal shareAmount for matching months
  participants.forEach((p) => {
    const expDate = new Date(p.expense.createdAt);
    const key = `${expDate.getFullYear()}-${expDate.getMonth()}`;
    if (trendsMap[key] !== undefined) {
      trendsMap[key] += p.shareAmount;
    }
  });

  // Convert to sorted chronological array containing spent and personalSpent
  lastSix.forEach((m) => {
    const spentVal = trendsMap[`${m.year}-${m.monthIndex}`];
    monthlyTrends.push({
      month: m.name,
      spent: spentVal,
      personalSpent: spentVal
    });
  });

  return {
    categoryBreakdown,
    monthlyTrends
  };
};

module.exports = {
  getDashboardSummary,
  getDashboardAnalytics
};
