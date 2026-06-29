const express = require('express');
const groupAdminController = require('../controllers/groupAdminController');
const { authenticateToken } = require('../middleware/authMiddleware');
const requireMember = require('../middleware/requireMember');
const requireAdmin = require('../middleware/requireAdmin');
const requireOwner = require('../middleware/requireOwner');

const router = express.Router();

router.use(authenticateToken);

// Member scope routes
router.get('/:groupId/members', requireMember, groupAdminController.getGroupMembers);
router.get('/:groupId/admins', requireMember, groupAdminController.getGroupAdmins);
router.get('/:groupId/admin-actions', requireMember, groupAdminController.getAdminActions);
router.post('/:groupId/leave', requireMember, groupAdminController.leaveGroup);

// Admin scope routes (Admin can remove/ban MEMBERS only)
router.delete('/:groupId/members/:memberId', requireAdmin, groupAdminController.removeMember);
router.post('/:groupId/members/:memberId/ban', requireAdmin, groupAdminController.banMember);
router.post('/:groupId/members/:memberId/unban', requireAdmin, groupAdminController.unbanMember);

// Owner scope routes
router.patch('/:groupId/members/:memberId/promote', requireOwner, groupAdminController.promoteMember);
router.patch('/:groupId/members/:memberId/demote', requireOwner, groupAdminController.demoteMember);
router.patch('/:groupId/transfer-owner', requireOwner, groupAdminController.transferOwnership);
router.delete('/:groupId', requireOwner, groupAdminController.deleteGroup);

module.exports = router;

