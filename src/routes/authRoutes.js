const express = require('express');
const authController = require('../controllers/authController');
const { authenticateToken } = require('../middleware/authMiddleware');

const router = express.Router();

// Public routes for onboarding
router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/refresh', authController.refreshToken);
router.post('/logout', authController.logout);

// Protected routes requiring standard Bearer authorization header
router.get('/me', authenticateToken, authController.getMe);
router.post('/logout-all', authenticateToken, authController.logoutAll);

module.exports = router;
