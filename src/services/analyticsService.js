const prisma = require('../utils/prisma');
const zlib = require('zlib');

const BASE_CURRENCY = process.env.BASE_CURRENCY || 'INR';

/**
 * Helper to compress long snapshot data if > 100KB
 */
function compressData(data) {
  const jsonStr = JSON.stringify(data);
  if (jsonStr.length > 100 * 1024) {
    const compressed = zlib.gzipSync(jsonStr).toString('base64');
    return {
      isCompressed: true,
      payload: compressed
    };
  }
  return data;
}

/**
 * Helper to decompress snapshot data if compressed
 */
function decompressData(data) {
  if (data && data.isCompressed && data.payload) {
    const buffer = Buffer.from(data.payload, 'base64');
    const decompressed = zlib.gunzipSync(buffer).toString('utf-8');
    return JSON.parse(decompressed);
  }
  return data;
}

/**
 * 1. Expose Dashboard KPI Metrics & Staged Loading Structures
 */
const getDashboardMetrics = async (userId) => {
  const now = new Date();
  
  // Total Groups
  const groupCount = await prisma.groupMember.count({
    where: { userId }
  });

  // Total Budgets
  const budgetCount = await prisma.budget.count({
    where: { userId }
  });

  // Active Recurring Templates
  const activeRecurringCount = await prisma.recurringExpense.count({
    where: { createdById: userId, isActive: true, deletedAt: null }
  });

  // Total Settlements
  const settlementCount = await prisma.settlement.count({
    where: {
      OR: [
        { payerId: userId },
        { payeeId: userId }
      ]
    }
  });

  // Pending Settlements count
  const pendingSettlementCount = await prisma.settlement.count({
    where: {
      status: 'PENDING',
      OR: [
        { payerId: userId },
        { payeeId: userId }
      ]
    }
  });

  // User spend aggregates
  const participantSpend = await prisma.expenseParticipant.findMany({
    where: { userId },
    select: { shareAmount: true }
  });

  const totalSpent = participantSpend.reduce((sum, p) => sum + p.shareAmount, 0);
  const totalExpensesCount = participantSpend.length;
  const averageExpense = totalExpensesCount > 0 ? Math.round(totalSpent / totalExpensesCount) : 0;

  // Largest single expense participant share
  const maxExpenseObj = await prisma.expenseParticipant.findFirst({
    where: { userId },
    orderBy: { shareAmount: 'desc' },
    select: { shareAmount: true }
  });
  const largestExpense = maxExpenseObj ? maxExpenseObj.shareAmount : 0;

  // Calculate daily, weekly, monthly average spend based on historical range
  let avgDaily = 0;
  let avgWeekly = 0;
  let avgMonthly = 0;

  const dateBoundaries = await prisma.expenseParticipant.aggregate({
    where: { userId },
    _min: {
      expenseId: true // wait, min expenseId is not date. We want min e.createdAt. Let's find first expense
    }
  });

  const firstExpense = await prisma.expenseParticipant.findFirst({
    where: { userId },
    include: { expense: true },
    orderBy: { expense: { createdAt: 'asc' } }
  });

  if (firstExpense && firstExpense.expense) {
    const daysDiff = Math.max(1, Math.ceil((now.getTime() - new Date(firstExpense.expense.createdAt).getTime()) / (1000 * 60 * 60 * 24)));
    avgDaily = Math.round(totalSpent / daysDiff);
    avgWeekly = Math.round(totalSpent / Math.max(1, daysDiff / 7));
    avgMonthly = Math.round(totalSpent / Math.max(1, daysDiff / 30));
  } else {
    avgDaily = 0;
    avgWeekly = 0;
    avgMonthly = 0;
  }

  // Budget calculations: spent vs limits
  const budgets = await prisma.budget.findMany({
    where: { userId }
  });

  let monthlyBudgetUsage = 0;
  let yearlyBudgetUsage = 0;
  let totalMonthlyBudgetLimit = 0;
  let totalMonthlyBudgetSpent = 0;
  let totalYearlyBudgetLimit = 0;
  let totalYearlyBudgetSpent = 0;

  budgets.forEach((b) => {
    if (b.period === 'MONTHLY') {
      totalMonthlyBudgetLimit += b.amount;
      totalMonthlyBudgetSpent += b.spentAmount;
    } else {
      totalYearlyBudgetLimit += b.amount;
      totalYearlyBudgetSpent += b.spentAmount;
    }
  });

  monthlyBudgetUsage = totalMonthlyBudgetLimit > 0 ? parseFloat(((totalMonthlyBudgetSpent / totalMonthlyBudgetLimit) * 100).toFixed(2)) : 0;
  yearlyBudgetUsage = totalYearlyBudgetLimit > 0 ? parseFloat(((totalYearlyBudgetSpent / totalYearlyBudgetLimit) * 100).toFixed(2)) : 0;

  const totalSavings = Math.max(0, (totalMonthlyBudgetLimit + totalYearlyBudgetLimit) - (totalMonthlyBudgetSpent + totalYearlyBudgetSpent));

  // Determine most active merchant and fastest growing category
  const merchantQuery = `
    SELECT COALESCE(e.metadata->>'normalizedMerchant', e.title) as merchant, COUNT(e.id) as count
    FROM "ExpenseParticipant" ep
    JOIN "Expense" e ON ep."expenseId" = e.id
    WHERE ep."userId" = $1
    GROUP BY COALESCE(e.metadata->>'normalizedMerchant', e.title)
    ORDER BY count DESC
    LIMIT 1
  `;
  const merchantResult = await prisma.$queryRawUnsafe(merchantQuery, userId);
  const mostActiveMerchant = merchantResult.length > 0 ? merchantResult[0].merchant : 'N/A';

  // Category growth: compare current month spending vs previous month spending per category
  const categoriesQuery = `
    SELECT e.category, SUM(ep."shareAmount") as total
    FROM "ExpenseParticipant" ep
    JOIN "Expense" e ON ep."expenseId" = e.id
    WHERE ep."userId" = $1 AND e."createdAt" >= $2
    GROUP BY e.category
  `;
  const curMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const curMonthCats = await prisma.$queryRawUnsafe(categoriesQuery, userId, curMonthStart);
  const prevMonthCats = await prisma.$queryRawUnsafe(categoriesQuery, userId, prevMonthStart);

  let fastestGrowingCategory = 'N/A';
  let maxGrowthRate = -Infinity;

  curMonthCats.forEach((cur) => {
    const prev = prevMonthCats.find(p => p.category === cur.category);
    const prevVal = prev ? Number(prev.total) : 0;
    const curVal = Number(cur.total);
    if (prevVal > 0) {
      const growth = (curVal - prevVal) / prevVal;
      if (growth > maxGrowthRate) {
        maxGrowthRate = growth;
        fastestGrowingCategory = cur.category;
      }
    } else if (curVal > 0 && maxGrowthRate < 0) {
      // growth is technically infinity because prev was 0
      maxGrowthRate = 1.0; // 100% placeholder
      fastestGrowingCategory = cur.category;
    }
  });

  // Uptime/Velocity metrics
  const spendingVelocity = avgDaily; // spend rate per day
  
  // Average settlement delay calculation
  const completedSettlements = await prisma.settlement.findMany({
    where: {
      status: 'PAID',
      OR: [
        { payerId: userId },
        { payeeId: userId }
      ]
    },
    select: { createdAt: true, updatedAt: true }
  });
  let averageSettlementDelayHours = 0;
  if (completedSettlements.length > 0) {
    const totalDelayMs = completedSettlements.reduce((sum, s) => {
      return sum + (new Date(s.updatedAt).getTime() - new Date(s.createdAt).getTime());
    }, 0);
    averageSettlementDelayHours = Math.round(totalDelayMs / (1000 * 60 * 60 * completedSettlements.length));
  }

  return {
    totalExpenses: totalExpensesCount,
    totalGroups: groupCount,
    totalSettlements: settlementCount,
    activeRecurringTemplates: activeRecurringCount,
    totalBudgets: budgetCount,
    monthlyBudgetUsage,
    yearlyBudgetUsage,
    largestExpense,
    averageExpense,
    totalSavings,
    pendingSettlements: pendingSettlementCount,
    averageDailySpending: avgDaily,
    averageWeeklySpending: avgWeekly,
    averageMonthlySpending: avgMonthly,
    largestSpendingCategory: curMonthCats.length > 0 ? curMonthCats.sort((a,b) => Number(b.total) - Number(a.total))[0].category : 'N/A',
    largestMerchant: mostActiveMerchant,
    mostActiveMerchant,
    spendingVelocity,
    averageSettlementDelayHours,
    fastestGrowingCategory
  };
};

