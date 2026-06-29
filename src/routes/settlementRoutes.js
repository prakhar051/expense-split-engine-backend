const express = require('express');
const settlementController = require('../controllers/settlementController');
const { authenticateToken } = require('../middleware/authMiddleware');
const { uploadAttachments } = require('../middleware/uploadMiddleware');

const router = express.Router();

// All settlement routes require JWT authentication
router.use(authenticateToken);

router.patch('/:id/status', settlementController.updateSettlementStatus);
router.patch('/:id/proof', uploadAttachments, settlementController.uploadSettlementProof);

module.exports = router;
