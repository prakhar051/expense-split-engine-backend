const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { authenticateToken } = require('../middleware/authMiddleware');
const aiController = require('../controllers/aiController');

// Rate limiter: 20 requests per minute per authenticated user
const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  validate: false,
  keyGenerator: (req) => {
    return req.user ? req.user.id : req.ip;
  },
  handler: (req, res) => {
    return res.status(429).json({
      success: false,
      message: 'Too many requests. Please try again after a minute.'
    });
  }
});

// Protected route to analyze receipt
router.post('/categorize-receipt', authenticateToken, aiRateLimiter, aiController.categorizeReceipt);

module.exports = router;
