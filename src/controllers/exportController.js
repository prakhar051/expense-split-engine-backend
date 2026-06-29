const prisma = require('../utils/prisma');
const exportService = require('../services/exportService');
const activityService = require('../services/activityService');

const sanitizeFilename = (name) => {
  if (!name) return 'report';
  return name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
};

const getLocalDateString = () => {
  return new Date().toISOString().split('T')[0];
};

/**
 * Verifies group existence and membership
 */
const verifyGroupMember = async (groupId, userId) => {
  const group = await prisma.group.findUnique({
    where: { id: groupId }
  });

  if (!group) {
    const err = new Error('Group not found');
    err.status = 404;
    throw err;
  }

  const membership = await prisma.groupMember.findUnique({
    where: {
      groupId_userId: {
        groupId,
        userId
      }
    }
  });

  if (!membership) {
    const err = new Error('Access denied. You are not a member of this group.');
    err.status = 403;
    throw err;
  }

  return group;
};

/**
 * GET /api/groups/:groupId/export/csv
 */
const exportGroupExpensesCSV = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const group = await verifyGroupMember(groupId, req.user.id);
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const userName = user ? user.name : 'Someone';

    const csvData = await exportService.exportExpensesCSV(groupId);
    const dateStr = getLocalDateString();
    const filename = `expenses-${sanitizeFilename(group.name)}-${dateStr}.csv`;

    // Log Export activity
    await activityService.logActivity(
      req.user.id,
      'REPORT_EXPORTED',
      `${userName} exported Expenses CSV.`,
      groupId
    );

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(csvData);
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/groups/:groupId/export/pdf
 */
const exportGroupExpensesPDF = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const group = await verifyGroupMember(groupId, req.user.id);
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const userName = user ? user.name : 'Someone';

    const dateStr = getLocalDateString();
    const filename = `expenses-${sanitizeFilename(group.name)}-${dateStr}.pdf`;

    // Log Export activity
    await activityService.logActivity(
      req.user.id,
      'REPORT_EXPORTED',
      `${userName} exported Expenses PDF.`,
      groupId
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    await exportService.exportExpensesPDF(groupId, res, req.user.id);
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/groups/:groupId/export/settlements/csv
 */
const exportGroupSettlementsCSV = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const group = await verifyGroupMember(groupId, req.user.id);
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const userName = user ? user.name : 'Someone';

    const csvData = await exportService.exportSettlementsCSV(groupId);
    const dateStr = getLocalDateString();
    const filename = `settlements-${sanitizeFilename(group.name)}-${dateStr}.csv`;

    // Log Export activity
    await activityService.logActivity(
      req.user.id,
      'REPORT_EXPORTED',
      `${userName} exported Settlements CSV.`,
      groupId
    );

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(csvData);
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/groups/:groupId/export/settlements/pdf
 */
const exportGroupSettlementsPDF = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const group = await verifyGroupMember(groupId, req.user.id);
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const userName = user ? user.name : 'Someone';

    const dateStr = getLocalDateString();
    const filename = `settlements-${sanitizeFilename(group.name)}-${dateStr}.pdf`;

    // Log Export activity
    await activityService.logActivity(
      req.user.id,
      'REPORT_EXPORTED',
      `${userName} exported Settlements PDF.`,
      groupId
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await exportService.exportSettlementsPDF(groupId, res, req.user.id);
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/dashboard/export/pdf
 */
const exportDashboardPDF = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const userName = user ? user.name : 'Someone';
    const dateStr = getLocalDateString();
    const filename = `dashboard-${dateStr}.pdf`;

    // Log Export activity
    await activityService.logActivity(
      req.user.id,
      'REPORT_EXPORTED',
      `${userName} exported Dashboard PDF.`,
      null
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await exportService.exportDashboardPDF(req.user.id, res);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  exportGroupExpensesCSV,
  exportGroupExpensesPDF,
  exportGroupSettlementsCSV,
  exportGroupSettlementsPDF,
  exportDashboardPDF
};
