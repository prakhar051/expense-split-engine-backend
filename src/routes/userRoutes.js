const express = require('express');
const userController = require('../controllers/userController');
const { authenticateToken } = require('../middleware/authMiddleware');
const { uploadAvatarMiddleware } = require('../middleware/uploadMiddleware');

const router = express.Router();

// All user routes require JWT authentication
router.use(authenticateToken);

router.patch('/profile', uploadAvatarMiddleware, userController.updateProfile);

module.exports = router;
