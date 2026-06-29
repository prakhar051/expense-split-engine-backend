const prisma = require('../utils/prisma');
const crypto = require('crypto');
const { broadcastToGroup, sendToUser } = require('../socket/socketServer');
const SocketEvents = require('../socket/socketEvents');
const { logActivity, createNotification } = require('./activityService');
const permissionService = require('./permissionService');

/**
 * Promoting a Member to ADMIN.
 */
const promoteMember = async (groupId, memberId, requesterId, clientVersion) => {
  const result = await prisma.$transaction(async (tx) => {
    // 1. Fetch group and check version
    const group = await tx.group.findUnique({ where: { id: groupId } });
    if (!group) {
      const err = new Error('Group not found');
      err.status = 404;
      throw err;
    }
    if (group.version !== parseInt(clientVersion, 10)) {
      const err = new Error('This group has been modified by another client. Please refresh.');
      err.status = 409;
      throw err;
    }

    // 2. Requester must be OWNER
    const reqMember = await tx.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: requesterId } }
    });
    if (!reqMember || reqMember.isBanned || reqMember.role !== 'OWNER') {
      const err = new Error('Access denied. Only the group OWNER can promote members.');
      err.status = 403;
      throw err;
    }

    // 3. Target must be MEMBER
    const targetMember = await tx.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: memberId } }
    });
    if (!targetMember || targetMember.isBanned) {
      const err = new Error('Target user is not a member of this group');
      err.status = 404;
      throw err;
    }
    if (targetMember.role !== 'MEMBER') {
      const err = new Error('Target user is already an Admin or Owner');
      err.status = 400;
      throw err;
    }

    // 4. Update role
    const updatedMember = await tx.groupMember.update({
      where: { id: targetMember.id },
      data: { role: 'ADMIN' }
    });

    // 5. Increment version
    const updatedGroup = await tx.group.update({
      where: { id: groupId },
      data: { version: { increment: 1 } }
    });

    // 6. Create AdminAction record
    const adminAction = await tx.adminAction.create({
      data: {
        groupId,
        performedBy: requesterId,
        targetUser: memberId,
        action: 'ADMIN_PROMOTED',
        metadata: { fromRole: 'MEMBER', toRole: 'ADMIN' }
      }
    });

    return { updatedMember, updatedGroup, adminAction };
  });

  const requesterUser = await prisma.user.findUnique({ where: { id: requesterId } });
  const targetUser = await prisma.user.findUnique({ where: { id: memberId } });
  const requesterName = requesterUser ? requesterUser.name : 'Owner';
  const targetName = targetUser ? targetUser.name : 'Member';

  // Log activity and create notification
  await logActivity(requesterId, 'ADMIN_PROMOTED', `${targetName} was promoted to Admin by ${requesterName}.`, groupId, { targetUserId: memberId, targetName, requesterName });
  await createNotification(memberId, 'Promoted to Admin', `You were promoted to Admin in group "${result.updatedGroup.name}" by ${requesterName}.`);

  // Socket broadcast
  const payload = {
    eventId: crypto.randomUUID(),
    timestamp: Date.now(),
    groupId,
    memberId,
    role: 'ADMIN',
    groupVersion: result.updatedGroup.version
  };
  broadcastToGroup(groupId, SocketEvents.GROUP_ROLE_UPDATED, payload, requesterId);

  // Invalidate cache
  const analyticsCache = require('../utils/analyticsCache');
  analyticsCache.invalidateUserCache(memberId);
  sendToUser(memberId, 'CACHE_INVALIDATED', { userId: memberId });

  return result;
};

/**
 * Demoting an ADMIN to MEMBER.
 */
