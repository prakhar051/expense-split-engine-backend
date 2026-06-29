const crypto = require('crypto');
const prisma = require('../utils/prisma');

/**
 * Create a new group and make the creator an OWNER member.
 * Uses a Prisma transaction so both writes succeed or neither does.
 *
 * @param {string} createdById - ID of the authenticated user
 * @param {Object} data        - { name, description }
 * @returns {Promise<Object>}  - Created group with members
 */
const createGroup = async (createdById, data) => {
  const { name, description } = data;

  const group = await prisma.$transaction(async (tx) => {
    // 1. Create the group record
    const newGroup = await tx.group.create({
      data: {
        name,
        description: description || null,
        createdById
      }
    });

    // 2. Automatically add creator as OWNER member
    await tx.groupMember.create({
      data: {
        groupId: newGroup.id,
        userId: createdById,
        role: 'OWNER'
      }
    });

    // 3. Return group with members included
    return tx.group.findUnique({
      where: { id: newGroup.id },
      include: {
        members: {
          include: {
            user: {
              select: { id: true, name: true, email: true, avatar: true }
            }
          }
        }
      }
    });
  });

  // Log activity
  const creatorMember = group.members.find(m => m.userId === createdById);
  const creatorName = creatorMember ? creatorMember.user.name : 'Someone';
  const { logActivity } = require('./activityService');
  await logActivity(createdById, 'GROUP_CREATED', `${creatorName} created the group "${group.name}".`, group.id, { groupName: group.name });

  // Socket emit
  const { sendToUser } = require('../socket/socketServer');
  const SocketEvents = require('../socket/socketEvents');
  sendToUser(createdById, SocketEvents.GROUP_CREATED, { group }, createdById);

  return group;
};

/**
 * Get all groups the authenticated user belongs to.
 *
 * @param {string} userId - ID of the authenticated user
 * @returns {Promise<Array>}
 */
const getUserGroups = async (userId) => {
  const memberships = await prisma.groupMember.findMany({
    where: { userId },
    include: {
      group: {
        include: {
          members: {
            include: {
              user: {
                select: { id: true, name: true, email: true, avatar: true }
              }
            }
          }
        }
      }
    },
    orderBy: { joinedAt: 'desc' }
  });

  // Shape: attach the caller's role to each group object
  return memberships.map((m) => ({
    ...m.group,
    myRole: m.role
  }));
};

/**
 * Get a single group by ID.
 * Only returns the group if the requesting user is a member.
 *
 * @param {string} groupId - Group UUID
 * @param {string} userId  - Authenticated user ID
 * @returns {Promise<Object>}
 */
const getGroupById = async (groupId, userId) => {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: {
      members: {
        include: {
          user: {
            select: { id: true, name: true, email: true, avatar: true }
          }
        }
      }
    }
  });

  if (!group) {
    const err = new Error('Group not found');
    err.status = 404;
    throw err;
  }

  // Check membership — only active, non-banned members can view the group
  const memberObj = group.members.find((m) => m.userId === userId);
  if (!memberObj || memberObj.isBanned) {
    const err = new Error('Access denied. You are not a member of this group or have been banned.');
    err.status = 403;
    throw err;
  }

  return group;
};

/**
 * Add a user to a group.
 * Only the OWNER of the group can add members.
 * Prevents duplicate memberships.
 *
 * @param {string} groupId    - Group UUID
 * @param {string} requesterId - ID of authenticated user performing the action
 * @param {string} targetUserId - ID of the user to add
 * @returns {Promise<Object>} - New GroupMember record
 */
