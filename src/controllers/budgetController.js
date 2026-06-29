const budgetService = require('../services/budgetService');

const handleZodError = (res, error) =>
  res.status(400).json({
    success: false,
    message: 'Validation failed',
    errors: error.issues ? error.issues.map((e) => ({
      field: e.path.join('.'),
      message: e.message
    })) : []
  });

const getBudgets = async (req, res, next) => {
  try {
    const budgets = await budgetService.getBudgets(req.user.id);
    return res.status(200).json({
      success: true,
      budgets
    });
  } catch (error) {
    next(error);
  }
};

const createBudget = async (req, res, next) => {
  try {
    const { amount, currency, period, groupId, category, warningThreshold } = req.body;

    if (!amount || parseInt(amount, 10) <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Amount must be a positive integer.'
      });
    }

    const budget = await budgetService.createBudget(req.user.id, {
      amount,
      currency,
      period,
      groupId,
      category,
      warningThreshold
    });

    return res.status(201).json({
      success: true,
      message: 'Budget created successfully.',
      budget
    });
  } catch (error) {
    next(error);
  }
};

const updateBudget = async (req, res, next) => {
  try {
    const budgetId = req.params.id;
    const clientVersion = req.headers['if-match'] || req.body.version;

    if (!clientVersion) {
      return res.status(400).json({
        success: false,
        message: 'If-Match header or version field is required for optimistic concurrency control.'
      });
    }

    const budget = await budgetService.updateBudget(
      budgetId,
      req.user.id,
      req.body,
      clientVersion
    );

    return res.status(200).json({
      success: true,
      message: 'Budget updated successfully.',
      budget
    });
  } catch (error) {
    if (error.status === 409) {
      return res.status(409).json({
        success: false,
        message: error.message
      });
    }
    next(error);
  }
};

const deleteBudget = async (req, res, next) => {
  try {
    const budgetId = req.params.id;
    await budgetService.deleteBudget(budgetId, req.user.id);
    return res.status(200).json({
      success: true,
      message: 'Budget deleted successfully.'
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getBudgets,
  createBudget,
  updateBudget,
  deleteBudget
};
