const prisma = require('../utils/prisma');
const { deleteFromCloudinary } = require('../utils/cloudinary');
const exchangeRateService = require('./exchangeRateService');

const permissionService = require('./permissionService');

/**
 * Helper to check group membership
 */
const checkGroupMembership = async (groupId, userId) => {
  const membership = await prisma.groupMember.findUnique({
    where: {
      groupId_userId: { groupId, userId }
    }
  });
  return membership && !membership.isBanned;
};

/**
 * Shared helper to validate expense input and calculate split shares.
 */
const validateAndCalculateSplit = async (userId, data, currentExpense = null) => {
  const { title, description, amount, groupId, paidById, splitType, category, payers, participants } = data;
  const finalTitle = title || description;
  const finalCategory = category || 'GENERAL';

  const originalCurrency = data.originalCurrency || 'INR';
  const originalAmount = amount;

  // 1. Validation: Amount > 0
  if (originalAmount <= 0) {
    const err = new Error('Amount must be greater than 0');
    err.status = 400;
    throw err;
  }

  // Look up rates and convert
  let exchangeRate = 1.0;
  let convertedAmount = originalAmount;

  if (originalCurrency !== exchangeRateService.BASE_CURRENCY) {
    if (currentExpense && originalCurrency === currentExpense.originalCurrency) {
      exchangeRate = currentExpense.exchangeRate;
      convertedAmount = Math.round(originalAmount * exchangeRate);
    } else {
      const conversion = await exchangeRateService.convert(originalAmount, originalCurrency, exchangeRateService.BASE_CURRENCY);
      exchangeRate = conversion.rate;
      convertedAmount = conversion.amount;
    }
  }

  // 2. Validation: Group must exist
  const group = await prisma.group.findUnique({
    where: { id: groupId }
  });
  if (!group) {
    const err = new Error('Group not found');
    err.status = 404;
    throw err;
  }

  // 3. Validation: Performing user must be a group member
  const isMember = await checkGroupMembership(groupId, userId);
  if (!isMember) {
    const err = new Error('Access denied. You are not a member of this group.');
    err.status = 403;
    throw err;
  }

  // 4. Validation: At least one participant required
  if (!participants || participants.length === 0) {
    const err = new Error('At least one participant is required');
    err.status = 400;
    throw err;
  }

  // 5. Validation: No duplicate participant IDs
  const participantIds = participants.map((p) => p.userId);
  const uniqueParticipantIds = new Set(participantIds);
  if (uniqueParticipantIds.size !== participantIds.length) {
    const err = new Error('Duplicate participant IDs are not allowed');
    err.status = 400;
    throw err;
  }

  // 6. Validation: Every participant must belong to the group
  for (const pId of participantIds) {
    const isPartMember = await checkGroupMembership(groupId, pId);
    if (!isPartMember) {
      const err = new Error(`Participant with user ID ${pId} is not a member of the group`);
      err.status = 400;
      throw err;
    }
  }

  let finalPayers = [];
  let finalPaidById = null;

  if (splitType === 'MULTI_PAYER') {
    // 7a. MULTI_PAYER Specific Validations
    if (!payers || payers.length === 0) {
      const err = new Error('Payers are required for MULTI_PAYER splitType');
      err.status = 400;
      throw err;
    }

    const payerIds = payers.map((p) => p.userId);
    const uniquePayerIds = new Set(payerIds);
    if (uniquePayerIds.size !== payerIds.length) {
      const err = new Error('Duplicate payer IDs are not allowed');
      err.status = 400;
      throw err;
    }

    let sumConvertedPayers = 0;
    const convertedPayers = [];
    for (const p of payers) {
      if (p.amount <= 0 || !Number.isInteger(p.amount)) {
        const err = new Error('Payer amount must be a positive integer');
        err.status = 400;
        throw err;
      }
      const isPayerMember = await checkGroupMembership(groupId, p.userId);
      if (!isPayerMember) {
        const err = new Error(`Payer with user ID ${p.userId} is not a member of the group`);
        err.status = 400;
        throw err;
      }
      const convertedPayerAmount = Math.round(p.amount * exchangeRate);
      convertedPayers.push({
        userId: p.userId,
        amount: convertedPayerAmount
      });
      sumConvertedPayers += convertedPayerAmount;
    }

    // Adjust rounding difference to match convertedAmount exactly
    const diff = convertedAmount - sumConvertedPayers;
    if (diff !== 0 && convertedPayers.length > 0) {
      convertedPayers[0].amount += diff;
    }

    finalPayers = convertedPayers;
    finalPaidById = null;
  } else {
    // 7b. Single Payer Specific Validations
    if (!paidById) {
      const err = new Error('paidById is required');
      err.status = 400;
      throw err;
    }

    const isPayerMember = await checkGroupMembership(groupId, paidById);
    if (!isPayerMember) {
      const err = new Error('Payer must be a member of the group');
      err.status = 400;
      throw err;
    }

    finalPayers = [{ userId: paidById, amount: convertedAmount }];
    finalPaidById = paidById;
  }

  // Calculate calculated share amounts
  let calculatedShares = [];

  if (splitType === 'EQUAL' || splitType === 'MULTI_PAYER') {
    const count = participants.length;
    const baseShare = Math.floor(convertedAmount / count);
    const remainder = convertedAmount % count;

    calculatedShares = participants.map((p, idx) => {
      const extra = idx < remainder ? 1 : 0;
      return {
        userId: p.userId,
        shareAmount: baseShare + extra
      };
    });
  } else if (splitType === 'EXACT') {
    let totalCalculatedOriginal = 0;
    let sumConvertedShares = 0;

    calculatedShares = participants.map((p) => {
      if (p.amount === undefined || p.amount === null) {
        const err = new Error(`Amount is required for user ${p.userId} in EXACT split`);
        err.status = 400;
        throw err;
      }
      if (p.amount < 0) {
        const err = new Error('Exact amount cannot be negative');
        err.status = 400;
        throw err;
      }
      
      const convertedShareAmount = Math.round(p.amount * exchangeRate);
      totalCalculatedOriginal += p.amount;
      sumConvertedShares += convertedShareAmount;

      return {
        userId: p.userId,
        shareAmount: convertedShareAmount
      };
    });

    if (totalCalculatedOriginal !== originalAmount) {
      const err = new Error(`Sum of exact amounts (${totalCalculatedOriginal} cents) must equal total expense amount (${originalAmount} cents)`);
      err.status = 400;
      throw err;
    }

    // Adjust converted rounding difference to match convertedAmount exactly
    const diff = convertedAmount - sumConvertedShares;
    if (diff !== 0 && calculatedShares.length > 0) {
      calculatedShares[0].shareAmount += diff;
    }
  } else if (splitType === 'PERCENTAGE') {
    let totalPercentage = 0;
    participants.forEach((p) => {
      if (p.percentage === undefined || p.percentage === null) {
        const err = new Error(`Percentage is required for user ${p.userId} in PERCENTAGE split`);
        err.status = 400;
        throw err;
      }
      if (p.percentage <= 0) {
        const err = new Error('Percentage must be greater than 0');
        err.status = 400;
        throw err;
      }
      totalPercentage += p.percentage;
    });

    if (Math.abs(totalPercentage - 100) > 0.01) {
      const err = new Error(`Sum of percentages must equal exactly 100. Got: ${totalPercentage}`);
      err.status = 400;
      throw err;
    }

    let sumShares = 0;
    calculatedShares = participants.map((p) => {
      const share = Math.floor((p.percentage / 100) * convertedAmount);
      sumShares += share;
      return {
        userId: p.userId,
        shareAmount: share
      };
    });

    const diff = convertedAmount - sumShares;
    if (diff !== 0 && calculatedShares.length > 0) {
      calculatedShares[0].shareAmount += diff;
    }
  } else if (splitType === 'SHARE') {
    let totalShares = 0;
    participants.forEach((p) => {
      if (p.shares === undefined || p.shares === null) {
        const err = new Error(`Shares number is required for user ${p.userId} in SHARE split`);
        err.status = 400;
        throw err;
      }
      if (p.shares <= 0 || !Number.isInteger(p.shares)) {
        const err = new Error('Shares must be a positive integer');
        err.status = 400;
        throw err;
      }
      totalShares += p.shares;
    });

    let sumShares = 0;
    calculatedShares = participants.map((p) => {
      const share = Math.floor((p.shares / totalShares) * convertedAmount);
      sumShares += share;
      return {
        userId: p.userId,
        shareAmount: share
      };
    });

    const diff = convertedAmount - sumShares;
    if (diff !== 0 && calculatedShares.length > 0) {
      calculatedShares[0].shareAmount += diff;
    }
  } else {
    const err = new Error(`Invalid splitType: ${splitType}`);
    err.status = 400;
    throw err;
  }

  // Safety check
  const sumOfShares = calculatedShares.reduce((sum, s) => sum + s.shareAmount, 0);
  if (sumOfShares !== convertedAmount) {
    const err = new Error(`Internal precision error: Calculated shares sum (${sumOfShares}) does not match converted amount (${convertedAmount})`);
    err.status = 500;
    throw err;
  }

  return {
    finalTitle,
    finalCategory,
    finalPaidById,
    finalPayers,
    calculatedShares,
    originalCurrency,
    originalAmount,
    exchangeRate,
    convertedAmount,
    groupName: group.name
  };
};

