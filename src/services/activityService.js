const prisma = require('../utils/prisma');

/**
 * Log a group or user activity in the database.
 */
const logActivity = async (userId, type, message, groupId = null, metadata = {}) => {
  if (!userId) {
    // Bypassing because database Activity table has a required (not-null) userId field.
    return null;
  }
  try {
    const activity = await prisma.activity.create({
      data: {
        userId,
        type,
        message,
        groupId,
        metadata: metadata || {}
      }
    });

    if (groupId && activity) {
      const { broadcastToGroup } = require('../socket/socketServer');
      const SocketEvents = require('../socket/socketEvents');
      const populatedActivity = await prisma.activity.findUnique({
        where: { id: activity.id },
        include: {
          user: {
            select: { id: true, name: true, avatar: true }
          }
        }
      });
      if (populatedActivity) {
        broadcastToGroup(groupId, SocketEvents.ACTIVITY_CREATED, { activity: populatedActivity }, userId);
      }
    }

    return activity;
  } catch (error) {
    console.error('[logActivity Error] Failed to log activity:', error);
    // Silent fail to ensure primary flow is not interrupted by logging issues
  }
};

/**
 * Create a notification for a specific user.
 */
const createNotification = async (userId, title, message) => {
  try {
    const notification = await prisma.notification.create({
      data: {
        userId,
        title,
        message,
        isRead: false
      }
    });

    if (notification) {
      const { sendToUser } = require('../socket/socketServer');
      const SocketEvents = require('../socket/socketEvents');
      sendToUser(userId, SocketEvents.NOTIFICATION_CREATED, {
        id: notification.id,
        userId: notification.userId,
        title: notification.title,
        message: notification.message,
        read: notification.isRead,
        createdAt: notification.createdAt
      });
    }

    return notification;
  } catch (error) {
    console.error('[createNotification Error] Failed to create notification:', error);
  }
};

/**
 * Send notifications to all group members except the initiator of the action.
 */
const notifyGroupMembers = async (groupId, excludingUserId, title, message) => {
  try {
    const members = await prisma.groupMember.findMany({
      where: {
        groupId,
        userId: { not: excludingUserId }
      },
      select: { userId: true }
    });

    if (members.length === 0) return;

    await prisma.notification.createMany({
      data: members.map((m) => ({
        userId: m.userId,
        title,
        message,
        isRead: false
      }))
    });

    // Query and emit socket events for the newly created notifications
    const newNotifications = await prisma.notification.findMany({
      where: {
        userId: { in: members.map(m => m.userId) },
        title,
        message,
        isRead: false
      },
      orderBy: { createdAt: 'desc' },
      take: members.length
    });

    const { sendToUser } = require('../socket/socketServer');
    const SocketEvents = require('../socket/socketEvents');
    newNotifications.forEach((n) => {
      sendToUser(n.userId, SocketEvents.NOTIFICATION_CREATED, {
        id: n.id,
        userId: n.userId,
        title: n.title,
        message: n.message,
        read: n.isRead,
        createdAt: n.createdAt
      });
    });
  } catch (error) {
    console.error('[notifyGroupMembers Error] Failed to notify group members:', error);
  }
};

/**
 * Get all activities for a specific group, sorted newest first.
 */
const getGroupActivities = async (groupId) => {
  const activities = await prisma.activity.findMany({
    where: { groupId },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          avatar: true
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  });
  return activities;
};

/**
 * Get all notifications for a user, sorted newest first, mapping isRead to read.
 */
const getUserNotifications = async (userId) => {
  const notifications = await prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' }
  });

  return notifications.map((n) => ({
    id: n.id,
    userId: n.userId,
    title: n.title,
    message: n.message,
    read: n.isRead,
    createdAt: n.createdAt
  }));
};

/**
 * Mark a single notification as read.
 */
const markNotificationRead = async (notificationId, userId) => {
  const notification = await prisma.notification.findFirst({
    where: { id: notificationId, userId }
  });

  if (!notification) {
    const err = new Error('Notification not found');
    err.status = 404;
    throw err;
  }

  const updated = await prisma.notification.update({
    where: { id: notificationId },
    data: { isRead: true }
  });

  // Socket emit
  const { sendToUser } = require('../socket/socketServer');
  const SocketEvents = require('../socket/socketEvents');
  sendToUser(userId, SocketEvents.NOTIFICATION_READ, { id: notificationId }, userId);

  return {
    id: updated.id,
    userId: updated.userId,
    title: updated.title,
    message: updated.message,
    read: updated.isRead,
    createdAt: updated.createdAt
  };
};

/**
 * Mark all notifications for a user as read.
 */
const markAllNotificationsRead = async (userId) => {
  await prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true }
  });

  // Socket emit
  const { sendToUser } = require('../socket/socketServer');
  const SocketEvents = require('../socket/socketEvents');
  sendToUser(userId, SocketEvents.NOTIFICATION_READ_ALL, {}, userId);
};

module.exports = {
  logActivity,
  createNotification,
  notifyGroupMembers,
  getGroupActivities,
  getUserNotifications,
  markNotificationRead,
  markAllNotificationsRead
};