/**
 * 2. Get Aggregated Spending Heatmap
 */
const getSpendingHeatmap = async (userId, filter = 'month', startDate = null, endDate = null) => {
  let query = `
    SELECT DATE(e."createdAt") as date, SUM(ep."shareAmount") as total
    FROM "ExpenseParticipant" ep
    JOIN "Expense" e ON ep."expenseId" = e.id
    WHERE ep."userId" = $1
  `;
  const params = [userId];
  const now = new Date();

  if (filter === 'month') {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    params.push(monthStart);
    query += ` AND e."createdAt" >= $${params.length}`;
  } else if (filter === '3months') {
    const threeMonthsStart = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    params.push(threeMonthsStart);
    query += ` AND e."createdAt" >= $${params.length}`;
  } else if (filter === 'year') {
    const yearStart = new Date(now.getFullYear(), 0, 1);
    params.push(yearStart);
    query += ` AND e."createdAt" >= $${params.length}`;
  } else if (filter === 'custom' && startDate && endDate) {
    params.push(new Date(startDate));
    query += ` AND e."createdAt" >= $${params.length}`;
    params.push(new Date(endDate));
    query += ` AND e."createdAt" <= $${params.length}`;
  }

  query += `
    GROUP BY DATE(e."createdAt")
    ORDER BY date ASC
  `;

  const results = await prisma.$queryRawUnsafe(query, ...params);
  
  // Format as date -> amount object for chart rendering
  const heatmapData = {};
  results.forEach((row) => {
    const dateKey = row.date.toISOString().split('T')[0];
    heatmapData[dateKey] = Number(row.total);
  });

  return heatmapData;
};

