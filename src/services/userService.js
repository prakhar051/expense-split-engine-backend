const prisma = require('../utils/prisma');
const { uploadFromBuffer, deleteFromCloudinary } = require('../utils/cloudinary');

/**
 * Extract Cloudinary public ID from a secure URL string.
 */
const getCloudinaryPublicId = (url) => {
  if (!url) return null;
  try {
    const splitParts = url.split('/image/upload/');
    if (splitParts.length < 2) return null;
    const pathWithVersion = splitParts[1];
    const pathParts = pathWithVersion.split('/');
    if (pathParts[0].startsWith('v')) {
      pathParts.shift();
    }
    const pathWithExtension = pathParts.join('/');
    const dotIndex = pathWithExtension.lastIndexOf('.');
    if (dotIndex !== -1) {
      return pathWithExtension.substring(0, dotIndex);
    }
    return pathWithExtension;
  } catch (error) {
    return null;
  }
};

/**
 * Delete previous avatar asset from Cloudinary.
 * Ignores any failures (e.g. resource not found) to guarantee profile update proceeds.
 */
const deleteOldAvatar = async (avatarUrl) => {
  const publicId = getCloudinaryPublicId(avatarUrl);
  if (publicId) {
    try {
      await deleteFromCloudinary(publicId);
    } catch (err) {
      console.error('[Cloudinary delete error] Ignoring:', err.message);
    }
  }
};

/**
 * Update user profile details (name, avatar upload/removal).
 */
const updateUserProfile = async (userId, data, file) => {
  // 1. Find user
  const user = await prisma.user.findUnique({
    where: { id: userId }
  });
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  const updateData = {};

  let nameUpdated = false;
  let avatarUploaded = false;
  let avatarRemoved = false;

  // 2. Validate name
  if (data.name !== undefined) {
    const trimmedName = data.name.trim();
    if (!trimmedName) {
      const err = new Error('Name is required');
      err.status = 400;
      throw err;
    }
    if (trimmedName.length < 3 || trimmedName.length > 100) {
      const err = new Error('Name must be between 3 and 100 characters');
      err.status = 400;
      throw err;
    }
    if (trimmedName !== user.name) {
      updateData.name = trimmedName;
      nameUpdated = true;
    }
  }

  // 3. Handle avatar removal
  if (data.removeAvatar === 'true' || data.removeAvatar === true || data.avatar === null) {
    if (user.avatar) {
      await deleteOldAvatar(user.avatar);
      updateData.avatar = null;
      avatarRemoved = true;
    }
  }

  // 4. Handle file upload (avatar replacement)
  if (file) {
    if (user.avatar) {
      await deleteOldAvatar(user.avatar);
    }
    const uploadResult = await uploadFromBuffer(file.buffer, 'avatars');
    updateData.avatar = uploadResult.secure_url;
    avatarUploaded = true;
  }

  // 5. Update user in database
  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: updateData,
    select: {
      id: true,
      name: true,
      email: true,
      avatar: true,
      createdAt: true
    }
  });

  // 6. Log activities
  try {
    const { logActivity } = require('./activityService');
    if (nameUpdated) {
      await logActivity(userId, 'PROFILE_NAME_UPDATED', `${updatedUser.name} updated their name.`, null, { oldName: user.name, newName: updatedUser.name });
    }
    if (avatarUploaded) {
      await logActivity(userId, 'PROFILE_AVATAR_UPLOADED', `${updatedUser.name} uploaded a new avatar.`, null);
    }
    if (avatarRemoved) {
      await logActivity(userId, 'PROFILE_AVATAR_REMOVED', `${updatedUser.name} removed their avatar.`, null);
    }
  } catch (error) {
    console.error('[userService logActivity Error] Ignored:', error);
  }

  // Socket emit to all groups user belongs to
  try {
    const { broadcastToGroup, sendToUser } = require('../socket/socketServer');
    const SocketEvents = require('../socket/socketEvents');
    const userGroups = await prisma.groupMember.findMany({
      where: { userId },
      select: { groupId: true }
    });
    userGroups.forEach((g) => {
      broadcastToGroup(g.groupId, SocketEvents.PROFILE_UPDATED, { userId, user: updatedUser }, userId);
    });
    sendToUser(userId, SocketEvents.PROFILE_UPDATED, { userId, user: updatedUser }, userId);
  } catch (err) {
    console.error('[userService socketError] Ignored:', err);
  }

  return updatedUser;
};

module.exports = {
  updateUserProfile
};
