const aiCategorizationService = require('../services/aiCategorizationService');

/**
 * Endpoint to categorize OCR receipt text using Gemini API
 */
const categorizeReceipt = async (req, res, next) => {
  try {
    const { rawText } = req.body;
    const userId = req.user.id;

    // Call service layer
    const result = await aiCategorizationService.categorizeReceipt(rawText, userId);

    return res.status(200).json(result);
  } catch (err) {
    // If anything fails outside of service fallbacks, route to express error handler
    next(err);
  }
};

module.exports = {
  categorizeReceipt
};