/**
 * 3. Get Merchant Search Analytics
 */
const getMerchantAnalytics = async (userId, options = {}) => {
  const page = Math.max(1, parseInt(options.page || 1, 10));
  const limit = Math.min(100, Math.max(1, parseInt(options.limit || 10, 10)));
  const search = options.search ? options.search.trim() : '';
  const sort = options.sort || 'amount'; // 'amount', 'frequency', 'averageSpend'
  const order = options.order === 'asc' ? 'ASC' : 'DESC';

  let query = `
    SELECT
      COALESCE(e.metadata->>'normalizedMerchant', e.title) as merchant,
      SUM(ep."shareAmount")::bigint as "totalAmount",
      COUNT(e.id)::int as "visitCount",
      ROUND(AVG(ep."shareAmount"))::bigint as "averageSpend",
      MIN(e."createdAt") as "firstTransaction",
      MAX(e."createdAt") as "latestTransaction"
    FROM "ExpenseParticipant" ep
    JOIN "Expense" e ON ep."expenseId" = e.id
    WHERE ep."userId" = $1
  `;
  const params = [userId];

  if (search) {
    params.push(`%${search}%`);
    query += ` AND COALESCE(e.metadata->>'normalizedMerchant', e.title) ILIKE $${params.length}`;
  }

  query += ` GROUP BY COALESCE(e.metadata->>'normalizedMerchant', e.title)`;

  // Sort logic
  let sortCol = 'SUM(ep."shareAmount")';
  if (sort === 'frequency') {
    sortCol = 'COUNT(e.id)';
  } else if (sort === 'averageSpend') {
    sortCol = 'AVG(ep."shareAmount")';
  }

  query += ` ORDER BY ${sortCol} ${order}`;

  // Count total merchants for pagination metadata
  const countQuery = `
    SELECT COUNT(DISTINCT COALESCE(e.metadata->>'normalizedMerchant', e.title))::int as total
    FROM "ExpenseParticipant" ep
    JOIN "Expense" e ON ep."expenseId" = e.id
    WHERE ep."userId" = $1
    ${search ? `AND COALESCE(e.metadata->>'normalizedMerchant', e.title) ILIKE $2` : ''}
  `;
  const totalCountResult = await prisma.$queryRawUnsafe(countQuery, ...params);
  const totalCount = totalCountResult.length > 0 ? totalCountResult[0].total : 0;

  // Paginated query
  params.push(limit);
  const limitIdx = params.length;
  params.push((page - 1) * limit);
  const offsetIdx = params.length;

  query += ` LIMIT $${limitIdx} OFFSET $${offsetIdx}`;

  const rows = await prisma.$queryRawUnsafe(query, ...params);

  // Parse strings to integers
  const formattedRows = rows.map(r => ({
    merchant: r.merchant,
    totalAmount: Number(r.totalAmount),
    visitCount: Number(r.visitCount),
    averageSpend: Number(r.averageSpend),
    firstTransaction: r.firstTransaction,
    latestTransaction: r.latestTransaction,
    spendingTrend: 0 // placeholder
  }));

  return {
    data: formattedRows,
    pagination: {
      page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit)
    }
  };
};

/**
 * 4. Get Category Spending Breakdown and Monthly Trends
 */
