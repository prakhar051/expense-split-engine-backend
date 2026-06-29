const bcrypt = require('bcryptjs');
const prisma = require('../../src/utils/prisma');

const testFactory = {
  async createUser(overrides = {}) {
    const defaultPassword = overrides.password || 'password123';
    const hashedPassword = bcrypt.hashSync(defaultPassword, 10);
    
    return prisma.user.create({
      data: {
        email: overrides.email || `user-${Date.now()}-${Math.floor(Math.random() * 100000)}@test.com`,
        name: overrides.name || 'Test User',
        password: hashedPassword,
        avatar: overrides.avatar || null,
        ...overrides
      }
    });
  },

  async createGroup(createdById, overrides = {}) {
    return prisma.$transaction(async (tx) => {
      const newGroup = await tx.group.create({
        data: {
          name: overrides.name || 'Test Group',
          description: overrides.description || 'Test Group Description',
          createdById,
          ...overrides
        }
      });

      // Default creator is OWNER of the group
      await tx.groupMember.create({
        data: {
          groupId: newGroup.id,
          userId: createdById,
          role: 'OWNER'
        }
      });

      return tx.group.findUnique({
        where: { id: newGroup.id },
        include: { members: true }
      });
    });
  },

  async addMember(groupId, userId, role = 'MEMBER', overrides = {}) {
    return prisma.groupMember.create({
      data: {
        groupId,
        userId,
        role,
        ...overrides
      }
    });
  },

  async createBudget(userId, groupId, overrides = {}) {
    const { limit, amount, ...rest } = overrides;
    return prisma.budget.create({
      data: {
        userId,
        groupId,
        category: overrides.category || 'FOOD',
        amount: amount || limit || 10000, // 100.00
        currency: rest.currency || 'INR',
        period: overrides.period || 'MONTHLY',
        version: overrides.version || 1,
        ...rest
      }
    });
  },

  async createExpense(groupId, createdById, overrides = {}) {
    return prisma.$transaction(async (tx) => {
      const splitType = overrides.splitType || 'EQUAL';
      const amount = overrides.amount || 3000; // 30.00
      const { participants: partList, payers: payList, ...restOverrides } = overrides;
      
      const newExpense = await tx.expense.create({
        data: {
          groupId,
          createdById,
          title: restOverrides.title || 'Test Expense',
          amount,
          splitType,
          category: restOverrides.category || 'FOOD',
          paidById: restOverrides.paidById || createdById,
          ...restOverrides
        }
      });

      // Add a default payer entry if payers list is not defined
      const payers = payList || [{ userId: overrides.paidById || createdById, amount }];
      for (const p of payers) {
        await tx.expensePayer.create({
          data: {
            expenseId: newExpense.id,
            userId: p.userId,
            amount: p.amount
          }
        });
      }

      // Add default participant shares (e.g. split equally if participants not defined)
      const participants = partList || [{ userId: createdById, shareAmount: amount }];
      for (const pt of participants) {
        await tx.expenseParticipant.create({
          data: {
            expenseId: newExpense.id,
            userId: pt.userId,
            shareAmount: pt.shareAmount
          }
        });
      }

      return tx.expense.findUnique({
        where: { id: newExpense.id },
        include: { payers: true, participants: true }
      });
    });
  },

  async createRecurringExpense(groupId, createdById, overrides = {}) {
    const { interval, recurrenceType, payload, ...rest } = overrides;
    
    let resolvedInterval = 1;
    let resolvedType = recurrenceType || 'MONTHLY';
    
    if (typeof interval === 'string') {
      resolvedType = interval;
      resolvedInterval = 1;
    } else if (typeof interval === 'number') {
      resolvedInterval = interval;
    }

    const defaultPayload = {
      title: rest.title || 'Test Recurring',
      amount: rest.amount || 1500,
      groupId,
      paidById: createdById,
      splitType: 'EQUAL',
      category: 'GENERAL',
      originalCurrency: 'INR',
      participants: [{ userId: createdById }]
    };

    return prisma.recurringExpense.create({
      data: {
        groupId,
        createdById,
        title: rest.title || 'Test Recurring',
        amount: rest.amount || 5000,
        recurrenceType: resolvedType,
        interval: resolvedInterval,
        startDate: rest.startDate || new Date(),
        nextRunAt: rest.nextRunAt || new Date(Date.now() + 24 * 3600 * 1000),
        isActive: rest.hasOwnProperty('isActive') ? rest.isActive : true,
        payload: payload || defaultPayload,
        ...rest
      }
    });
  }
};

module.exports = testFactory;
