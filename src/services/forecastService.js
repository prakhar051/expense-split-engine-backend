const permissionService = require('./permissionService');
const prisma = require('../utils/prisma');

/**
 * Fits a Linear Regression model (y = mx + c) on user's daily spend history.
 * Generates forecasts and explainability metadata.
 */
const generateForecast = async (userId, options = {}) => {
  const { groupId, category } = options;

  if (groupId) {
    const isAllowed = await permissionService.isAdmin(groupId, userId);
    if (!isAllowed) {
      const err = new Error('Access denied. Administrator privileges required to view group analytics.');
      err.status = 403;
      throw err;
    }
  }

  // 1. Fetch user's daily spend history using raw SQL for efficiency
  // This aggregates shareAmount by day at the DB level, protecting memory.
  let query = `
    SELECT DATE(e."createdAt") as date, SUM(ep."shareAmount") as total
    FROM "ExpenseParticipant" ep
    JOIN "Expense" e ON ep."expenseId" = e.id
    WHERE ep."userId" = $1
  `;
  const params = [userId];

  if (groupId) {
    params.push(groupId);
    query += ` AND e."groupId" = $${params.length}`;
  }
  if (category) {
    params.push(category);
    query += ` AND e."category" = $${params.length}::"ExpenseCategory"`;
  }

  query += `
    GROUP BY DATE(e."createdAt")
    ORDER BY date ASC
  `;

  const dailyHistory = await prisma.$queryRawUnsafe(query, ...params);

  const N = dailyHistory.length;
  let confidence = 95;
  if (N === 0) confidence = 0;
  else if (N <= 5) confidence = 20;
  else if (N <= 15) confidence = 50;
  else if (N <= 30) confidence = 75;

  let slope = 0;
  let intercept = 0;
  let expectedDailyAverage = 0;

  if (N >= 2) {
    // Linear regression fit
    // x = day index from start, y = spend in cents
    const firstDate = new Date(dailyHistory[0].date).getTime();
    const MS_PER_DAY = 24 * 60 * 60 * 1000;

    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;

    const dataPoints = dailyHistory.map((row, idx) => {
      const x = Math.round((new Date(row.date).getTime() - firstDate) / MS_PER_DAY);
      const y = Number(row.total);
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumXX += x * x;
      return { x, y };
    });

    const denominator = N * sumXX - sumX * sumX;
    if (denominator !== 0) {
      slope = (N * sumXY - sumX * sumY) / denominator;
      intercept = (sumY - slope * sumX) / N;
    } else {
      slope = 0;
      intercept = sumY / N;
    }

    // Expected daily average is calculated as average of historical daily spend
    expectedDailyAverage = Math.round(sumY / N);
  } else if (N === 1) {
    expectedDailyAverage = Number(dailyHistory[0].total);
    intercept = expectedDailyAverage;
  }

  // 2. Generate 30-day forecast array
  const forecastList = [];
  const today = new Date();
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const startTimestamp = today.getTime();

  let expectedMonthlySpend = 0;
  for (let i = 1; i <= 30; i++) {
    const forecastDate = new Date(startTimestamp + i * MS_PER_DAY);
    // Extrapolate index x from first date
    let extrapolatedVal = 0;
    if (N >= 2) {
      const firstDate = new Date(dailyHistory[0].date).getTime();
      const x = Math.round((forecastDate.getTime() - firstDate) / MS_PER_DAY);
      extrapolatedVal = Math.max(0, Math.round(slope * x + intercept));
    } else {
      extrapolatedVal = expectedDailyAverage;
    }

    forecastList.push({
      date: forecastDate.toISOString().split('T')[0],
      amount: extrapolatedVal
    });
    expectedMonthlySpend += extrapolatedVal;
  }

  // 3. 90-day forecast prediction total
  let total90DaySpend = 0;
  for (let i = 1; i <= 90; i++) {
    const forecastDate = new Date(startTimestamp + i * MS_PER_DAY);
    let extrapolatedVal = 0;
    if (N >= 2) {
      const firstDate = new Date(dailyHistory[0].date).getTime();
      const x = Math.round((forecastDate.getTime() - firstDate) / MS_PER_DAY);
      extrapolatedVal = Math.max(0, Math.round(slope * x + intercept));
    } else {
      extrapolatedVal = expectedDailyAverage;
    }
    total90DaySpend += extrapolatedVal;
  }

  // Determine trend
  let trend = "Stable";
  if (slope > 1) {
    trend = "Increasing";
  } else if (slope < -1) {
    trend = "Decreasing";
  }

  return {
    forecast: forecastList,
    forecast90DayTotal: total90DaySpend,
    confidence,
    dataPointsUsed: N,
    regressionSlope: slope,
    regressionIntercept: intercept,
    forecastMethod: "Linear Regression",
    modelVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    trend,
    expectedDailyAverage,
    expectedMonthlySpend
  };
};

function calculateLinearRegression(history, budgetLimit) {
  const dailyHistory = history.map(h => ({
    date: h.createdAt || h.date,
    total: h.amount !== undefined ? h.amount : h.total
  }));
  const N = dailyHistory.length;
  let slope = 0;
  let intercept = 0;
  let expectedDailyAverage = 0;

  if (N >= 2) {
    const firstDate = new Date(dailyHistory[0].date).getTime();
    const MS_PER_DAY = 24 * 60 * 60 * 1000;

    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;

    dailyHistory.forEach((row) => {
      const x = Math.round((new Date(row.date).getTime() - firstDate) / MS_PER_DAY);
      const y = Number(row.total);
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumXX += x * x;
    });

    const denominator = N * sumXX - sumX * sumX;
    if (denominator !== 0) {
      slope = (N * sumXY - sumX * sumY) / denominator;
      intercept = (sumY - slope * sumX) / N;
    } else {
      slope = 0;
      intercept = sumY / N;
    }
    expectedDailyAverage = Math.round(sumY / N);
  } else if (N === 1) {
    expectedDailyAverage = Number(dailyHistory[0].total);
    intercept = expectedDailyAverage;
  }

  const expectedMonthlySpend = expectedDailyAverage * 30;
  let trend = "Stable";
  if (slope > 1) trend = "Increasing";
  else if (slope < -1) trend = "Decreasing";

  const estimatedRemainingDays = expectedDailyAverage > 0 ? Math.max(0, Math.round(budgetLimit / expectedDailyAverage)) : 999;

  return {
    trend,
    expectedDailyAverage,
    expectedMonthlySpend,
    estimatedRemainingDays
  };
}

module.exports = {
  generateForecast,
  calculateLinearRegression
};