/**
 * Create a new expense and calculate split shares
 */
const createExpense = async (creatorId, data, tx = null) => {
  const { groupId } = data;
  
  const {
    finalTitle,
    finalCategory,
    finalPaidById,
    finalPayers,
    calculatedShares,
    originalCurrency,
    originalAmount,
    exchangeRate,
    convertedAmount,
    groupName
  } = await validateAndCalculateSplit(creatorId, data);

  const executeOperations = async (client) => {
    // Create the main expense
    const newExpense = await client.expense.create({
      data: {
        groupId,
        title: finalTitle,
        amount: convertedAmount,
        splitType: data.splitType,
        category: finalCategory,
        paidById: finalPaidById,
        createdById: creatorId,
        createdAt: data.date ? new Date(data.date) : undefined,
        originalCurrency,
        originalAmount,
        exchangeRate,
        convertedAmount,
        metadata: data.metadata || {}
      }
    });

    // Create payer records
    await client.expensePayer.createMany({
      data: finalPayers.map((p) => ({
        expenseId: newExpense.id,
        userId: p.userId,
        amount: p.amount
      }))
    });

    // Create participant records
    await client.expenseParticipant.createMany({
      data: calculatedShares.map((s) => ({
        expenseId: newExpense.id,
        userId: s.userId,
        shareAmount: s.shareAmount
      }))
    });

    // Fetch and return the fully populated expense
    return client.expense.findUnique({
      where: { id: newExpense.id },
      include: {
        payers: {
          include: {
            user: { select: { id: true, name: true, email: true, avatar: true } }
          }
        },
        participants: {
          include: {
            user: { select: { id: true, name: true, email: true, avatar: true } }
          }
        },
        paidBy: {
          select: { id: true, name: true, email: true, avatar: true }
        },
        attachments: {
          select: {
            id: true,
            fileUrl: true,
            uploadedById: true,
            createdAt: true
          }
        }
      }
    });
  };

  const expense = tx 
    ? await executeOperations(tx) 
    : await prisma.$transaction(async (innerTx) => executeOperations(innerTx));

  if (tx) {
    return expense;
  }

  // Invalidate cache and run budget checks
  const analyticsCache = require('../utils/analyticsCache');
  const budgetService = require('./budgetService');
  const allParticipantIds = calculatedShares.map(s => s.userId);
  allParticipantIds.forEach((pId) => {
    analyticsCache.invalidateUserCache(pId);
  });

  // Log activity and notify group members
  const creatorUser = await prisma.user.findUnique({ where: { id: creatorId } });
  const creatorName = creatorUser ? creatorUser.name : 'Someone';
  const { logActivity, notifyGroupMembers } = require('./activityService');
  await logActivity(creatorId, 'EXPENSE_CREATED', `${creatorName} created the expense "${expense.title}".`, groupId, { expenseId: expense.id, expenseTitle: expense.title });
  await notifyGroupMembers(groupId, creatorId, 'New Expense Created', `${creatorName} created the expense "${expense.title}" in "${groupName}".`);

  // Socket emit
  const { broadcastToGroup, sendToUser } = require('../socket/socketServer');
  const SocketEvents = require('../socket/socketEvents');
  broadcastToGroup(groupId, SocketEvents.EXPENSE_CREATED, { expense }, creatorId);

  // Send CACHE_INVALIDATED socket to affected users and run budget alerts
  allParticipantIds.forEach((pId) => {
    sendToUser(pId, 'CACHE_INVALIDATED', { userId: pId });
  });

  for (const pId of allParticipantIds) {
    await budgetService.checkBudgetAlerts(pId, groupId, finalCategory).catch(console.error);
  }

  return expense;
};

