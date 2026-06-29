const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_access_token_secret_987654321_abc';

/**
 * Route protection middleware to authenticate users via JWT
 */
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  // Token structure: "Bearer <token>"
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Access Denied. No token provided.'
    });
  }

  try {
    const verified = jwt.verify(token, JWT_SECRET);
    req.user = verified; // Attach user payload ({ id, email }) to request
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired authentication token.'
    });
  }
};

module.exports = {
  authenticateToken
};
