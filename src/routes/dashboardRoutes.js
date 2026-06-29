const express = require('express');
const dashboardController = require('../controllers/dashboardController');
const exportController = require('../controllers/exportController');
const { authenticateToken } = require('../middleware/authMiddleware');

const router = express.Router();

// All dashboard endpoints require a valid access token
router.use(authenticateToken);

router.get('/summary', dashboardController.getDashboardSummary);
router.get('/analytics', dashboardController.getDashboardAnalytics);
router.get('/export/pdf', exportController.exportDashboardPDF);

module.exports = router;