/**
 * Update an existing expense and recalculate split shares
 */
const updateExpense = async (expenseId, userId, payload) => {
  // 1. Fetch current expense and check membership / authorization
  const currentExpense = await prisma.expense.findUnique({
    where: { id: expenseId },
    include: { group: { select: { createdById: true } } }
  });

  if (!currentExpense) {
    const err = new Error('Expense not found');
    err.status = 404;
    throw err;
  }

  const canEdit = await permissionService.canEditExpense(expenseId, userId);
  if (!canEdit) {
    const err = new Error('Access denied. Only the expense creator, group owner, or group admin can edit this expense.');
    err.status = 403;
    throw err;
  }

  // 3. Validation and split calculations (using payload group ID and amount)
  const splitData = {
    ...payload,
    groupId: currentExpense.groupId
  };

  const {
    finalTitle,
    finalCategory,
    finalPaidById,
    finalPayers,
    calculatedShares,
    originalCurrency,
    originalAmount,
    exchangeRate,
    convertedAmount,
    groupName
  } = await validateAndCalculateSplit(userId, splitData, currentExpense);

  // 4. Update inside transaction
  const updatedExpense = await prisma.$transaction(async (tx) => {
    // Delete existing participant and payer rows
    await tx.expenseParticipant.deleteMany({ where: { expenseId } });
    await tx.expensePayer.deleteMany({ where: { expenseId } });

    // Update expense metadata
    await tx.expense.update({
      where: { id: expenseId },
      data: {
        title: finalTitle,
        amount: convertedAmount,
        splitType: payload.splitType,
        category: finalCategory,
        paidById: finalPaidById,
        createdAt: payload.date ? new Date(payload.date) : undefined,
        originalCurrency,
        originalAmount,
        exchangeRate,
        convertedAmount
      }
    });

    // Create new payer records
    await tx.expensePayer.createMany({
      data: finalPayers.map((p) => ({
        expenseId,
        userId: p.userId,
        amount: p.amount
      }))
    });

    // Create new participant records
    await tx.expenseParticipant.createMany({
      data: calculatedShares.map((s) => ({
        expenseId,
        userId: s.userId,
        shareAmount: s.shareAmount
      }))
    });

    // Return the updated expense with all relations
    return tx.expense.findUnique({
      where: { id: expenseId },
      include: {
        payers: {
          include: {
            user: { select: { id: true, name: true, email: true, avatar: true } }
          }
        },
        participants: {
          include: {
            user: { select: { id: true, name: true, email: true, avatar: true } }
          }
        },
        paidBy: {
          select: { id: true, name: true, email: true, avatar: true }
        },
        attachments: {
          select: {
            id: true,
            fileUrl: true,
            uploadedById: true,
            createdAt: true
          }
        }
      }
    });
  });

  // Log activity and notify group members
  const editorUser = await prisma.user.findUnique({ where: { id: userId } });
  const editorName = editorUser ? editorUser.name : 'Someone';
  const { logActivity, notifyGroupMembers } = require('./activityService');
  
  await logActivity(userId, 'EXPENSE_UPDATED', `${editorName} updated the expense "${updatedExpense.title}".`, updatedExpense.groupId, { expenseId: updatedExpense.id, expenseTitle: updatedExpense.title });
  await notifyGroupMembers(updatedExpense.groupId, userId, 'Expense Updated', `${editorName} updated the expense "${updatedExpense.title}" in "${groupName}".`);

  // Socket emit
  const { broadcastToGroup, sendToUser } = require('../socket/socketServer');
  const SocketEvents = require('../socket/socketEvents');
  broadcastToGroup(updatedExpense.groupId, SocketEvents.EXPENSE_UPDATED, { expense: updatedExpense }, userId);

  // Invalidate cache for all affected users
  const analyticsCache = require('../utils/analyticsCache');
  const budgetService = require('./budgetService');

  const oldParticipants = await prisma.expenseParticipant.findMany({
    where: { expenseId },
    select: { userId: true }
  });
  const allAffectedUserIds = Array.from(new Set([
    ...oldParticipants.map(p => p.userId),
    ...calculatedShares.map(s => s.userId)
  ]));

  allAffectedUserIds.forEach(id => {
    analyticsCache.invalidateUserCache(id);
    sendToUser(id, 'CACHE_INVALIDATED', { userId: id });
  });

  // Check budget alerts
  for (const pId of allAffectedUserIds) {
    await budgetService.checkBudgetAlerts(pId, updatedExpense.groupId, finalCategory).catch(console.error);
  }

  return updatedExpense;
};

