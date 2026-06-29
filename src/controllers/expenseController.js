const expenseService = require('../services/expenseService');
const { createExpenseSchema } = require('../validators/expenseValidator');

/**
 * Helper to parse and return Zod validation errors in a consistent shape
 */
const handleZodError = (res, error) =>
  res.status(400).json({
    success: false,
    message: 'Validation failed',
    errors: error.issues.map((e) => ({
      field: e.path.join('.'),
      message: e.message
    }))
  });

/**
 * Helper to handle service-layer errors that carry an explicit HTTP status
 */
const handleServiceError = (res, next, error) => {
  if (error.status) {
    return res.status(error.status).json({
      success: false,
      message: error.message
    });
  }
  next(error);
};

// ─────────────────────────────────────────────
// POST /api/expenses
// ─────────────────────────────────────────────
const createExpense = async (req, res, next) => {
  try {
    const validatedData = createExpenseSchema.parse(req.body);
    const expense = await expenseService.createExpense(req.user.id, validatedData);

    return res.status(201).json({
      success: true,
      message: 'Expense created successfully.',
      expense
    });
  } catch (error) {
    if (error.name === 'ZodError') return handleZodError(res, error);
    handleServiceError(res, next, error);
  }
};

// ─────────────────────────────────────────────
// GET /api/groups/:groupId/expenses
// ─────────────────────────────────────────────
const getGroupExpenses = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const expenses = await expenseService.getGroupExpenses(groupId, req.user.id);

    return res.status(200).json({
      success: true,
      expenses
    });
  } catch (error) {
    handleServiceError(res, next, error);
  }
};

// ─────────────────────────────────────────────
// GET /api/expenses/:id
// ─────────────────────────────────────────────
const getExpenseById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const expense = await expenseService.getExpenseById(id, req.user.id);

    return res.status(200).json({
      success: true,
      expense
    });
  } catch (error) {
    handleServiceError(res, next, error);
  }
};

// ─────────────────────────────────────────────
// PUT /api/expenses/:expenseId
// ─────────────────────────────────────────────
const updateExpense = async (req, res, next) => {
  try {
    const expenseId = req.params.expenseId || req.params.id;
    const validatedData = createExpenseSchema.parse(req.body);
    const expense = await expenseService.updateExpense(expenseId, req.user.id, validatedData);

    return res.status(200).json({
      success: true,
      message: 'Expense updated successfully.',
      expense
    });
  } catch (error) {
    if (error.name === 'ZodError') return handleZodError(res, error);
    handleServiceError(res, next, error);
  }
};

// ─────────────────────────────────────────────
// DELETE /api/expenses/:id
// ─────────────────────────────────────────────
const deleteExpense = async (req, res, next) => {
  try {
    const { id } = req.params;
    await expenseService.deleteExpense(id, req.user.id);

    return res.status(200).json({
      success: true,
      message: 'Expense deleted successfully.'
    });
  } catch (error) {
    handleServiceError(res, next, error);
  }
};

module.exports = {
  createExpense,
  updateExpense,
  getGroupExpenses,
  getExpenseById,
  deleteExpense
};
