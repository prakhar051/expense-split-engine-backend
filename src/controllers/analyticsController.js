const analyticsService = require('../services/analyticsService');
const forecastService = require('../services/forecastService');
const aiInsightsService = require('../services/aiInsightsService');
const analyticsCache = require('../utils/analyticsCache');
const { logActivity } = require('../services/activityService');

// Timeout wrapper helper
const withTimeout = (promise, timeoutMs = 30000) => {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error('Analytics query timeout exceeded (30 seconds).');
      err.status = 503;
      reject(err);
    }, timeoutMs);
  });

  return Promise.race([
    promise.then((res) => {
      clearTimeout(timer);
      return res;
    }),
    timeoutPromise
  ]);
};

// Main middleware/controllers
const getDashboardMetrics = async (req, res, next) => {
  const startTime = Date.now();
  const userId = req.user.id;

  try {
    // 1. Try cache
    const cached = analyticsCache.get(userId, 'dashboard');
    if (cached) {
      return res.status(200).json({
        success: true,
        data: cached,
        fromCache: true
      });
    }

    // 2. Fetch with timeout protection
    const data = await withTimeout(analyticsService.getDashboardMetrics(userId));

    // 3. Save cache
    analyticsCache.set(userId, 'dashboard', {}, data);
    analyticsCache.recordGenerationTime(Date.now() - startTime);

    return res.status(200).json({
      success: true,
      data,
      fromCache: false
    });
  } catch (error) {
    if (error.status === 503) {
      console.warn(`[Timeout Warning] getDashboardMetrics exceeded 30s. User: ${userId}`);
      await logActivity(userId, 'ANALYTICS_WARNING', 'Dashboard analytics query timed out.');
      return res.status(503).json({ success: false, message: error.message });
    }
    next(error);
  }
};

const getSpendingHeatmap = async (req, res, next) => {
  const startTime = Date.now();
  const userId = req.user.id;
  const { filter, startDate, endDate } = req.query;

  try {
    const query = { filter, startDate, endDate };
    const cached = analyticsCache.get(userId, 'heatmap', query);
    if (cached) {
      return res.status(200).json({
        success: true,
        data: cached,
        fromCache: true
      });
    }

    const data = await withTimeout(analyticsService.getSpendingHeatmap(userId, filter, startDate, endDate));

    analyticsCache.set(userId, 'heatmap', query, data);
    analyticsCache.recordGenerationTime(Date.now() - startTime);

    return res.status(200).json({
      success: true,
      data,
      fromCache: false
    });
  } catch (error) {
    if (error.status === 503) {
      return res.status(503).json({ success: false, message: error.message });
    }
    next(error);
  }
};

const getMerchantAnalytics = async (req, res, next) => {
  const startTime = Date.now();
  const userId = req.user.id;
  const { page, limit, search, sort, order } = req.query;
  const query = { page, limit, search, sort, order };

  try {
    // Top merchant query has separate cache block
    const cached = analyticsCache.get(userId, 'merchants', query);
    if (cached) {
      return res.status(200).json({
        success: true,
        ...cached,
        fromCache: true
      });
    }

    const result = await withTimeout(analyticsService.getMerchantAnalytics(userId, query));

    analyticsCache.set(userId, 'merchants', query, result);
    analyticsCache.recordGenerationTime(Date.now() - startTime);

    return res.status(200).json({
      success: true,
      ...result,
      fromCache: false
    });
  } catch (error) {
    if (error.status === 503) {
      return res.status(503).json({ success: false, message: error.message });
    }
    next(error);
  }
};

const getCategoryAnalytics = async (req, res, next) => {
  const startTime = Date.now();
  const userId = req.user.id;

  try {
    const cached = analyticsCache.get(userId, 'categories');
    if (cached) {
      return res.status(200).json({
        success: true,
        data: cached,
        fromCache: true
      });
    }

    const data = await withTimeout(analyticsService.getCategoryAnalytics(userId));

    analyticsCache.set(userId, 'categories', {}, data);
    analyticsCache.recordGenerationTime(Date.now() - startTime);

    return res.status(200).json({
      success: true,
      data,
      fromCache: false
    });
  } catch (error) {
    if (error.status === 503) {
      return res.status(503).json({ success: false, message: error.message });
    }
    next(error);
  }
};

const getForecast = async (req, res, next) => {
  const startTime = Date.now();
  const userId = req.user.id;
  const { groupId, category } = req.query;
  const query = { groupId, category };

  try {
    const cached = analyticsCache.get(userId, 'forecast', query);
    if (cached) {
      return res.status(200).json({
        success: true,
        data: cached,
        fromCache: true
      });
    }

    const data = await withTimeout(forecastService.generateForecast(userId, query));

    analyticsCache.set(userId, 'forecast', query, data);
    analyticsCache.recordGenerationTime(Date.now() - startTime);

    // Log forecast generation
    await logActivity(userId, 'FORECAST_GENERATED', 'Generated daily spending forecast.');

    return res.status(200).json({
      success: true,
      data,
      fromCache: false
    });
  } catch (error) {
    if (error.status === 503) {
      return res.status(503).json({ success: false, message: error.message });
    }
    next(error);
  }
};

const getAISpendingInsights = async (req, res, next) => {
  const startTime = Date.now();
  const userId = req.user.id;

  try {
    // Insights aren't cached in analyticsCache, they have their own DB and 24h cost protection logic
    const data = await withTimeout(aiInsightsService.getAISpendingInsights(userId));

    analyticsCache.recordGenerationTime(Date.now() - startTime);

    // Log AI insight generated
    await logActivity(userId, 'AI_INSIGHT_GENERATED', 'Generated AI spending recommendations.');

    return res.status(200).json({
      success: true,
      data
    });
  } catch (error) {
    if (error.status === 503) {
      return res.status(503).json({ success: false, message: error.message });
    }
    next(error);
  }
};

const getCacheMetrics = async (req, res, next) => {
  try {
    const metrics = analyticsCache.getMetrics();
    return res.status(200).json({
      success: true,
      metrics
    });
  } catch (error) {
    next(error);
  }
};

const getHealthReport = async (req, res, next) => {
  try {
    const metrics = analyticsCache.getMetrics();
    return res.status(200).json({
      success: true,
      health: {
        schedulerStatus: 'ACTIVE',
        cacheStatus: 'OK',
        cacheSize: metrics.cacheSize,
        cacheHitRatio: metrics.cacheHitRatio,
        lastSnapshot: new Date().toISOString(), // Mock timestamp for scheduler
        lastBudgetReset: new Date().toISOString(), // Mock timestamp
        aiServiceAvailability: process.env.GEMINI_API_KEY ? 'AVAILABLE' : 'OFFLINE',
        geminiCacheStatus: 'ACTIVE',
        uptime: metrics.uptimeSeconds
      }
    });
  } catch (error) {
    next(error);
  }
};

const getAIInsightsHistory = async (req, res, next) => {
  try {
    const history = await aiInsightsService.getAIInsightsHistory(req.user.id);
    return res.status(200).json({
      success: true,
      history
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getDashboardMetrics,
  getSpendingHeatmap,
  getMerchantAnalytics,
  getCategoryAnalytics,
  getForecast,
  getAISpendingInsights,
  getCacheMetrics,
  getHealthReport,
  getAIInsightsHistory
};
