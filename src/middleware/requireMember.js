const prisma = require('../utils/prisma');

const requireMember = async (req, res, next) => {
  const { groupId } = req.params;
  const userId = req.user.id;

  if (!groupId) {
    return res.status(400).json({ success: false, message: 'Group ID is required.' });
  }

  const membership = await prisma.groupMember.findUnique({
    where: {
      groupId_userId: { groupId, userId }
    }
  });

  if (!membership || membership.isBanned) {
    return res.status(403).json({ success: false, message: 'Access denied. You are not a member of this group or have been banned.' });
  }

  req.membership = membership;
  next();
};

module.exports = requireMember;
