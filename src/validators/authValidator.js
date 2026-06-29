const { z } = require('zod');

// Schema for User Registration payload validation
const registerSchema = z.object({
  email: z.string({ required_error: "Email is required" })
    .email({ message: "Invalid email format" })
    .trim()
    .toLowerCase(),
  password: z.string({ required_error: "Password is required" })
    .min(6, { message: "Password must be at least 6 characters long" }),
  name: z.string({ required_error: "Name is required" })
    .min(2, { message: "Name must be at least 2 characters long" })
    .trim(),
  avatar: z.string().url({ message: "Avatar must be a valid URL" }).optional().or(z.literal(''))
});

// Schema for User Login payload validation
const loginSchema = z.object({
  email: z.string({ required_error: "Email is required" })
    .email({ message: "Invalid email format" })
    .trim()
    .toLowerCase(),
  password: z.string({ required_error: "Password is required" })
});

module.exports = {
  registerSchema,
  loginSchema
};