const demoteMember = async (groupId, memberId, requesterId, clientVersion) => {
  const result = await prisma.$transaction(async (tx) => {
    // 1. Fetch group and check version
    const group = await tx.group.findUnique({ where: { id: groupId } });
    if (!group) {
      const err = new Error('Group not found');
      err.status = 404;
      throw err;
    }
    if (group.version !== parseInt(clientVersion, 10)) {
      const err = new Error('This group has been modified by another client. Please refresh.');
      err.status = 409;
      throw err;
    }

    // 2. Requester must be OWNER
    const reqMember = await tx.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: requesterId } }
    });
    if (!reqMember || reqMember.isBanned || reqMember.role !== 'OWNER') {
      const err = new Error('Access denied. Only the group OWNER can demote members.');
      err.status = 403;
      throw err;
    }

    // 3. Target must be ADMIN
    const targetMember = await tx.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: memberId } }
    });
    if (!targetMember || targetMember.isBanned) {
      const err = new Error('Target user is not a member of this group');
      err.status = 404;
      throw err;
    }
    if (targetMember.role !== 'ADMIN') {
      const err = new Error('Target user is not an Admin');
      err.status = 400;
      throw err;
    }

    // 4. Update role
    const updatedMember = await tx.groupMember.update({
      where: { id: targetMember.id },
      data: { role: 'MEMBER' }
    });

    // 5. Increment version
    const updatedGroup = await tx.group.update({
      where: { id: groupId },
      data: { version: { increment: 1 } }
    });

    // 6. Create AdminAction record
    const adminAction = await tx.adminAction.create({
      data: {
        groupId,
        performedBy: requesterId,
        targetUser: memberId,
        action: 'ADMIN_DEMOTED',
        metadata: { fromRole: 'ADMIN', toRole: 'MEMBER' }
      }
    });

    return { updatedMember, updatedGroup, adminAction };
  });

  const requesterUser = await prisma.user.findUnique({ where: { id: requesterId } });
  const targetUser = await prisma.user.findUnique({ where: { id: memberId } });
  const requesterName = requesterUser ? requesterUser.name : 'Owner';
  const targetName = targetUser ? targetUser.name : 'Member';

  // Log activity and create notification
  await logActivity(requesterId, 'ADMIN_DEMOTED', `${targetName} was demoted to Member by ${requesterName}.`, groupId, { targetUserId: memberId, targetName, requesterName });
  await createNotification(memberId, 'Demoted to Member', `You were demoted to Member in group "${result.updatedGroup.name}" by ${requesterName}.`);

  // Socket broadcast
  const payload = {
    eventId: crypto.randomUUID(),
    timestamp: Date.now(),
    groupId,
    memberId,
    role: 'MEMBER',
    groupVersion: result.updatedGroup.version
  };
  broadcastToGroup(groupId, SocketEvents.GROUP_ROLE_UPDATED, payload, requesterId);

  // Invalidate cache
  const analyticsCache = require('../utils/analyticsCache');
  analyticsCache.invalidateUserCache(memberId);
  sendToUser(memberId, 'CACHE_INVALIDATED', { userId: memberId });

  return result;
};

/**
 * Ban a Member from the group.
 */
