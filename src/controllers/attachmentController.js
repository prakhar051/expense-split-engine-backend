const attachmentService = require('../services/attachmentService');

const handleServiceError = (res, next, error) => {
  if (error.status) {
    return res.status(error.status).json({
      success: false,
      message: error.message
    });
  }
  next(error);
};

// POST /api/expenses/:expenseId/attachments
const uploadAttachments = async (req, res, next) => {
  try {
    const attachments = await attachmentService.addAttachments(
      req.params.expenseId,
      req.user.id,
      req.files
    );

    return res.status(201).json({
      success: true,
      message: 'Attachments uploaded successfully.',
      attachments
    });
  } catch (error) {
    handleServiceError(res, next, error);
  }
};

// GET /api/expenses/:expenseId/attachments
const getAttachments = async (req, res, next) => {
  try {
    const attachments = await attachmentService.getAttachments(
      req.params.expenseId,
      req.user.id
    );

    return res.status(200).json({
      success: true,
      attachments
    });
  } catch (error) {
    handleServiceError(res, next, error);
  }
};

// DELETE /api/expenses/:expenseId/attachments/:attachmentId
const deleteAttachment = async (req, res, next) => {
  try {
    await attachmentService.deleteAttachment(
      req.params.expenseId,
      req.params.attachmentId,
      req.user.id
    );

    return res.status(200).json({
      success: true,
      message: 'Attachment deleted successfully.'
    });
  } catch (error) {
    handleServiceError(res, next, error);
  }
};

module.exports = {
  uploadAttachments,
  getAttachments,
  deleteAttachment
};
