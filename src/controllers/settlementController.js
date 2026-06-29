const settlementService = require('../services/settlementService');

/**
 * Helper to handle service-layer errors carrying an HTTP status code
 */
const handleServiceError = (res, next, error) => {
  if (error.status) {
    return res.status(error.status).json({
      success: false,
      message: error.message
    });
  }
  next(error);
};

// ─────────────────────────────────────────────
// GET /api/groups/:groupId/balances
// ─────────────────────────────────────────────
const getGroupBalances = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const result = await settlementService.getGroupBalances(groupId, req.user.id);

    return res.status(200).json({
      success: true,
      summary: result.summary,
      balances: result.balances
    });
  } catch (error) {
    handleServiceError(res, next, error);
  }
};

// ─────────────────────────────────────────────
// POST /api/groups/:groupId/settlements/generate
// ─────────────────────────────────────────────
const generateSettlements = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const result = await settlementService.generateSettlements(groupId, req.user.id);

    return res.status(200).json({
      success: true,
      summary: result.summary,
      settlements: result.settlements
    });
  } catch (error) {
    handleServiceError(res, next, error);
  }
};

// ─────────────────────────────────────────────
// GET /api/groups/:groupId/settlements
// ─────────────────────────────────────────────
const getGroupSettlements = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const result = await settlementService.getGroupSettlements(groupId, req.user.id);

    return res.status(200).json({
      success: true,
      summary: result.summary,
      settlements: result.settlements
    });
  } catch (error) {
    handleServiceError(res, next, error);
  }
};

// ─────────────────────────────────────────────
// PATCH /api/settlements/:id/status
// ─────────────────────────────────────────────
const updateSettlementStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Status is required'
      });
    }

    const result = await settlementService.updateSettlementStatus(id, req.user.id, status);

    return res.status(200).json({
      success: true,
      settlement: result
    });
  } catch (error) {
    handleServiceError(res, next, error);
  }
};

// ─────────────────────────────────────────────
// PATCH /api/settlements/:id/proof
// ─────────────────────────────────────────────
const uploadSettlementProof = async (req, res, next) => {
  try {
    const { id } = req.params;
    const proofInput = req.files && req.files.length > 0 ? req.files : req.body.proofUrl;

    const result = await settlementService.uploadSettlementProof(id, req.user.id, proofInput);

    return res.status(200).json({
      success: true,
      settlement: result
    });
  } catch (error) {
    handleServiceError(res, next, error);
  }
};

module.exports = {
  getGroupBalances,
  generateSettlements,
  getGroupSettlements,
  updateSettlementStatus,
  uploadSettlementProof
};
