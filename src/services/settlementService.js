const prisma = require('../utils/prisma');
const { uploadFromBuffer } = require('../utils/cloudinary');

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
 * Greedy matching algorithm to optimize debt transactions
 *
 * @param {Array} balancesList - List of user objects and their netBalance
 * @returns {Array} List of optimized settlement transactions
 */
const runGreedyMatching = (balancesList) => {
  // Filter members: Ignore balances equal to 0 (and absolute value < 1 cent)
  const nonZeroBalances = balancesList.filter((b) => Math.abs(b.netBalance) >= 1);

  // Separate into debtors and creditors
  const debtors = nonZeroBalances
    .filter((b) => b.netBalance < 0)
    .map((b) => ({
      user: b.user,
      owe: -b.netBalance
    }));

  const creditors = nonZeroBalances
    .filter((b) => b.netBalance > 0)
    .map((b) => ({
      user: b.user,
      credit: b.netBalance
    }));

  const settlements = [];

  // Greedy settlement matching
  while (debtors.length > 0 && creditors.length > 0) {
    // Deterministic sort:
    // Sort debtors descending by owe. Break ties with user ID alphabetically.
    debtors.sort((a, b) => {
      if (b.owe !== a.owe) return b.owe - a.owe;
      return a.user.id.localeCompare(b.user.id);
    });

    // Sort creditors descending by credit. Break ties with user ID alphabetically.
    creditors.sort((a, b) => {
      if (b.credit !== a.credit) return b.credit - a.credit;
      return a.user.id.localeCompare(b.user.id);
    });

    const activeDebtor = debtors[0];
    const activeCreditor = creditors[0];

    const settlementAmount = Math.min(activeDebtor.owe, activeCreditor.credit);

    settlements.push({
      from: activeDebtor.user,
      to: activeCreditor.user,
      amount: settlementAmount
    });

    activeDebtor.owe -= settlementAmount;
    activeCreditor.credit -= settlementAmount;

    // Remove settled items
    if (activeDebtor.owe === 0) {
      debtors.shift();
    }
    if (activeCreditor.credit === 0) {
      creditors.shift();
    }
  }

  // Deterministically sort final settlements:
  // Sort by from.id ascending, then to.id ascending, then amount descending.
  settlements.sort((a, b) => {
    const fromCompare = a.from.id.localeCompare(b.from.id);
    if (fromCompare !== 0) return fromCompare;

    const toCompare = a.to.id.localeCompare(b.to.id);
    if (toCompare !== 0) return toCompare;

    return b.amount - a.amount;
  });

  return settlements;
};

/**
 * Calculate balances for all members in a group (expense-based only)
 *
 * @param {string} groupId - Group UUID
 * @param {string} requesterId - Requester user ID for authorization
 */
const getGroupBalances = async (groupId, requesterId) => {
  // 1. Validate Group Exists
  const group = await prisma.group.findUnique({
    where: { id: groupId }
  });
  if (!group) {
    const err = new Error('Group not found');
    err.status = 404;
    throw err;
  }

  // 2. Validate Requester Membership
  const isRequesterMember = await checkGroupMembership(groupId, requesterId);
  if (!isRequesterMember) {
    const err = new Error('Access denied. You are not a member of this group.');
    err.status = 403;
    throw err;
  }

  // 3. Fetch all group members with user details
  const members = await prisma.groupMember.findMany({
    where: { groupId },
    include: {
      user: {
        select: { id: true, name: true, email: true }
      }
    }
  });

  // 4. Fetch all group expenses with payers and participants
  const expenses = await prisma.expense.findMany({
    where: { groupId },
    include: {
      payers: true,
      participants: true
    }
  });

  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);

  // Initialize balance map
  const balanceMap = {};
  members.forEach((m) => {
    balanceMap[m.userId] = {
      user: {
        id: m.user.id,
        name: m.user.name
      },
      totalPaid: 0,
      totalOwed: 0
    };
  });

  // Calculate totals from expenses (ExpensePayer and ExpenseParticipant)
  expenses.forEach((expense) => {
    if (expense.payers && expense.payers.length > 0) {
      expense.payers.forEach((payer) => {
        if (balanceMap[payer.userId]) {
          balanceMap[payer.userId].totalPaid += payer.amount;
        }
      });
    } else if (expense.paidById) {
      if (balanceMap[expense.paidById]) {
        balanceMap[expense.paidById].totalPaid += expense.amount;
      }
    }

    expense.participants.forEach((part) => {
      if (balanceMap[part.userId]) {
        balanceMap[part.userId].totalOwed += part.shareAmount;
      }
    });
  });

  // Format balances list
  const balancesList = Object.values(balanceMap).map((b) => ({
    user: b.user,
    totalPaid: b.totalPaid,
    totalOwed: b.totalOwed,
    netBalance: b.totalPaid - b.totalOwed
  }));

  return {
    summary: {
      totalExpenses,
      members: members.length
    },
    balances: balancesList
  };
};