const addMember = async (groupId, requesterId, targetUserId) => {
  // Verify the group exists
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: { members: true }
  });

  if (!group) {
    const err = new Error('Group not found');
    err.status = 404;
    throw err;
  }

  // Only OWNER can add members
  const requesterMembership = group.members.find((m) => m.userId === requesterId);
  if (!requesterMembership || requesterMembership.role !== 'OWNER') {
    const err = new Error('Access denied. Only the group OWNER can add members.');
    err.status = 403;
    throw err;
  }

  // Check target user exists
  const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!targetUser) {
    const err = new Error('User to be added does not exist');
    err.status = 404;
    throw err;
  }

  // Prevent duplicate memberships (@@unique([groupId, userId]) also catches this at DB level)
  const alreadyMember = group.members.some((m) => m.userId === targetUserId);
  if (alreadyMember) {
    const err = new Error('User is already a member of this group');
    err.status = 400;
    throw err;
  }

  // Add the new member with default role MEMBER
  const newMember = await prisma.groupMember.create({
    data: {
      groupId,
      userId: targetUserId,
      role: 'MEMBER'
    },
    include: {
      user: {
        select: { id: true, name: true, email: true, avatar: true }
      }
    }
  });

  // Log activity and notify users
  const requesterUser = await prisma.user.findUnique({ where: { id: requesterId } });
  const requesterName = requesterUser ? requesterUser.name : 'Owner';
  const targetUserName = newMember.user.name;

  const { logActivity, createNotification, notifyGroupMembers } = require('./activityService');
  await logActivity(targetUserId, 'MEMBER_JOINED', `${targetUserName} joined the group.`, groupId);
  await createNotification(targetUserId, 'Added to Group', `You have been added to the group "${group.name}" by ${requesterName}.`);
  await notifyGroupMembers(groupId, targetUserId, 'New Member Joined', `${targetUserName} joined the group "${group.name}".`);

  // Socket emit
  const { broadcastToGroup, sendToUser } = require('../socket/socketServer');
  const SocketEvents = require('../socket/socketEvents');
  
  const fullGroup = await prisma.group.findUnique({
    where: { id: groupId },
    include: {
      members: {
        include: {
          user: {
            select: { id: true, name: true, email: true, avatar: true }
          }
        }
      }
    }
  });
  if (fullGroup) {
    sendToUser(targetUserId, SocketEvents.GROUP_CREATED, { group: fullGroup }, requesterId);
  }
  broadcastToGroup(groupId, SocketEvents.GROUP_MEMBER_JOINED, { groupId, member: newMember }, requesterId);

  return newMember;
};

/**
 * Remove a member from a group.
 * Only OWNER can remove others.
 * OWNER cannot remove themselves.
 *
 * @param {string} groupId      - Group UUID
 * @param {string} requesterId  - Authenticated user performing the removal
 * @param {string} targetUserId - User being removed
 * @returns {Promise<void>}
 */
const removeMember = async (groupId, requesterId, targetUserId) => {
  if (requesterId === targetUserId) {
    const err = new Error('Owner cannot remove themselves');
    err.status = 400;
    throw err;
  }

  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: { members: true }
  });

  if (!group) {
    const err = new Error('Group not found');
    err.status = 404;
    throw err;
  }

  // Verify requester is OWNER
  const requesterMembership = group.members.find((m) => m.userId === requesterId);
  if (!requesterMembership || requesterMembership.role !== 'OWNER') {
    const err = new Error('Access denied. Only the group OWNER can remove members.');
    err.status = 403;
    throw err;
  }

  // Target must actually be a member
  const targetMembership = group.members.find((m) => m.userId === targetUserId);
  if (!targetMembership) {
    const err = new Error('User is not a member of this group');
    err.status = 404;
    throw err;
  }

  // Prevent removing the last OWNER (would leave group ownerless)
  const owners = group.members.filter((m) => m.role === 'OWNER');
  if (targetMembership.role === 'OWNER' && owners.length === 1) {
    const err = new Error('Cannot remove the only OWNER of the group. Transfer ownership first.');
    err.status = 400;
    throw err;
  }

  const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } });
  const targetName = targetUser ? targetUser.name : 'A member';
  const requesterUser = await prisma.user.findUnique({ where: { id: requesterId } });
  const requesterName = requesterUser ? requesterUser.name : 'Owner';

  await prisma.groupMember.delete({
    where: { id: targetMembership.id }
  });

  const { logActivity, createNotification } = require('./activityService');
  await logActivity(requesterId, 'MEMBER_REMOVED', `${targetName} was removed from the group by ${requesterName}.`, groupId, { targetUserId, targetName, requesterName });
  await createNotification(targetUserId, 'Removed from Group', `You have been removed from the group "${group.name}" by ${requesterName}.`);

  // Socket emit
  const { broadcastToGroup, sendToUser } = require('../socket/socketServer');
  const SocketEvents = require('../socket/socketEvents');
  broadcastToGroup(groupId, SocketEvents.GROUP_MEMBER_LEFT, { groupId, userId: targetUserId }, requesterId);
  sendToUser(targetUserId, SocketEvents.GROUP_DELETED, { groupId }, requesterId);
};

