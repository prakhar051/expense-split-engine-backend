const { z } = require('zod');
const groupAdminService = require('../services/groupAdminService');

// Zod schemas for input validation
const transferOwnerSchema = z.object({
  newOwnerId: z.string().uuid(),
  version: z.union([z.number(), z.string()])
});

const banSchema = z.object({
  reason: z.string().max(255).optional(),
  version: z.union([z.number(), z.string()])
});

const versionSchema = z.object({
  version: z.union([z.number(), z.string()])
});

const getVersion = (req) => {
  const version = req.headers['if-match'] || req.body.version || req.query.version;
  if (version === undefined || version === null) {
    const err = new Error('Group version or If-Match header is required.');
    err.status = 400;
    throw err;
  }
  return version;
};

const getGroupMembers = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const members = await groupAdminService.getGroupMembers(groupId, req.user.id);
    return res.status(200).json({ success: true, members });
  } catch (error) {
    next(error);
  }
};

const getGroupAdmins = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const admins = await groupAdminService.getGroupAdmins(groupId, req.user.id);
    return res.status(200).json({ success: true, admins });
  } catch (error) {
    next(error);
  }
};

const getAdminActions = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const actions = await groupAdminService.getAdminActions(groupId, req.user.id);
    return res.status(200).json({ success: true, actions });
  } catch (error) {
    next(error);
  }
};

const promoteMember = async (req, res, next) => {
  try {
    const { groupId, memberId } = req.params;
    
    // Validate version
    const parsedVersion = getVersion(req);
    versionSchema.parse({ version: parsedVersion });

    const result = await groupAdminService.promoteMember(groupId, memberId, req.user.id, parsedVersion);
    return res.status(200).json({
      success: true,
      message: 'Member promoted to Admin successfully.',
      member: result.updatedMember,
      groupVersion: result.updatedGroup.version
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: error.errors });
    }
    if (error.status === 409) {
      return res.status(409).json({ success: false, message: error.message });
    }
    next(error);
  }
};

const demoteMember = async (req, res, next) => {
  try {
    const { groupId, memberId } = req.params;
    
    const parsedVersion = getVersion(req);
    versionSchema.parse({ version: parsedVersion });

    const result = await groupAdminService.demoteMember(groupId, memberId, req.user.id, parsedVersion);
    return res.status(200).json({
      success: true,
      message: 'Admin demoted to Member successfully.',
      member: result.updatedMember,
      groupVersion: result.updatedGroup.version
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: error.errors });
    }
    if (error.status === 409) {
      return res.status(409).json({ success: false, message: error.message });
    }
    next(error);
  }
};

const banMember = async (req, res, next) => {
  try {
    const { groupId, memberId } = req.params;
    const parsedVersion = getVersion(req);

    // Validate request body
    const validated = banSchema.parse({
      reason: req.body.reason,
      version: parsedVersion
    });

    const result = await groupAdminService.banMember(groupId, memberId, validated.reason, req.user.id, validated.version);
    return res.status(200).json({
      success: true,
      message: 'Member banned successfully.',
      member: result.updatedMember,
      groupVersion: result.updatedGroup.version
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: error.errors });
    }
    if (error.status === 409) {
      return res.status(409).json({ success: false, message: error.message });
    }
    next(error);
  }
};

const unbanMember = async (req, res, next) => {
  try {
    const { groupId, memberId } = req.params;
    const parsedVersion = getVersion(req);
    versionSchema.parse({ version: parsedVersion });

    const result = await groupAdminService.unbanMember(groupId, memberId, req.user.id, parsedVersion);
    return res.status(200).json({
      success: true,
      message: 'Member unbanned successfully.',
      member: result.updatedMember,
      groupVersion: result.updatedGroup.version
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: error.errors });
    }
    if (error.status === 409) {
      return res.status(409).json({ success: false, message: error.message });
    }
    next(error);
  }
};

const removeMember = async (req, res, next) => {
  try {
    const { groupId, memberId } = req.params;
    const parsedVersion = getVersion(req);
    versionSchema.parse({ version: parsedVersion });

    await groupAdminService.removeMember(groupId, memberId, req.user.id, parsedVersion);
    return res.status(200).json({
      success: true,
      message: 'Member removed successfully.'
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: error.errors });
    }
    if (error.status === 409) {
      return res.status(409).json({ success: false, message: error.message });
    }
    next(error);
  }
};

const leaveGroup = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    await groupAdminService.leaveGroup(groupId, req.user.id);
    return res.status(200).json({
      success: true,
      message: 'You left the group successfully.'
    });
  } catch (error) {
    next(error);
  }
};

const transferOwnership = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const parsedVersion = getVersion(req);

    const validated = transferOwnerSchema.parse({
      newOwnerId: req.body.newOwnerId,
      version: parsedVersion
    });

    const result = await groupAdminService.transferOwnership(groupId, validated.newOwnerId, req.user.id, validated.version);
    return res.status(200).json({
      success: true,
      message: 'Group ownership transferred successfully.',
      groupVersion: result.updatedGroup.version
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: error.errors });
    }
    if (error.status === 409) {
      return res.status(409).json({ success: false, message: error.message });
    }
    next(error);
  }
};

const deleteGroup = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    await groupAdminService.deleteGroup(groupId, req.user.id);
    return res.status(200).json({
      success: true,
      message: 'Group deleted successfully.'
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getGroupMembers,
  getGroupAdmins,
  getAdminActions,
  promoteMember,
  demoteMember,
  banMember,
  unbanMember,
  removeMember,
  leaveGroup,
  transferOwnership,
  deleteGroup
};

