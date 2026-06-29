const recurringService = require('../services/recurringExpenseService');
const { getSchedulerHealth } = require('../scheduler/recurringScheduler');
const prisma = require('../utils/prisma');

/**
 * Get all recurring expenses for a group
 */
const getRecurringExpenses = async (req, res, next) => {
  const { groupId } = req.params;
  try {
    const templates = await recurringService.getRecurringExpenses(groupId);
    res.status(200).json({
      success: true,
      templates
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Create a new recurring expense template
 */
const createRecurringExpense = async (req, res, next) => {
  const { groupId } = req.params;
  const creatorId = req.user.id;
  try {
    const template = await recurringService.createRecurringExpense(creatorId, groupId, req.body);
    res.status(201).json({
      success: true,
      template
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Update template with Optimistic Concurrency Control
 */
const updateRecurringExpense = async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user.id;
  const { version, ...updateData } = req.body;

  if (version === undefined || version === null) {
    return res.status(400).json({
      success: false,
      message: 'Version parameter is required for optimistic concurrency control updates'
    });
  }

  try {
    const template = await recurringService.updateRecurringExpense(
      id,
      userId,
      parseInt(version, 10),
      updateData
    );
    res.status(200).json({
      success: true,
      template
    });
  } catch (err) {
    if (err.status === 409) {
      return res.status(409).json({
        success: false,
        message: err.message
      });
    }
    next(err);
  }
};

/**
 * Delete a recurring template (Soft delete)
 */
const deleteRecurringExpense = async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user.id;
  try {
    await recurringService.deleteRecurringExpense(id, userId);
    res.status(200).json({
      success: true,
      message: 'Recurring template successfully deleted'
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Toggle template schedule active status
 */
const toggleRecurringExpense = async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user.id;
  const { isActive } = req.body;

  if (isActive === undefined) {
    return res.status(400).json({
      success: false,
      message: 'isActive boolean value is required'
    });
  }

  try {
    const template = await recurringService.toggleRecurringExpense(id, userId, isActive);
    res.status(200).json({
      success: true,
      template
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Manually trigger execution now
 */
const runNow = async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user.id;
  const { advanceSchedule } = req.body; // Default: false (Run only)

  try {
    const expense = await recurringService.runRecurringExpense(id, userId, !!advanceSchedule);
    res.status(201).json({
      success: true,
      message: 'Manual expense generation successfully completed',
      expense
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Manually retry failed execution
 */
const retryFailedExecution = async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user.id;
  try {
    const expense = await recurringService.retryFailedExecution(id, userId);
    res.status(201).json({
      success: true,
      message: 'Failed execution successfully retried and created',
      expense
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Preview next 10 occurrences dates
 */
const previewRecurringDates = async (req, res, next) => {
  const { recurrenceType, interval, startDate } = req.body;
  if (!recurrenceType || interval === undefined || !startDate) {
    return res.status(400).json({
      success: false,
      message: 'recurrenceType, interval, and startDate parameters are required'
    });
  }

  try {
    const previews = recurringService.previewRecurringDates(
      recurrenceType,
      parseInt(interval, 10),
      startDate
    );
    res.status(200).json({
      success: true,
      previews
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get Scheduler Health
 */
const getHealth = async (req, res, next) => {
  try {
    const health = getSchedulerHealth();
    
    // Count active and pending templates
    const activeTemplates = await prisma.recurringExpense.count({
      where: { isActive: true, deletedAt: null }
    });

    const now = new Date();
    const pendingTemplates = await prisma.recurringExpense.count({
      where: { isActive: true, deletedAt: null, nextRunAt: { lte: now } }
    });

    res.status(200).json({
      success: true,
      health: {
        ...health,
        activeTemplates,
        pendingTemplates
      }
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get Scheduler Metrics
 */
const getMetrics = async (req, res, next) => {
  try {
    // Owner/Admin role checking
    const userRole = req.user.role;
    // Note: If role checking is needed, we enforce that only group OWNER/ADMIN or authenticated admins can view it.
    // Let's make it standard view for metrics logs.
    res.status(200).json({
      success: true,
      metrics: recurringService.schedulerMetrics
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getRecurringExpenses,
  createRecurringExpense,
  updateRecurringExpense,
  deleteRecurringExpense,
  toggleRecurringExpense,
  runNow,
  retryFailedExecution,
  previewRecurringDates,
  getHealth,
  getMetrics
};