/**
 * Get all expenses for a group
 *
 * @param {string} groupId - Target group ID
 * @param {string} userId - Requesting user ID for authorization
 */
const getGroupExpenses = async (groupId, userId) => {
  // Check membership
  const isMember = await checkGroupMembership(groupId, userId);
  if (!isMember) {
    const err = new Error('Access denied. You are not a member of this group.');
    err.status = 403;
    throw err;
  }

  return prisma.expense.findMany({
    where: { groupId },
    orderBy: { createdAt: 'desc' },
    include: {
      payers: {
        include: {
          user: {
            select: { id: true, name: true, email: true, avatar: true }
          }
        }
      },
      participants: {
        include: {
          user: {
            select: { id: true, name: true, email: true, avatar: true }
          }
        }
      },
      paidBy: {
        select: { id: true, name: true, email: true, avatar: true }
      },
      attachments: {
        select: {
          id: true,
          fileUrl: true,
          uploadedById: true,
          createdAt: true
        }
      }
    }
  });
};

/**
 * Get detailed expense by ID
 *
 * @param {string} id - Expense ID
 * @param {string} userId - Requesting user ID for authorization
 */
const getExpenseById = async (id, userId) => {
  const expense = await prisma.expense.findUnique({
    where: { id },
    include: {
      payers: {
        include: {
          user: {
            select: { id: true, name: true, email: true, avatar: true }
          }
        }
      },
      participants: {
        include: {
          user: {
            select: { id: true, name: true, email: true, avatar: true }
          }
        }
      },
      paidBy: {
        select: { id: true, name: true, email: true, avatar: true }
      },
      attachments: {
        select: {
          id: true,
          fileUrl: true,
          uploadedById: true,
          createdAt: true
        }
      }
    }
  });

  if (!expense) {
    const err = new Error('Expense not found');
    err.status = 404;
    throw err;
  }

  // Check group membership
  const isMember = await checkGroupMembership(expense.groupId, userId);
  if (!isMember) {
    const err = new Error('Access denied. You are not a member of the group this expense belongs to.');
    err.status = 403;
    throw err;
  }

  return expense;
};

