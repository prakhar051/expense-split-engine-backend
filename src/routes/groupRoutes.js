const express = require('express');
const groupController = require('../controllers/groupController');
const expenseController = require('../controllers/expenseController');
const settlementController = require('../controllers/settlementController');
const activityController = require('../controllers/activityController');
const exportController = require('../controllers/exportController');
const { authenticateToken } = require('../middleware/authMiddleware');

const router = express.Router();

// All group routes require a valid JWT — apply middleware globally to this router
router.use(authenticateToken);

// ── Group CRUD ──────────────────────────────────────────────────
router.post('/', groupController.createGroup);        // POST   /api/groups
router.get('/', groupController.getUserGroups);        // GET    /api/groups
router.post('/join', groupController.joinGroup);       // POST   /api/groups/join
router.get('/:id', groupController.getGroupById);     // GET    /api/groups/:id

// ── Group Expenses ────────────────────────────────────────────────
router.get('/:groupId/expenses', expenseController.getGroupExpenses); // GET /api/groups/:groupId/expenses

// ── Group Recurring Expenses ───────────────────────────────────────
const recurringController = require('../controllers/recurringExpenseController');
router.get('/:groupId/recurring', recurringController.getRecurringExpenses); // GET /api/groups/:groupId/recurring
router.post('/:groupId/recurring', recurringController.createRecurringExpense); // POST /api/groups/:groupId/recurring

// ── Group Balances & Settlements ───────────────────────────────────
router.get('/:groupId/balances', settlementController.getGroupBalances);             // GET  /api/groups/:groupId/balances
router.get('/:groupId/settlements', settlementController.getGroupSettlements);       // GET  /api/groups/:groupId/settlements
router.post('/:groupId/settlements/generate', settlementController.generateSettlements); // POST /api/groups/:groupId/settlements/generate
router.get('/:groupId/activity', activityController.getGroupActivity);              // GET  /api/groups/:groupId/activity
router.get('/:groupId/export/csv', exportController.exportGroupExpensesCSV);
router.get('/:groupId/export/pdf', exportController.exportGroupExpensesPDF);
router.get('/:groupId/export/settlements/csv', exportController.exportGroupSettlementsCSV);
router.get('/:groupId/export/settlements/pdf', exportController.exportGroupSettlementsPDF);

// ── Membership management ───────────────────────────────────────
router.post('/:id/members', groupController.addMember);              // POST   /api/groups/:id/members

// ── Group Invites ────────────────────────────────────────────────
router.post('/:groupId/invite', groupController.createInvite);                     // POST /api/groups/:groupId/invite
router.get('/:groupId/invites', groupController.listInvites);                      // GET  /api/groups/:groupId/invites
router.post('/:groupId/invites/:inviteId/revoke', groupController.revokeInvite);    // POST /api/groups/:groupId/invites/:inviteId/revoke

module.exports = router;

