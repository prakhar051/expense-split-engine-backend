const express = require('express');
const controller = require('../controllers/recurringExpenseController');
const { authenticateToken } = require('../middleware/authMiddleware');

const router = express.Router();

// All recurring routes require token authentication
router.use(authenticateToken);

// Previews, Health, and Metrics
router.post('/preview', controller.previewRecurringDates);
router.get('/health', controller.getHealth);
router.get('/metrics', controller.getMetrics);

// Template specific endpoints
router.put('/:id', controller.updateRecurringExpense);
router.delete('/:id', controller.deleteRecurringExpense);
router.patch('/:id/toggle', controller.toggleRecurringExpense);
router.post('/:id/run-now', controller.runNow);

// Execution retry
router.post('/executions/:id/retry', controller.retryFailedExecution);

module.exports = router;
