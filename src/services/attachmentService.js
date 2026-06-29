const prisma = require('../utils/prisma');
const { uploadFromBuffer, deleteFromCloudinary } = require('../utils/cloudinary');

/**
 * Format response consistent with requirements
 */
const formatAttachment = (attachment) => ({
  id: attachment.id,
  fileUrl: attachment.fileUrl,
  uploadedById: attachment.uploadedById,
  createdAt: attachment.createdAt
});

/**
 * Add attachments to an expense
 */
const addAttachments = async (expenseId, userId, files) => {
  if (!files || files.length === 0) {
    const err = new Error('No files uploaded');
    err.status = 400;
    throw err;
  }

  const expense = await prisma.expense.findUnique({
    where: { id: expenseId }
  });
  if (!expense) {
    const err = new Error('Expense not found');
    err.status = 404;
    throw err;
  }

  const membership = await prisma.groupMember.findUnique({
    where: {
      groupId_userId: {
        groupId: expense.groupId,
        userId
      }
    }
  });
  if (!membership) {
    const err = new Error('Access denied. You are not a member of the group this expense belongs to.');
    err.status = 403;
    throw err;
  }

  const uploadedRecords = [];

  try {
    for (const file of files) {
      const uploadResult = await uploadFromBuffer(file.buffer);
      const record = await prisma.expenseAttachment.create({
        data: {
          expenseId,
          fileUrl: uploadResult.secure_url,
          publicId: uploadResult.public_id,
          uploadedById: userId
        }
      });
      uploadedRecords.push(record);
    }
  } catch (error) {
    for (const record of uploadedRecords) {
      await deleteFromCloudinary(record.publicId).catch(console.error);
    }
    throw error;
  }

  const formatted = uploadedRecords.map(formatAttachment);

  // Socket emit
  const { broadcastToGroup } = require('../socket/socketServer');
  const SocketEvents = require('../socket/socketEvents');
  broadcastToGroup(expense.groupId, SocketEvents.EXPENSE_ATTACHMENT_UPLOADED, { expenseId, attachments: formatted }, userId);

  return formatted;
};

/**
 * Retrieve attachments for an expense
 */
const getAttachments = async (expenseId, userId) => {
  const expense = await prisma.expense.findUnique({
    where: { id: expenseId }
  });
  if (!expense) {
    const err = new Error('Expense not found');
    err.status = 404;
    throw err;
  }

  const membership = await prisma.groupMember.findUnique({
    where: {
      groupId_userId: {
        groupId: expense.groupId,
        userId
      }
    }
  });
  if (!membership) {
    const err = new Error('Access denied. You are not a member of the group this expense belongs to.');
    err.status = 403;
    throw err;
  }

  const attachments = await prisma.expenseAttachment.findMany({
    where: { expenseId },
    orderBy: { createdAt: 'asc' }
  });

  return attachments.map(formatAttachment);
};

/**
 * Delete an attachment
 */
const deleteAttachment = async (expenseId, attachmentId, userId) => {
  const attachment = await prisma.expenseAttachment.findUnique({
    where: { id: attachmentId }
  });
  if (!attachment || attachment.expenseId !== expenseId) {
    const err = new Error('Attachment not found');
    err.status = 404;
    throw err;
  }

  const expense = await prisma.expense.findUnique({
    where: { id: expenseId }
  });
  if (!expense) {
    const err = new Error('Expense not found');
    err.status = 404;
    throw err;
  }

  const membership = await prisma.groupMember.findUnique({
    where: {
      groupId_userId: {
        groupId: expense.groupId,
        userId
      }
    }
  });
  if (!membership) {
    const err = new Error('Access denied. You are not a member of this group.');
    err.status = 403;
    throw err;
  }

  const isUploader = attachment.uploadedById === userId;
  const isOwner = membership.role === 'OWNER';

  if (!isUploader && !isOwner) {
    const err = new Error('Access denied. Only the uploader or a group OWNER can delete this attachment.');
    err.status = 403;
    throw err;
  }

  await deleteFromCloudinary(attachment.publicId);

  await prisma.expenseAttachment.delete({
    where: { id: attachmentId }
  });

  // Socket emit
  const { broadcastToGroup } = require('../socket/socketServer');
  const SocketEvents = require('../socket/socketEvents');
  broadcastToGroup(expense.groupId, SocketEvents.EXPENSE_ATTACHMENT_DELETED, { expenseId, attachmentId }, userId);
};

module.exports = {
  addAttachments,
  getAttachments,
  deleteAttachment
};