/**
 * Allow a member to leave a group.
 * The owner cannot leave until ownership has been transferred.
 *
 * @param {string} groupId - Group UUID
 * @param {string} userId  - ID of the member leaving
 */
const leaveGroup = async (groupId, userId) => {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: { members: true }
  });

  if (!group) {
    const err = new Error('Group not found');
    err.status = 404;
    throw err;
  }

  // Find membership
  const membership = group.members.find((m) => m.userId === userId);
  if (!membership) {
    const err = new Error('You are not a member of this group');
    err.status = 404;
    throw err;
  }

  // Owner cannot leave until ownership has been transferred
  if (membership.role === 'OWNER') {
    const err = new Error('Owner cannot leave the group. Transfer ownership first.');
    err.status = 400;
    throw err;
  }

  await prisma.groupMember.delete({
    where: { id: membership.id }
  });

  const leavingUser = await prisma.user.findUnique({ where: { id: userId } });
  const leavingName = leavingUser ? leavingUser.name : 'A member';

  const { logActivity, notifyGroupMembers } = require('./activityService');
  await logActivity(userId, 'MEMBER_LEFT', `${leavingName} left the group.`, groupId, { leavingName });
  await notifyGroupMembers(groupId, userId, 'Member Left', `${leavingName} has left the group "${group.name}".`);

  // Socket emit
  const { broadcastToGroup } = require('../socket/socketServer');
  const SocketEvents = require('../socket/socketEvents');
  broadcastToGroup(groupId, SocketEvents.GROUP_MEMBER_LEFT, { groupId, userId }, userId);
};

/**
 * Transfer group ownership to another member.
 * Only the current group owner can transfer ownership.
 *
 * @param {string} groupId     - Group UUID
 * @param {string} newOwnerId  - ID of the member receiving ownership
 * @param {string} requesterId - ID of the current owner requesting transfer
 */
const transferOwnership = async (groupId, newOwnerId, requesterId) => {
  if (newOwnerId === requesterId) {
    const err = new Error('Cannot transfer ownership to yourself');
    err.status = 400;
    throw err;
  }

  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: { members: true }
  });

  if (!group) {
    const err = new Error('Group not found');
    err.status = 404;
    throw err;
  }

  // Requester must be the current owner
  const requesterMembership = group.members.find((m) => m.userId === requesterId);
  if (!requesterMembership || requesterMembership.role !== 'OWNER') {
    const err = new Error('Access denied. Only the group OWNER can transfer ownership.');
    err.status = 403;
    throw err;
  }

  // Target must already be a group member
  const targetMembership = group.members.find((m) => m.userId === newOwnerId);
  if (!targetMembership) {
    const err = new Error('Target user is not a member of this group');
    err.status = 400;
    throw err;
  }

  // Execute in one Prisma transaction
  await prisma.$transaction(async (tx) => {
    // 1. Update Group owner reference
    await tx.group.update({
      where: { id: groupId },
      data: { createdById: newOwnerId }
    });

    // 2. Previous owner role -> MEMBER
    await tx.groupMember.update({
      where: { id: requesterMembership.id },
      data: { role: 'MEMBER' }
    });

    // 3. New owner role -> OWNER
    await tx.groupMember.update({
      where: { id: targetMembership.id },
      data: { role: 'OWNER' }
    });
  });

  const requesterUser = await prisma.user.findUnique({ where: { id: requesterId } });
  const requesterName = requesterUser ? requesterUser.name : 'Former Owner';
  const newOwnerUser = await prisma.user.findUnique({ where: { id: newOwnerId } });
  const newOwnerName = newOwnerUser ? newOwnerUser.name : 'New Owner';

  const { logActivity, createNotification } = require('./activityService');
  await logActivity(requesterId, 'OWNERSHIP_TRANSFERRED', `${requesterName} transferred group ownership to ${newOwnerName}.`, groupId, { requesterName, newOwnerName, newOwnerId });
  await createNotification(newOwnerId, 'Ownership Transferred', `You are now the owner of the group "${group.name}".`);

  // Socket emit
  const { broadcastToGroup } = require('../socket/socketServer');
  const SocketEvents = require('../socket/socketEvents');
  broadcastToGroup(groupId, SocketEvents.GROUP_OWNER_TRANSFERRED, { groupId, newOwnerId }, requesterId);
};

