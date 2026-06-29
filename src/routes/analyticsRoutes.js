const express = require('express');
const analyticsController = require('../controllers/analyticsController');
const { authenticateToken } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(authenticateToken);

router.get('/dashboard', analyticsController.getDashboardMetrics);
router.get('/heatmap', analyticsController.getSpendingHeatmap);
router.get('/merchant-ranking', analyticsController.getMerchantAnalytics);
router.get('/categories', analyticsController.getCategoryAnalytics);
router.get('/category-trends', analyticsController.getCategoryAnalytics); // Alias/dedicated endpoint
router.get('/forecast', analyticsController.getForecast);
router.get('/insights', analyticsController.getAISpendingInsights);
router.get('/ai-history', analyticsController.getAIInsightsHistory);
router.get('/cache', analyticsController.getCacheMetrics);
router.get('/health', analyticsController.getHealthReport);

module.exports = router;