const getCategoryAnalytics = async (userId) => {
  const now = new Date();
  
  // Category aggregates
  const categoriesQuery = `
    SELECT e.category, SUM(ep."shareAmount")::bigint as total
    FROM "ExpenseParticipant" ep
    JOIN "Expense" e ON ep."expenseId" = e.id
    WHERE ep."userId" = $1
    GROUP BY e.category
    ORDER BY total DESC
  `;
  const cats = await prisma.$queryRawUnsafe(categoriesQuery, userId);

  const breakdown = cats.map(c => ({
    category: c.category,
    total: Number(c.total)
  }));

  // Generate category monthly trends for charts (last 6 calendar months)
  const trends = {};
  const monthLabels = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthLabels.push(label);
  }

  const trendsQuery = `
    SELECT
      e.category,
      TO_CHAR(e."createdAt", 'YYYY-MM') as month,
      SUM(ep."shareAmount")::bigint as total
    FROM "ExpenseParticipant" ep
    JOIN "Expense" e ON ep."expenseId" = e.id
    WHERE ep."userId" = $1 AND e."createdAt" >= $2
    GROUP BY e.category, TO_CHAR(e."createdAt", 'YYYY-MM')
  `;
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const trendsData = await prisma.$queryRawUnsafe(trendsQuery, userId, sixMonthsAgo);

  // Pivot data for easy charts usage
  const formattedTrends = monthLabels.map((m) => {
    const entry = { month: m };
    breakdown.forEach((cat) => {
      const match = trendsData.find(t => t.category === cat.category && t.month === m);
      entry[cat.category] = match ? Number(match.total) : 0;
    });
    return entry;
  });

  return {
    breakdown,
    monthlyTrends: formattedTrends
  };
};

/**
 * 5. Get User Cash Flow Analysis (Paid vs Split Owed)
 */
const getCashFlow = async (userId) => {
  const now = new Date();
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

  // Aggregated monthly paid cash flow
  const paidQuery = `
    SELECT TO_CHAR(e."createdAt", 'YYYY-MM') as month, SUM(ep."amount")::bigint as paid
    FROM "ExpensePayer" ep
    JOIN "Expense" e ON ep."expenseId" = e.id
    WHERE ep."userId" = $1 AND e."createdAt" >= $2
    GROUP BY TO_CHAR(e."createdAt", 'YYYY-MM')
  `;
  const paidResults = await prisma.$queryRawUnsafe(paidQuery, userId, sixMonthsAgo);

  // Aggregated monthly owed obligations cash flow
  const owedQuery = `
    SELECT TO_CHAR(e."createdAt", 'YYYY-MM') as month, SUM(ep."shareAmount")::bigint as owed
    FROM "ExpenseParticipant" ep
    JOIN "Expense" e ON ep."expenseId" = e.id
    WHERE ep."userId" = $1 AND e."createdAt" >= $2
    GROUP BY TO_CHAR(e."createdAt", 'YYYY-MM')
  `;
  const owedResults = await prisma.$queryRawUnsafe(owedQuery, userId, sixMonthsAgo);

  const monthLabels = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthLabels.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  const cashFlowHistory = monthLabels.map((m) => {
    const paidMatch = paidResults.find(r => r.month === m);
    const owedMatch = owedResults.find(r => r.month === m);
    const inflow = paidMatch ? Number(paidMatch.paid) : 0;
    const outflow = owedMatch ? Number(owedMatch.owed) : 0;
    return {
      month: m,
      inflow,   // what they paid
      outflow,  // what they owed
      net: inflow - outflow
    };
  });

  return cashFlowHistory;
};

/**
 * 6. Generate and save AnalyticsSnapshot records
 */
const generateSnapshot = async (userId, period) => {
  const metrics = await getDashboardMetrics(userId);
  const heatmap = await getSpendingHeatmap(userId, 'year');
  const merchantRankings = await getMerchantAnalytics(userId, { limit: 10 });
  const categoryAnalytics = await getCategoryAnalytics(userId);
  const cashFlow = await getCashFlow(userId);

  const snapshotData = {
    metrics,
    heatmap,
    merchantRankings: merchantRankings.data,
    categoryAnalytics,
    cashFlow
  };

  const compressed = compressData(snapshotData);

  const snapshot = await prisma.analyticsSnapshot.create({
    data: {
      userId,
      period,
      data: compressed,
      schemaVersion: '1.0.0',
      appVersion: '1.0.0'
    }
  });

  return snapshot;
};

/**
 * Get historical snapshot by period, decompressing if needed
 */
const getHistoricalSnapshot = async (userId, period) => {
  const snapshot = await prisma.analyticsSnapshot.findFirst({
    where: { userId, period },
    orderBy: { generatedAt: 'desc' }
  });

  if (!snapshot) return null;

  snapshot.data = decompressData(snapshot.data);
  return snapshot;
};

module.exports = {
  getDashboardMetrics,
  getSpendingHeatmap,
  getMerchantAnalytics,
  getCategoryAnalytics,
  getCashFlow,
  generateSnapshot,
  getHistoricalSnapshot
};