/**
 * Optimize settlements on-the-fly (unpersisted, used for backward compatibility if needed)
 */
const getOptimizedSettlements = async (groupId, requesterId) => {
  const { summary, balances } = await getGroupBalances(groupId, requesterId);
  const settlements = runGreedyMatching(balances);
  
  return {
    summary: {
      totalExpenses: summary.totalExpenses,
      totalTransactions: settlements.length
    },
    settlements: settlements.map(s => ({
      from: s.from,
      to: s.to,
      amount: s.amount
    }))
  };
};

/**
 * Generate settlements and persist them in the database.
 * Takes existing PAID settlements into account to calculate adjusted balances.
 */
/**
 * Calculate adjusted balances for all members in a group, factoring in PAID settlements
 *
 * @param {string} groupId - Group UUID
 * @param {string} requesterId - Requester user ID for authorization
 * @returns {Promise<Array>} List of user adjusted balances
 */
const getGroupAdjustedBalances = async (groupId, requesterId) => {
  // 1. Fetch raw expense-based balances
  const { balances } = await getGroupBalances(groupId, requesterId);

  // 2. Fetch all PAID settlements in the group
  const paidSettlements = await prisma.settlement.findMany({
    where: {
      groupId,
      status: 'PAID'
    }
  });

  // 3. Calculate adjusted balances:
  // netBalance_adjusted = netBalance + (totalPaidSettlements - totalReceivedSettlements)
  const adjustedBalances = {};
  balances.forEach((b) => {
    adjustedBalances[b.user.id] = {
      user: b.user,
      netBalance: b.netBalance
    };
  });

  paidSettlements.forEach((settlement) => {
    if (adjustedBalances[settlement.payerId]) {
      adjustedBalances[settlement.payerId].netBalance += settlement.amount;
    }
    if (adjustedBalances[settlement.payeeId]) {
      adjustedBalances[settlement.payeeId].netBalance -= settlement.amount;
    }
  });

  return Object.values(adjustedBalances);
};

/**
 * Generate settlements and persist them in the database.
 * Takes existing PAID settlements into account to calculate adjusted balances.
 */