const banMember = async (groupId, memberId, reason, requesterId, clientVersion) => {
  const result = await prisma.$transaction(async (tx) => {
    // 1. Fetch group and check version
    const group = await tx.group.findUnique({ where: { id: groupId } });
    if (!group) {
      const err = new Error('Group not found');
      err.status = 404;
      throw err;
    }
    if (group.version !== parseInt(clientVersion, 10)) {
      const err = new Error('This group has been modified by another client. Please refresh.');
      err.status = 409;
      throw err;
    }

    // 2. Requester check
    const reqMember = await tx.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: requesterId } }
    });
    if (!reqMember || reqMember.isBanned || (reqMember.role !== 'OWNER' && reqMember.role !== 'ADMIN')) {
      const err = new Error('Access denied. Administrator privileges required.');
      err.status = 403;
      throw err;
    }

    // 3. Target check
    const targetMember = await tx.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: memberId } }
    });
    if (!targetMember) {
      const err = new Error('Target user is not a member of this group');
      err.status = 404;
      throw err;
    }
    if (targetMember.isBanned) {
      const err = new Error('Target user is already banned');
      err.status = 400;
      throw err;
    }
    if (targetMember.role === 'OWNER') {
      const err = new Error('Cannot ban the group OWNER.');
      err.status = 403;
      throw err;
    }
    if (reqMember.role === 'ADMIN' && targetMember.role === 'ADMIN') {
      const err = new Error('Admins cannot ban other Admins.');
      err.status = 403;
      throw err;
    }
    if (requesterId === memberId) {
      const err = new Error('Cannot ban yourself.');
      err.status = 400;
      throw err;
    }

    // 4. Update membership ban details
    const updatedMember = await tx.groupMember.update({
      where: { id: targetMember.id },
      data: {
        isBanned: true,
        bannedAt: new Date(),
        bannedBy: requesterId,
        banReason: reason || null
      }
    });

    // 5. Increment version
    const updatedGroup = await tx.group.update({
      where: { id: groupId },
      data: { version: { increment: 1 } }
    });

    // 6. Create AdminAction record
    const adminAction = await tx.adminAction.create({
      data: {
        groupId,
        performedBy: requesterId,
        targetUser: memberId,
        action: 'MEMBER_BANNED',
        metadata: { reason: reason || 'No reason specified' }
      }
    });

    return { updatedMember, updatedGroup, adminAction };
  });

  const requesterUser = await prisma.user.findUnique({ where: { id: requesterId } });
  const targetUser = await prisma.user.findUnique({ where: { id: memberId } });
  const requesterName = requesterUser ? requesterUser.name : 'Admin';
  const targetName = targetUser ? targetUser.name : 'Member';

  // Log activity and create notification
  await logActivity(requesterId, 'MEMBER_BANNED', `${targetName} was banned from the group by ${requesterName}.`, groupId, { targetUserId: memberId, targetName, requesterName, reason });
  await createNotification(memberId, 'Banned from Group', `You were banned from the group "${result.updatedGroup.name}" by ${requesterName}.`);

  // Socket broadcast
  const payload = {
    eventId: crypto.randomUUID(),
    timestamp: Date.now(),
    groupId,
    userId: memberId,
    groupVersion: result.updatedGroup.version
  };
  broadcastToGroup(groupId, SocketEvents.GROUP_MEMBER_BANNED, payload, requesterId);
  sendToUser(memberId, SocketEvents.GROUP_DELETED, { groupId }, requesterId);

  // Invalidate cache
  const analyticsCache = require('../utils/analyticsCache');
  analyticsCache.invalidateUserCache(memberId);
  sendToUser(memberId, 'CACHE_INVALIDATED', { userId: memberId });

  return result;
};

/**
 * Unban a Member from the group.
 */
const unbanMember = async (groupId, memberId, requesterId, clientVersion) => {
  const result = await prisma.$transaction(async (tx) => {
    // 1. Fetch group and check version
    const group = await tx.group.findUnique({ where: { id: groupId } });
    if (!group) {
      const err = new Error('Group not found');
      err.status = 404;
      throw err;
    }
    if (group.version !== parseInt(clientVersion, 10)) {
      const err = new Error('This group has been modified by another client. Please refresh.');
      err.status = 409;
      throw err;
    }

    // 2. Requester check
    const reqMember = await tx.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: requesterId } }
    });
    if (!reqMember || reqMember.isBanned || (reqMember.role !== 'OWNER' && reqMember.role !== 'ADMIN')) {
      const err = new Error('Access denied. Administrator privileges required.');
      err.status = 403;
      throw err;
    }

    // 3. Target check
    const targetMember = await tx.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: memberId } }
    });
    if (!targetMember) {
      const err = new Error('Target user is not in this group');
      err.status = 404;
      throw err;
    }
    if (!targetMember.isBanned) {
      const err = new Error('Target user is not banned');
      err.status = 400;
      throw err;
    }

    // 4. Update membership ban status (keep original ban details for audit trace)
    const updatedMember = await tx.groupMember.update({
      where: { id: targetMember.id },
      data: {
        isBanned: false
      }
    });

    // 5. Increment version
    const updatedGroup = await tx.group.update({
      where: { id: groupId },
      data: { version: { increment: 1 } }
    });

    // 6. Create AdminAction record
    const adminAction = await tx.adminAction.create({
      data: {
        groupId,
        performedBy: requesterId,
        targetUser: memberId,
        action: 'MEMBER_UNBANNED',
        metadata: {}
      }
    });

    return { updatedMember, updatedGroup, adminAction };
  });

  const requesterUser = await prisma.user.findUnique({ where: { id: requesterId } });
  const targetUser = await prisma.user.findUnique({ where: { id: memberId } });
  const requesterName = requesterUser ? requesterUser.name : 'Admin';
  const targetName = targetUser ? targetUser.name : 'Member';

  // Log activity and create notification
  await logActivity(requesterId, 'MEMBER_UNBANNED', `${targetName} was unbanned by ${requesterName}.`, groupId, { targetUserId: memberId, targetName, requesterName });
  await createNotification(memberId, 'Unbanned from Group', `You were unbanned from the group "${result.updatedGroup.name}" by ${requesterName}.`);

  // Socket broadcast
  const payload = {
    eventId: crypto.randomUUID(),
    timestamp: Date.now(),
    groupId,
    userId: memberId,
    groupVersion: result.updatedGroup.version
  };
  broadcastToGroup(groupId, SocketEvents.GROUP_MEMBER_UNBANNED, payload, requesterId);

  // Invalidate cache
  const analyticsCache = require('../utils/analyticsCache');
  analyticsCache.invalidateUserCache(memberId);
  sendToUser(memberId, 'CACHE_INVALIDATED', { userId: memberId });

  return result;
};

