const { z } = require('zod');

const createExpenseSchema = z.object({
  title: z.string().min(1, 'Title cannot be empty').optional(),
  description: z.string().min(1, 'Description cannot be empty').optional(),
  category: z.enum(['FOOD', 'TRAVEL', 'RENT', 'UTILITIES', 'SHOPPING', 'ENTERTAINMENT', 'GENERAL']).default('GENERAL').optional(),
  originalCurrency: z.enum(['INR', 'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'SGD', 'AED']).default('INR').optional(),
  amount: z.number({ required_error: 'Amount is required' }).int('Amount must be an integer (in cents)').gt(0, 'Amount must be greater than 0'),
  groupId: z.string({ required_error: 'groupId is required' }).uuid('groupId must be a valid UUID'),
  paidById: z.string().uuid('paidById must be a valid UUID').optional(), // optional for MULTI_PAYER
  splitType: z.enum(['EQUAL', 'EXACT', 'PERCENTAGE', 'SHARE', 'MULTI_PAYER'], { required_error: 'splitType is required' }),
  date: z.string().optional().nullable(),
  payers: z.array(
    z.object({
      userId: z.string({ required_error: 'Payer userId is required' }).uuid('Payer userId must be a valid UUID'),
      amount: z.number({ required_error: 'Payer amount is required' }).int('Payer amount must be an integer').gt(0, 'Payer amount must be greater than 0')
    })
  ).optional(),
  participants: z.array(
    z.object({
      userId: z.string({ required_error: 'Participant userId is required' }).uuid('Participant userId must be a valid UUID'),
      amount: z.number().int().nonnegative().optional(),       // Used for EXACT split
      percentage: z.number().positive().optional(),            // Used for PERCENTAGE split
      shares: z.number().int().positive().optional(),          // Used for SHARE split
    })
  ).min(1, 'At least one participant is required')
}).refine(data => {
  return (data.title && data.title.trim().length > 0) || (data.description && data.description.trim().length > 0);
}, {
  message: "Either title or description is required",
  path: ["title"]
}).refine(data => {
  if (data.splitType === 'MULTI_PAYER') {
    return data.payers && data.payers.length > 0;
  }
  return !!data.paidById;
}, {
  message: "paidById is required for single-payer splits, and payers is required for MULTI_PAYER split",
  path: ["paidById"]
});

module.exports = {
  createExpenseSchema
};