const generateSettlements = async (groupId, requesterId) => {
  // 1. Verify group exists and user belongs to group
  const group = await prisma.group.findUnique({
    where: { id: groupId }
  });
  if (!group) {
    const err = new Error('Group not found');
    err.status = 404;
    throw err;
  }

  const isMember = await checkGroupMembership(groupId, requesterId);
  if (!isMember) {
    const err = new Error('Access denied. You are not a member of this group.');
    err.status = 403;
    throw err;
  }

  // 2. Fetch adjusted balances
  const { summary } = await getGroupBalances(groupId, requesterId);
  const adjustedList = await getGroupAdjustedBalances(groupId, requesterId);
  console.log("[Settlement Debug] Adjusted Balances:", JSON.stringify(adjustedList, null, 2));

  const nonZero = adjustedList.filter(b => Math.abs(b.netBalance) >= 1);
  const debugDebtors = nonZero.filter(b => b.netBalance < 0).map(b => ({ user: b.user, owe: -b.netBalance }));
  const debugCreditors = nonZero.filter(b => b.netBalance > 0).map(b => ({ user: b.user, credit: b.netBalance }));
  console.log("[Settlement Debug] Debtors Queue:", JSON.stringify(debugDebtors, null, 2));
  console.log("[Settlement Debug] Creditors Queue:", JSON.stringify(debugCreditors, null, 2));

  // 3. Run optimized greedy matching on adjusted balances
  const optimized = runGreedyMatching(adjustedList);
  console.log("[Settlement Debug] Generated Settlement Amounts:", JSON.stringify(optimized, null, 2));

  // 6. In a transaction: delete all PENDING settlements, and insert new ones
  const generated = await prisma.$transaction(async (tx) => {
    // Delete existing PENDING settlements
    await tx.settlement.deleteMany({
      where: {
        groupId,
        status: 'PENDING'
      }
    });

    // Create new settlements if any
    if (optimized.length > 0) {
      await tx.settlement.createMany({
        data: optimized.map((s) => ({
          groupId,
          payerId: s.from.id,
          payeeId: s.to.id,
          amount: s.amount,
          status: 'PENDING'
        }))
      });
    }

    // Fetch and return all current stored settlements for the group
    return tx.settlement.findMany({
      where: { groupId },
      include: {
        payer: { select: { id: true, name: true } },
        payee: { select: { id: true, name: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
  });

  // Log activity and notify group members
  const { logActivity, notifyGroupMembers } = require('./activityService');
  await logActivity(requesterId, 'SETTLEMENT_GENERATED', `Optimized settlements generated.`, groupId);
  await notifyGroupMembers(groupId, requesterId, 'Settlements Recalculated', `Optimized settlements were recalculated in "${group.name}".`);

  const result = {
    summary: {
      totalExpenses: summary.totalExpenses,
      totalTransactions: generated.filter(s => s.status === 'PENDING').length
    },
    settlements: generated.map(s => ({
      id: s.id,
      payer: s.payer,
      payee: s.payee,
      amount: s.amount,
      status: s.status,
      proofUrl: s.proofUrl
    }))
  };

  // Socket emit
  const { broadcastToGroup } = require('../socket/socketServer');
  const SocketEvents = require('../socket/socketEvents');
  broadcastToGroup(groupId, SocketEvents.SETTLEMENT_GENERATED, result, requesterId);

  return result;
};

/**
 * Return stored settlements from the database
 */
const getGroupSettlements = async (groupId, requesterId) => {
  // 1. Verify group exists and user belongs to group
  const group = await prisma.group.findUnique({
    where: { id: groupId }
  });
  if (!group) {
    const err = new Error('Group not found');
    err.status = 404;
    throw err;
  }

  const isMember = await checkGroupMembership(groupId, requesterId);
  if (!isMember) {
    const err = new Error('Access denied. You are not a member of this group.');
    err.status = 403;
    throw err;
  }

  // 2. Fetch raw balances to calculate totalExpenses statistic
  const { summary } = await getGroupBalances(groupId, requesterId);

  // 3. Fetch all stored settlements for the group
  const settlements = await prisma.settlement.findMany({
    where: { groupId },
    include: {
      payer: { select: { id: true, name: true } },
      payee: { select: { id: true, name: true } }
    },
    orderBy: { createdAt: 'desc' }
  });

  return {
    summary: {
      totalExpenses: summary.totalExpenses,
      totalTransactions: settlements.length
    },
    settlements: settlements.map(s => ({
      id: s.id,
      payer: s.payer,
      payee: s.payee,
      amount: s.amount,
      status: s.status,
      proofUrl: s.proofUrl
    }))
  };
};

/**
 * Update the status of a settlement.
 * Only the payee (creditor receiving money) can confirm PENDING -> PAID or PENDING -> DISPUTED.
 */
const updateSettlementStatus = async (settlementId, userId, newStatus) => {
  // 1. Find settlement
  const settlement = await prisma.settlement.findUnique({
    where: { id: settlementId }
  });

  if (!settlement) {
    const err = new Error('Settlement not found');
    err.status = 404;
    throw err;
  }

  // 2. Check authorization: only the payee (creditor) can mark payment received
  if (settlement.payeeId !== userId) {
    const err = new Error('Access denied. Only the payee (creditor) can verify this payment.');
    err.status = 403;
    throw err;
  }

  // 3. Check transition validations: must be from PENDING to PAID or DISPUTED
  if (settlement.status !== 'PENDING') {
    const err = new Error('Invalid status transition. Settlement must be in PENDING status.');
    err.status = 400;
    throw err;
  }

  if (newStatus !== 'PAID' && newStatus !== 'DISPUTED') {
    const err = new Error('Invalid target status. Status can only be updated to PAID or DISPUTED.');
    err.status = 400;
    throw err;
  }

  // 4. Update settlement status
  const updated = await prisma.settlement.update({
    where: { id: settlementId },
    data: { status: newStatus },
    include: {
      payer: { select: { id: true, name: true } },
      payee: { select: { id: true, name: true } }
    }
  });

  // Log activity and notify the payer (debtor)
  const payeeName = updated.payee.name;
  const amountDollars = (updated.amount / 100).toFixed(2);
  const { logActivity, createNotification } = require('./activityService');

  if (newStatus === 'PAID') {
    await logActivity(userId, 'SETTLEMENT_PAID', `${payeeName} approved the settlement.`, updated.groupId, { settlementId, amount: updated.amount });
    await createNotification(updated.payerId, 'Payment Confirmed', `${payeeName} confirmed receipt of payment for $${amountDollars}.`);
  } else if (newStatus === 'DISPUTED') {
    await logActivity(userId, 'SETTLEMENT_DISPUTED', `${payeeName} disputed the settlement.`, updated.groupId, { settlementId, amount: updated.amount });
    await createNotification(updated.payerId, 'Payment Disputed', `${payeeName} disputed payment for $${amountDollars}.`);
  }

  const result = {
    id: updated.id,
    payer: updated.payer,
    payee: updated.payee,
    amount: updated.amount,
    status: updated.status,
    proofUrl: updated.proofUrl
  };

  // Socket emit
  const { broadcastToGroup, sendToUser } = require('../socket/socketServer');
  const SocketEvents = require('../socket/socketEvents');
  const specificEvent = newStatus === 'PAID' ? SocketEvents.SETTLEMENT_PAID : SocketEvents.SETTLEMENT_DISPUTED;
  broadcastToGroup(updated.groupId, specificEvent, result, userId);
  broadcastToGroup(updated.groupId, SocketEvents.SETTLEMENT_UPDATED, result, userId);

  // Invalidate cache for both payer and payee
  const analyticsCache = require('../utils/analyticsCache');
  analyticsCache.invalidateUserCache(updated.payerId);
  analyticsCache.invalidateUserCache(updated.payeeId);
  sendToUser(updated.payerId, 'CACHE_INVALIDATED', { userId: updated.payerId });
  sendToUser(updated.payeeId, 'CACHE_INVALIDATED', { userId: updated.payeeId });

  return result;
};

/**
 * Upload settlement proof of payment.
 * Only the payer (debtor sending money) can upload/update the proof url.
 */
const uploadSettlementProof = async (settlementId, userId, proofInput) => {
  // 1. Find settlement
  const settlement = await prisma.settlement.findUnique({
    where: { id: settlementId }
  });

  if (!settlement) {
    const err = new Error('Settlement not found');
    err.status = 404;
    throw err;
  }

  // 2. Check authorization: only the payer (debtor) can upload payment proof
  if (settlement.payerId !== userId) {
    const err = new Error('Access denied. Only the payer (debtor) can upload payment proof.');
    err.status = 403;
    throw err;
  }

  // 3. Verify status: can only upload proof for PENDING/DISPUTED settlements
  if (settlement.status === 'PAID') {
    const err = new Error('Cannot upload proof for an already PAID settlement.');
    err.status = 400;
    throw err;
  }

  let proofUrl = '';
  if (typeof proofInput === 'string') {
    proofUrl = proofInput;
  } else if (Array.isArray(proofInput) && proofInput.length > 0) {
    const uploadResult = await uploadFromBuffer(proofInput[0].buffer);
    proofUrl = uploadResult.secure_url;
  } else {
    const err = new Error('Proof file or proof URL is required');
    err.status = 400;
    throw err;
  }

  if (!proofUrl || proofUrl.trim().length === 0) {
    const err = new Error('Proof URL is required');
    err.status = 400;
    throw err;
  }

  // 4. Update proofUrl and reset status to PENDING
  const updated = await prisma.settlement.update({
    where: { id: settlementId },
    data: { 
      proofUrl,
      status: 'PENDING'
    },
    include: {
      payer: { select: { id: true, name: true } },
      payee: { select: { id: true, name: true } }
    }
  });

  // Log activity and notify payee (creditor)
  const payerName = updated.payer.name;
  const amountDollars = (updated.amount / 100).toFixed(2);
  const { logActivity, createNotification } = require('./activityService');
  await logActivity(userId, 'PROOF_UPLOADED', `${payerName} uploaded payment proof.`, updated.groupId, { settlementId, amount: updated.amount });
  await createNotification(updated.payeeId, 'Payment Proof Uploaded', `${payerName} uploaded payment proof for $${amountDollars}.`);

  const result = {
    id: updated.id,
    payer: updated.payer,
    payee: updated.payee,
    amount: updated.amount,
    status: updated.status,
    proofUrl: updated.proofUrl
  };

  // Socket emit
  const { broadcastToGroup, sendToUser } = require('../socket/socketServer');
  const SocketEvents = require('../socket/socketEvents');
  broadcastToGroup(updated.groupId, SocketEvents.SETTLEMENT_PROOF_UPLOADED, result, userId);
  broadcastToGroup(updated.groupId, SocketEvents.SETTLEMENT_UPDATED, result, userId);

  // Invalidate cache for both payer and payee
  const analyticsCache = require('../utils/analyticsCache');
  analyticsCache.invalidateUserCache(updated.payerId);
  analyticsCache.invalidateUserCache(updated.payeeId);
  sendToUser(updated.payerId, 'CACHE_INVALIDATED', { userId: updated.payerId });
  sendToUser(updated.payeeId, 'CACHE_INVALIDATED', { userId: updated.payeeId });

  return result;
};

module.exports = {
  getGroupBalances,
  getGroupAdjustedBalances,
  getOptimizedSettlements,
  generateSettlements,
  getGroupSettlements,
  updateSettlementStatus,
  uploadSettlementProof
};