/**
 * Remove a member from the group.
 */
const removeMember = async (groupId, targetUserId, requesterId, clientVersion) => {
  const result = await prisma.$transaction(async (tx) => {
    // 1. Fetch group and check version
    const group = await tx.group.findUnique({ where: { id: groupId } });
    if (!group) {
      const err = new Error('Group not found');
      err.status = 404;
      throw err;
    }
    if (group.version !== parseInt(clientVersion, 10)) {
      const err = new Error('This group has been modified by another client. Please refresh.');
      err.status = 409;
      throw err;
    }

    // 2. Verify authorization
    const isAllowed = await permissionService.canRemoveMember(groupId, targetUserId, requesterId);
    if (!isAllowed) {
      const err = new Error('Access denied. Insufficient permissions to remove this member.');
      err.status = 403;
      throw err;
    }

    const targetMembership = await tx.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: targetUserId } }
    });

    // 3. Delete membership
    await tx.groupMember.delete({
      where: { id: targetMembership.id }
    });

    // 4. Increment version
    const updatedGroup = await tx.group.update({
      where: { id: groupId },
      data: { version: { increment: 1 } }
    });

    // 5. Create AdminAction record
    const adminAction = await tx.adminAction.create({
      data: {
        groupId,
        performedBy: requesterId,
        targetUser: targetUserId,
        action: 'MEMBER_REMOVED',
        metadata: {}
      }
    });

    return { updatedGroup, adminAction };
  });

  const requesterUser = await prisma.user.findUnique({ where: { id: requesterId } });
  const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } });
  const requesterName = requesterUser ? requesterUser.name : 'Admin';
  const targetName = targetUser ? targetUser.name : 'Member';

  // Log activity and create notification
  await logActivity(requesterId, 'MEMBER_REMOVED', `${targetName} was removed from the group by ${requesterName}.`, groupId, { targetUserId, targetName, requesterName });
  await createNotification(targetUserId, 'Removed from Group', `You have been removed from the group "${result.updatedGroup.name}" by ${requesterName}.`);

  // Socket emit
  const payload = {
    eventId: crypto.randomUUID(),
    timestamp: Date.now(),
    groupId,
    userId: targetUserId,
    groupVersion: result.updatedGroup.version
  };
  broadcastToGroup(groupId, SocketEvents.GROUP_MEMBER_REMOVED, payload, requesterId);
  sendToUser(targetUserId, SocketEvents.GROUP_DELETED, { groupId }, requesterId);

  // Invalidate cache
  const analyticsCache = require('../utils/analyticsCache');
  analyticsCache.invalidateUserCache(targetUserId);
  sendToUser(targetUserId, 'CACHE_INVALIDATED', { userId: targetUserId });

  return { success: true };
};

/**
 * Allow a member to leave a group.
 */
