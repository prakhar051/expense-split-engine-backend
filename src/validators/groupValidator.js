const { z } = require('zod');

// Schema for creating a new group
const createGroupSchema = z.object({
  name: z
    .string({ required_error: 'Group name is required' })
    .min(2, { message: 'Group name must be at least 2 characters' })
    .max(100, { message: 'Group name must not exceed 100 characters' })
    .trim(),
  description: z
    .string()
    .max(500, { message: 'Description must not exceed 500 characters' })
    .trim()
    .optional()
});

// Schema for adding a member to a group
const addMemberSchema = z.object({
  userId: z
    .string({ required_error: 'User ID is required' })
    .uuid({ message: 'User ID must be a valid UUID' })
});

// Schema for inviting a member to a group
const createInviteSchema = z.object({
  email: z
    .string()
    .email({ message: 'Invalid email address' })
    .trim()
    .optional()
    .nullable(),
  expiresInHours: z
    .number({ invalid_type_error: 'Expires in hours must be a number' })
    .int({ message: 'Expires in hours must be an integer' })
    .positive({ message: 'Expires in hours must be positive' })
    .max(8760, { message: 'Expires in hours cannot exceed 8760 (1 year)' })
    .optional()
});

// Schema for joining a group using invite code
const joinGroupSchema = z.object({
  inviteCode: z
    .string({ required_error: 'Invite code is required' })
    .min(3, { message: 'Invite code is too short' })
    .trim()
});

// Schema for transferring group ownership
const transferOwnershipSchema = z.object({
  newOwnerId: z
    .string({ required_error: 'New owner user ID is required' })
    .uuid({ message: 'New owner user ID must be a valid UUID' })
});

module.exports = {
  createGroupSchema,
  addMemberSchema,
  createInviteSchema,
  joinGroupSchema,
  transferOwnershipSchema
};

