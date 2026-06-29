const userService = require('../services/userService');

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

/**
 * PATCH /api/users/profile
 */
const updateProfile = async (req, res, next) => {
  try {
    const userId = req.user.id;
    // req.file is populated by uploadAvatarMiddleware
    const result = await userService.updateUserProfile(userId, req.body, req.file);

    return res.status(200).json({
      success: true,
      user: result
    });
  } catch (error) {
    handleServiceError(res, next, error);
  }
};

module.exports = {
  updateProfile
};