const leaveGroup = async (groupId, userId) => {
  const result = await prisma.$transaction(async (tx) => {
    // 1. Fetch group
    const group = await tx.group.findUnique({
      where: { id: groupId },
      include: { members: true }
    });
    if (!group) {
      const err = new Error('Group not found');
      err.status = 404;
      throw err;
    }

    // 2. Find membership
    const membership = group.members.find((m) => m.userId === userId);
    if (!membership || membership.isBanned) {
      const err = new Error('You are not a member of this group');
      err.status = 404;
      throw err;
    }

    // 3. Owner cannot leave if they are the only OWNER
    if (membership.role === 'OWNER') {
      const err = new Error('Owner cannot leave the group. Transfer ownership first.');
      err.status = 400;
      throw err;
    }

    // 4. Delete membership
    await tx.groupMember.delete({
      where: { id: membership.id }
    });

    // 5. Increment version
    const updatedGroup = await tx.group.update({
      where: { id: groupId },
      data: { version: { increment: 1 } }
    });

    // 6. Create AdminAction record (leaves are audited in history)
    const adminAction = await tx.adminAction.create({
      data: {
        groupId,
        performedBy: userId,
        targetUser: userId,
        action: 'MEMBER_LEFT',
        metadata: {}
      }
    });

    return { updatedGroup, adminAction };
  });

  const leavingUser = await prisma.user.findUnique({ where: { id: userId } });
  const leavingName = leavingUser ? leavingUser.name : 'A member';

  // Log activity
  await logActivity(userId, 'MEMBER_LEFT', `${leavingName} left the group.`, groupId, { leavingName });

  // Socket emit
  const payload = {
    eventId: crypto.randomUUID(),
    timestamp: Date.now(),
    groupId,
    userId,
    groupVersion: result.updatedGroup.version
  };
  broadcastToGroup(groupId, SocketEvents.GROUP_MEMBER_LEFT, payload, userId);

  // Invalidate cache
  const analyticsCache = require('../utils/analyticsCache');
  analyticsCache.invalidateUserCache(userId);
  sendToUser(userId, 'CACHE_INVALIDATED', { userId });

  return { success: true };
};

/**
 * Transfer group ownership to another member.
 */
const transferOwnership = async (groupId, newOwnerId, requesterId, clientVersion) => {
  if (newOwnerId === requesterId) {
    const err = new Error('Cannot transfer ownership to yourself');
    err.status = 400;
    throw err;
  }

  const result = await prisma.$transaction(async (tx) => {
    // 1. Fetch group and check version
    const group = await tx.group.findUnique({
      where: { id: groupId },
      include: { members: true }
    });
    if (!group) {
      const err = new Error('Group not found');
      err.status = 404;
      throw err;
    }
    if (group.version !== parseInt(clientVersion, 10)) {
      const err = new Error('This group has been modified by another client. Please refresh.');
      err.status = 409;
      throw err;
    }

    // 2. Requester must be current owner
    const requesterMembership = group.members.find((m) => m.userId === requesterId);
    if (!requesterMembership || requesterMembership.isBanned || requesterMembership.role !== 'OWNER') {
      const err = new Error('Access denied. Only the group OWNER can transfer ownership.');
      err.status = 403;
      throw err;
    }

    // 3. Target must be active group member
    const targetMembership = group.members.find((m) => m.userId === newOwnerId);
    if (!targetMembership || targetMembership.isBanned) {
      const err = new Error('Target user is not an active member of this group');
      err.status = 400;
      throw err;
    }

    // 4. Update ownership references
    await tx.group.update({
      where: { id: groupId },
      data: {
        createdById: newOwnerId,
        version: { increment: 1 }
      }
    });

    // 5. Update roles
    await tx.groupMember.update({
      where: { id: requesterMembership.id },
      data: { role: 'MEMBER' }
    });

    await tx.groupMember.update({
      where: { id: targetMembership.id },
      data: { role: 'OWNER' }
    });

    // Fetch updated version to return
    const updatedGroup = await tx.group.findUnique({ where: { id: groupId } });

    // 6. Create AdminAction record
    const adminAction = await tx.adminAction.create({
      data: {
        groupId,
        performedBy: requesterId,
        targetUser: newOwnerId,
        action: 'OWNER_TRANSFERRED',
        metadata: { fromOwner: requesterId, toOwner: newOwnerId }
      }
    });

    return { updatedGroup, adminAction };
  });

  const requesterUser = await prisma.user.findUnique({ where: { id: requesterId } });
  const requesterName = requesterUser ? requesterUser.name : 'Former Owner';
  const newOwnerUser = await prisma.user.findUnique({ where: { id: newOwnerId } });
  const newOwnerName = newOwnerUser ? newOwnerUser.name : 'New Owner';

  // Log activity and notify target
  await logActivity(requesterId, 'OWNER_TRANSFERRED', `${requesterName} transferred group ownership to ${newOwnerName}.`, groupId, { requesterName, newOwnerName, newOwnerId });
  await createNotification(newOwnerId, 'Ownership Transferred', `Ownership of group "${result.updatedGroup.name}" has been transferred to you.`);

  // Socket emit
  const payload = {
    eventId: crypto.randomUUID(),
    timestamp: Date.now(),
    groupId,
    newOwnerId,
    groupVersion: result.updatedGroup.version
  };
  broadcastToGroup(groupId, SocketEvents.GROUP_OWNER_TRANSFERRED, payload, requesterId);

  // Invalidate cache
  const analyticsCache = require('../utils/analyticsCache');
  analyticsCache.invalidateUserCache(requesterId);
  analyticsCache.invalidateUserCache(newOwnerId);
  sendToUser(requesterId, 'CACHE_INVALIDATED', { userId: requesterId });
  sendToUser(newOwnerId, 'CACHE_INVALIDATED', { userId: newOwnerId });

  return result;
};