/**
 * Helper to compute the dynamic invite status.
 *
 * @param {Object} invite
 * @returns {string}
 */
const getInviteStatus = (invite) => {
  if (invite.revokedAt !== null) return 'REVOKED';
  if (invite.usedAt !== null) return 'USED';
  if (new Date() > new Date(invite.expiresAt)) return 'EXPIRED';
  return 'ACTIVE';
};

/**
 * Format invite response consistently
 */
const formatInvite = (invite) => ({
  id: invite.id,
  code: invite.code,
  email: invite.email,
  status: getInviteStatus(invite),
  expiresAt: invite.expiresAt
});

/**
 * Create an invitation code for a group.
 * Only the OWNER can create invites.
 */
const createInvite = async (groupId, requesterId, data) => {
  const { email, expiresInHours } = data;

  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: { members: true }
  });

  if (!group) {
    const err = new Error('Group not found');
    err.status = 404;
    throw err;
  }

  const requesterMembership = group.members.find((m) => m.userId === requesterId);
  if (!requesterMembership || requesterMembership.role !== 'OWNER') {
    const err = new Error('Access denied. Only the group OWNER can create invitations.');
    err.status = 403;
    throw err;
  }

  // Generate secure unique code with collision detection
  let code;
  let isUnique = false;
  let attempts = 0;
  while (!isUnique && attempts < 10) {
    code = 'INV-' + crypto.randomBytes(8).toString('hex').toUpperCase();
    const existing = await prisma.groupInvite.findUnique({ where: { code } });
    if (!existing) {
      isUnique = true;
    }
    attempts++;
  }
  if (!isUnique) {
    const err = new Error('Failed to generate a unique invite code.');
    err.status = 500;
    throw err;
  }

  const hours = expiresInHours || 168; // default to 7 days (168 hours)
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + hours);

  const invite = await prisma.groupInvite.create({
    data: {
      groupId,
      code,
      email: email || null,
      invitedById: requesterId,
      expiresAt
    }
  });

  // Log activity
  const requesterUser = await prisma.user.findUnique({ where: { id: requesterId } });
  const requesterName = requesterUser ? requesterUser.name : 'Owner';
  const { logActivity } = require('./activityService');
  await logActivity(requesterId, 'INVITE_CREATED', `${requesterName} created an invite code.`, groupId, { inviteId: invite.id, inviteCode: invite.code });

  return formatInvite(invite);
};

/**
 * List all invites for a group.
 * Only the OWNER can see the invites.
 */
const listInvites = async (groupId, requesterId) => {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: { members: true }
  });

  if (!group) {
    const err = new Error('Group not found');
    err.status = 404;
    throw err;
  }

  const requesterMembership = group.members.find((m) => m.userId === requesterId);
  if (!requesterMembership || requesterMembership.role !== 'OWNER') {
    const err = new Error('Access denied. Only the group OWNER can view invitations.');
    err.status = 403;
    throw err;
  }

  const invites = await prisma.groupInvite.findMany({
    where: { groupId },
    orderBy: { createdAt: 'desc' }
  });

  return invites.map(formatInvite);
};

/**
 * Revoke an active invite code.
 * Only the OWNER can revoke invites.
 */
