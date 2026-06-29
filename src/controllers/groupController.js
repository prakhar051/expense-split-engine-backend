const groupService = require('../services/groupService');
const {
  createGroupSchema,
  addMemberSchema,
  createInviteSchema,
  joinGroupSchema,
  transferOwnershipSchema
} = require('../validators/groupValidator');

/**
 * Helper to parse and return Zod validation errors in a consistent shape
 */
const handleZodError = (res, error) =>
  res.status(400).json({
    success: false,
    message: 'Validation failed',
    errors: error.issues.map((e) => ({
      field: e.path.join('.'),
      message: e.message
    }))
  });

/**
 * Helper to handle service-layer errors that carry an explicit HTTP status
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
// POST /api/groups
// ─────────────────────────────────────────────
const createGroup = async (req, res, next) => {
  try {
    const validatedData = createGroupSchema.parse(req.body);
    const group = await groupService.createGroup(req.user.id, validatedData);

    return res.status(201).json({
      success: true,
      message: 'Group created successfully.',
      group
    });
  } catch (error) {
    if (error.name === 'ZodError') return handleZodError(res, error);
    handleServiceError(res, next, error);
  }
};

// ─────────────────────────────────────────────
// GET /api/groups
// ─────────────────────────────────────────────
const getUserGroups = async (req, res, next) => {
  try {
    const groups = await groupService.getUserGroups(req.user.id);

    return res.status(200).json({
      success: true,
      count: groups.length,
      groups
    });
  } catch (error) {
    handleServiceError(res, next, error);
  }
};

// ─────────────────────────────────────────────
// GET /api/groups/:id
// ─────────────────────────────────────────────
const getGroupById = async (req, res, next) => {
  try {
    const group = await groupService.getGroupById(req.params.id, req.user.id);

    return res.status(200).json({
      success: true,
      group
    });
  } catch (error) {
    handleServiceError(res, next, error);
  }
};

// ─────────────────────────────────────────────
// POST /api/groups/:id/members
// ─────────────────────────────────────────────
const addMember = async (req, res, next) => {
  try {
    const validatedData = addMemberSchema.parse(req.body);
    const member = await groupService.addMember(
      req.params.id,
      req.user.id,
      validatedData.userId
    );

    return res.status(201).json({
      success: true,
      message: 'Member added successfully.',
      member
    });
  } catch (error) {
    if (error.name === 'ZodError') return handleZodError(res, error);
    handleServiceError(res, next, error);
  }
};

// ─────────────────────────────────────────────
// DELETE /api/groups/:groupId/members/:memberId
// ─────────────────────────────────────────────
const removeMember = async (req, res, next) => {
  try {
    const groupId = req.params.groupId || req.params.id;
    const memberId = req.params.memberId || req.params.userId;
    await groupService.removeMember(
      groupId,
      req.user.id,
      memberId
    );

    return res.status(200).json({
      success: true,
      message: 'Member removed successfully.'
    });
  } catch (error) {
    handleServiceError(res, next, error);
  }
};

// ─────────────────────────────────────────────
// POST /api/groups/:groupId/leave
// ─────────────────────────────────────────────
const leaveGroup = async (req, res, next) => {
  try {
    const groupId = req.params.groupId || req.params.id;
    await groupService.leaveGroup(groupId, req.user.id);

    return res.status(200).json({
      success: true,
      message: 'Successfully left the group.'
    });
  } catch (error) {
    handleServiceError(res, next, error);
  }
};

// ─────────────────────────────────────────────
// POST /api/groups/:groupId/transfer-ownership
// ─────────────────────────────────────────────
const transferOwnership = async (req, res, next) => {
  try {
    const groupId = req.params.groupId || req.params.id;
    const validatedData = transferOwnershipSchema.parse(req.body);
    await groupService.transferOwnership(groupId, validatedData.newOwnerId, req.user.id);

    return res.status(200).json({
      success: true,
      message: 'Group ownership transferred successfully.'
    });
  } catch (error) {
    if (error.name === 'ZodError') return handleZodError(res, error);
    handleServiceError(res, next, error);
  }
};

// ─────────────────────────────────────────────
// POST /api/groups/:groupId/invite
// ─────────────────────────────────────────────
const createInvite = async (req, res, next) => {
  try {
    const validatedData = createInviteSchema.parse(req.body);
    const invite = await groupService.createInvite(
      req.params.groupId,
      req.user.id,
      validatedData
    );

    return res.status(201).json({
      success: true,
      message: 'Invitation registered successfully.',
      invite
    });
  } catch (error) {
    if (error.name === 'ZodError') return handleZodError(res, error);
    handleServiceError(res, next, error);
  }
};

// ─────────────────────────────────────────────
// GET /api/groups/:groupId/invites
// ─────────────────────────────────────────────
const listInvites = async (req, res, next) => {
  try {
    const invites = await groupService.listInvites(
      req.params.groupId,
      req.user.id
    );

    return res.status(200).json({
      success: true,
      invites
    });
  } catch (error) {
    handleServiceError(res, next, error);
  }
};

// ─────────────────────────────────────────────
// POST /api/groups/:groupId/invites/:inviteId/revoke
// ─────────────────────────────────────────────
const revokeInvite = async (req, res, next) => {
  try {
    const invite = await groupService.revokeInvite(
      req.params.groupId,
      req.params.inviteId,
      req.user.id
    );

    return res.status(200).json({
      success: true,
      message: 'Invitation revoked successfully.',
      invite
    });
  } catch (error) {
    handleServiceError(res, next, error);
  }
};

// ─────────────────────────────────────────────
// POST /api/groups/join
// ─────────────────────────────────────────────
const joinGroup = async (req, res, next) => {
  try {
    const validatedData = joinGroupSchema.parse(req.body);
    const result = await groupService.joinGroup(
      req.user.id,
      validatedData
    );

    return res.status(200).json({
      success: true,
      groupId: result.groupId,
      message: 'Successfully joined group.'
    });
  } catch (error) {
    if (error.name === 'ZodError') return handleZodError(res, error);
    handleServiceError(res, next, error);
  }
};

module.exports = {
  createGroup,
  getUserGroups,
  getGroupById,
  addMember,
  removeMember,
  leaveGroup,
  transferOwnership,
  createInvite,
  listInvites,
  revokeInvite,
  joinGroup
};
