const express = require('express');
const controller = require('../controllers/currencyController');
const { authenticateToken } = require('../middleware/authMiddleware');

const router = express.Router();

// Apply JWT verification middleware to all currency requests
router.use(authenticateToken);

router.get('/rates', controller.getLatestRates);
router.get('/supported', controller.getSupportedCurrencies);
router.post('/convert', controller.convertAmount);
router.get('/history', controller.getHistoricalRates);

module.exports = router;
