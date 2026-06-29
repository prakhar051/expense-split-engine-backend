const prisma = require('../utils/prisma');

const ROLE_HIERARCHY = {
  OWNER: 3,
  ADMIN: 2,
  MEMBER: 1
};

/**
 * Get user role in a group, returning null if not a member or banned.
 */
const getUserRole = async (groupId, userId) => {
  if (!groupId || !userId) return null;
  const membership = await prisma.groupMember.findUnique({
    where: {
      groupId_userId: { groupId, userId }
    }
  });
  if (!membership || membership.isBanned) return null;
  return membership.role;
};

/**
 * Check if user is a member of the group (not banned).
 */
const isMember = async (groupId, userId) => {
  const role = await getUserRole(groupId, userId);
  return role !== null;
};

/**
 * Check if user is an ADMIN or OWNER in the group.
 */
const isAdmin = async (groupId, userId) => {
  const role = await getUserRole(groupId, userId);
  return role === 'ADMIN' || role === 'OWNER';
};

/**
 * Check if user is the OWNER of the group.
 */
const isOwner = async (groupId, userId) => {
  const role = await getUserRole(groupId, userId);
  return role === 'OWNER';
};

/**
 * Check if user has a minimum required role.
 */
const hasPermission = async (groupId, userId, requiredRole) => {
  const role = await getUserRole(groupId, userId);
  if (!role) return false;
  return ROLE_HIERARCHY[role] >= ROLE_HIERARCHY[requiredRole];
};

/**
 * Check if user can edit/delete an expense.
 * Owners/Admins can edit/delete any expense.
 * Members can only edit/delete their own (where they are the creator).
 */
const canEditExpense = async (expenseId, userId) => {
  const expense = await prisma.expense.findUnique({
    where: { id: expenseId },
    select: { groupId: true, createdById: true }
  });
  if (!expense) return false;

  const role = await getUserRole(expense.groupId, userId);
  if (!role) return false;

  if (role === 'OWNER' || role === 'ADMIN') return true;
  return expense.createdById === userId;
};

/**
 * Check if requester can remove target user from group.
 * Owner can remove anyone except self.
 * Admin can remove MEMBERS only.
 */
const canRemoveMember = async (groupId, targetUserId, requesterId) => {
  if (targetUserId === requesterId) return false;

  const reqRole = await getUserRole(groupId, requesterId);
  const targetRole = await getUserRole(groupId, targetUserId);

  if (!reqRole || !targetRole) return false;

  if (reqRole === 'OWNER') return true;
  if (reqRole === 'ADMIN' && targetRole === 'MEMBER') return true;

  return false;
};

/**
 * Check if user can transfer group ownership (must be Owner).
 */
const canTransferOwnership = async (groupId, userId) => {
  return isOwner(groupId, userId);
};

/**
 * Check if user can delete group (must be Owner).
 */
const canDeleteGroup = async (groupId, userId) => {
  return isOwner(groupId, userId);
};

module.exports = {
  getUserRole,
  isMember,
  isAdmin,
  isOwner,
  hasPermission,
  canEditExpense,
  canRemoveMember,
  canTransferOwnership,
  canDeleteGroup
};
