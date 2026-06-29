const express = require('express');
const activityController = require('../controllers/activityController');
const { authenticateToken } = require('../middleware/authMiddleware');

const router = express.Router();

// All notification endpoints require authentication
router.use(authenticateToken);

router.get('/', activityController.getNotifications);
router.patch('/read-all', activityController.markAllRead);
router.patch('/:id/read', activityController.markRead);

module.exports = router;