/**
 * Delete expense
 *
 * @param {string} id - Expense ID
 * @param {string} userId - Requesting user ID for authorization
 */
const deleteExpense = async (id, userId) => {
  const expense = await prisma.expense.findUnique({
    where: { id },
    include: { attachments: true }
  });

  if (!expense) {
    const err = new Error('Expense not found');
    err.status = 404;
    throw err;
  }

  // Check if user can delete
  const canDelete = await permissionService.canEditExpense(id, userId);
  if (!canDelete) {
    const err = new Error('Access denied. Only the expense creator, group owner, or group admin can delete this expense.');
    err.status = 403;
    throw err;
  }

  // Delete all Cloudinary files first
  if (expense.attachments && expense.attachments.length > 0) {
    for (const attachment of expense.attachments) {
      await deleteFromCloudinary(attachment.publicId).catch(console.error);
    }
  }

  const deleterUser = await prisma.user.findUnique({ where: { id: userId } });
  const deleterName = deleterUser ? deleterUser.name : 'Someone';

  // Fetch old participants to clear cache and budget alerts
  const oldParticipants = await prisma.expenseParticipant.findMany({
    where: { expenseId: id },
    select: { userId: true }
  });

  await prisma.expense.delete({
    where: { id }
  });

  // Log activity
  const { logActivity } = require('./activityService');
  await logActivity(userId, 'EXPENSE_DELETED', `${deleterName} deleted the expense "${expense.title}".`, expense.groupId, { expenseTitle: expense.title });

  // Socket emit
  const { broadcastToGroup, sendToUser } = require('../socket/socketServer');
  const SocketEvents = require('../socket/socketEvents');
  broadcastToGroup(expense.groupId, SocketEvents.EXPENSE_DELETED, { expenseId: id }, userId);

  // Clear cache and check budget alerts for all affected users
  const analyticsCache = require('../utils/analyticsCache');
  const budgetService = require('./budgetService');

  const allAffectedUserIds = oldParticipants.map(p => p.userId);
  allAffectedUserIds.forEach(pId => {
    analyticsCache.invalidateUserCache(pId);
    sendToUser(pId, 'CACHE_INVALIDATED', { userId: pId });
  });

  for (const pId of allAffectedUserIds) {
    await budgetService.checkBudgetAlerts(pId, expense.groupId, expense.category).catch(console.error);
  }
};

module.exports = {
  createExpense,
  updateExpense,
  getGroupExpenses,
  getExpenseById,
  deleteExpense
};
