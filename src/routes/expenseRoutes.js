const express = require('express');
const expenseController = require('../controllers/expenseController');
const attachmentController = require('../controllers/attachmentController');
const { authenticateToken } = require('../middleware/authMiddleware');
const { uploadAttachments } = require('../middleware/uploadMiddleware');

const router = express.Router();

// All expense routes require a valid JWT
router.use(authenticateToken);

router.post('/', expenseController.createExpense);
router.get('/:id', expenseController.getExpenseById);
router.put('/:expenseId', expenseController.updateExpense);
router.delete('/:id', expenseController.deleteExpense);

// ── Expense Attachments ──────────────────────────────────────────
router.post('/:expenseId/attachments', uploadAttachments, attachmentController.uploadAttachments);
router.get('/:expenseId/attachments', attachmentController.getAttachments);
router.delete('/:expenseId/attachments/:attachmentId', attachmentController.deleteAttachment);

module.exports = router;

