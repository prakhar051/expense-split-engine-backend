const dashboardService = require('../services/dashboardService');

/**
 * Get dashboard financial summary for the authenticated user
 */
const getDashboardSummary = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const summary = await dashboardService.getDashboardSummary(userId);
    return res.status(200).json({
      success: true,
      summary
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get dashboard spending analytics for the authenticated user
 */
const getDashboardAnalytics = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const analytics = await dashboardService.getDashboardAnalytics(userId);
    return res.status(200).json({
      success: true,
      analytics
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getDashboardSummary,
  getDashboardAnalytics
};