/**
 * Fetch group members.
 */
const getGroupMembers = async (groupId, requesterId) => {
  const isMember = await permissionService.isMember(groupId, requesterId);
  if (!isMember) {
    const err = new Error('Access denied. You are not a member of this group.');
    err.status = 403;
    throw err;
  }

  return prisma.groupMember.findMany({
    where: { groupId },
    include: {
      user: {
        select: { id: true, name: true, email: true, avatar: true }
      }
    },
    orderBy: { joinedAt: 'asc' }
  });
};

/**
 * Fetch group admins.
 */
const getGroupAdmins = async (groupId, requesterId) => {
  const isMember = await permissionService.isMember(groupId, requesterId);
  if (!isMember) {
    const err = new Error('Access denied. You are not a member of this group.');
    err.status = 403;
    throw err;
  }

  return prisma.groupMember.findMany({
    where: {
      groupId,
      role: { in: ['OWNER', 'ADMIN'] }
    },
    include: {
      user: {
        select: { id: true, name: true, email: true, avatar: true }
      }
    },
    orderBy: { role: 'asc' }
  });
};

/**
 * Fetch admin audit action logs.
 */
const getAdminActions = async (groupId, requesterId) => {
  const isMember = await permissionService.isMember(groupId, requesterId);
  if (!isMember) {
    const err = new Error('Access denied. You are not a member of this group.');
    err.status = 403;
    throw err;
  }

  return prisma.adminAction.findMany({
    where: { groupId },
    orderBy: { createdAt: 'desc' }
  });
};

/**
 * Delete a group (Only group OWNER).
 */
const deleteGroup = async (groupId, requesterId) => {
  return prisma.$transaction(async (tx) => {
    // 1. Fetch group
    const group = await tx.group.findUnique({ where: { id: groupId } });
    if (!group) {
      const err = new Error('Group not found');
      err.status = 404;
      throw err;
    }

    // 2. Requester must be OWNER
    const reqMember = await tx.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: requesterId } }
    });
    if (!reqMember || reqMember.isBanned || reqMember.role !== 'OWNER') {
      const err = new Error('Access denied. Only the group OWNER can delete the group.');
      err.status = 403;
      throw err;
    }

    // 3. Delete group
    await tx.group.delete({
      where: { id: groupId }
    });

    return { success: true };
  });
};

module.exports = {
  promoteMember,
  demoteMember,
  banMember,
  unbanMember,
  removeMember,
  leaveGroup,
  transferOwnership,
  getGroupMembers,
  getGroupAdmins,
  getAdminActions,
  deleteGroup
};

