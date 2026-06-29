const activityService = require('../services/activityService');

const handleServiceError = (res, next, error) => {
  if (error.status) {
    return res.status(error.status).json({
      success: false,
      message: error.message
    });
  }
  next(error);
};

/**
 * GET /api/groups/:groupId/activity
 */
const getGroupActivity = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const activities = await activityService.getGroupActivities(groupId);

    return res.status(200).json({
      success: true,
      activities
    });
  } catch (error) {
    handleServiceError(res, next, error);
  }
};

/**
 * GET /api/notifications
 */
const getNotifications = async (req, res, next) => {
  try {
    const notifications = await activityService.getUserNotifications(req.user.id);

    return res.status(200).json({
      success: true,
      notifications
    });
  } catch (error) {
    handleServiceError(res, next, error);
  }
};

/**
 * PATCH /api/notifications/:id/read
 */
const markRead = async (req, res, next) => {
  try {
    const { id } = req.params;
    const notification = await activityService.markNotificationRead(id, req.user.id);

    return res.status(200).json({
      success: true,
      notification
    });
  } catch (error) {
    handleServiceError(res, next, error);
  }
};

/**
 * PATCH /api/notifications/read-all
 */
const markAllRead = async (req, res, next) => {
  try {
    await activityService.markAllNotificationsRead(req.user.id);

    return res.status(200).json({
      success: true,
      message: 'All notifications marked as read'
    });
  } catch (error) {
    handleServiceError(res, next, error);
  }
};

module.exports = {
  getGroupActivity,
  getNotifications,
  markRead,
  markAllRead
};