const revokeInvite = async (groupId, inviteId, requesterId) => {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: { members: true }
  });

  if (!group) {
    const err = new Error('Group not found');
    err.status = 404;
    throw err;
  }

  const requesterMembership = group.members.find((m) => m.userId === requesterId);
  if (!requesterMembership || requesterMembership.role !== 'OWNER') {
    const err = new Error('Access denied. Only the group OWNER can revoke invitations.');
    err.status = 403;
    throw err;
  }

  const invite = await prisma.groupInvite.findUnique({
    where: { id: inviteId }
  });

  if (!invite || invite.groupId !== groupId) {
    const err = new Error('Invite not found in this group');
    err.status = 404;
    throw err;
  }

  if (invite.revokedAt) {
    const err = new Error('Invite is already revoked');
    err.status = 400;
    throw err;
  }

  const updatedInvite = await prisma.groupInvite.update({
    where: { id: inviteId },
    data: { revokedAt: new Date() }
  });

  // Log activity
  const { logActivity } = require('./activityService');
  await logActivity(requesterId, 'INVITE_REVOKED', `An invite code was revoked.`, groupId, { inviteId });

  return formatInvite(updatedInvite);
};

/**
 * Join a group using an invite code.
 */
const joinGroup = async (userId, data) => {
  const { inviteCode } = data;

  const invite = await prisma.groupInvite.findUnique({
    where: { code: inviteCode }
  });

  if (!invite) {
    const err = new Error('Invalid or non-existent invite code');
    err.status = 404;
    throw err;
  }

  const status = getInviteStatus(invite);
  if (status === 'REVOKED') {
    const err = new Error('This invite has been revoked');
    err.status = 400;
    throw err;
  }
  if (status === 'USED') {
    const err = new Error('This invite has already been used');
    err.status = 400;
    throw err;
  }
  if (status === 'EXPIRED') {
    const err = new Error('This invite has expired');
    err.status = 400;
    throw err;
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  if (invite.email && invite.email.toLowerCase() !== user.email.toLowerCase()) {
    const err = new Error('This invitation was sent to a different email address');
    err.status = 403;
    throw err;
  }

  const existingMembership = await prisma.groupMember.findUnique({
    where: {
      groupId_userId: {
        groupId: invite.groupId,
        userId
      }
    }
  });

  if (existingMembership) {
    const err = new Error('You are already a member of this group');
    err.status = 400;
    throw err;
  }

  await prisma.$transaction(async (tx) => {
    await tx.groupMember.create({
      data: {
        groupId: invite.groupId,
        userId,
        role: 'MEMBER'
      }
    });

    await tx.groupInvite.update({
      where: { id: invite.id },
      data: {
        usedAt: new Date(),
        usedById: userId
      }
    });
  });

  // Log activity and notify group members
  const joinedUser = await prisma.user.findUnique({ where: { id: userId } });
  const joinedUserName = joinedUser ? joinedUser.name : 'New Member';
  const targetGroup = await prisma.group.findUnique({ where: { id: invite.groupId } });
  const groupName = targetGroup ? targetGroup.name : 'Group';

  const { logActivity, notifyGroupMembers } = require('./activityService');
  await logActivity(userId, 'MEMBER_JOINED', `${joinedUserName} joined the group.`, invite.groupId);
  await notifyGroupMembers(invite.groupId, userId, 'New Member Joined', `${joinedUserName} joined the group "${groupName}".`);

  // Socket emit
  const { broadcastToGroup } = require('../socket/socketServer');
  const SocketEvents = require('../socket/socketEvents');
  
  const joinedMemberRecord = await prisma.groupMember.findUnique({
    where: {
      groupId_userId: {
        groupId: invite.groupId,
        userId
      }
    },
    include: {
      user: {
        select: { id: true, name: true, email: true, avatar: true }
      }
    }
  });

  if (joinedMemberRecord) {
    broadcastToGroup(invite.groupId, SocketEvents.GROUP_MEMBER_JOINED, { groupId: invite.groupId, member: joinedMemberRecord }, userId);
  }

  return { groupId: invite.groupId };
};

module.exports = {
  createGroup,
  getUserGroups,
  getGroupById,
  addMember,
  removeMember,
  leaveGroup,
  transferOwnership,
  createInvite,
  listInvites,
  revokeInvite,
  joinGroup
};
