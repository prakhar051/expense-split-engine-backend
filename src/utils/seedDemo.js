require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const prisma = require('./prisma');
const bcrypt = require('bcryptjs');

async function main() {
  console.log('🌱 Starting Demo Seeding...');

  // 1. Clean up existing data in correct FK order
  console.log('🧹 Cleaning up database tables...');
  await prisma.activity.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.settlement.deleteMany({});
  await prisma.expenseParticipant.deleteMany({});
  await prisma.expensePayer.deleteMany({});
  await prisma.expense.deleteMany({});
  await prisma.recurringExpense.deleteMany({});
  await prisma.budget.deleteMany({});
  await prisma.analyticsSnapshot.deleteMany({});
  await prisma.aIInsight.deleteMany({});
  await prisma.groupMember.deleteMany({});
  await prisma.group.deleteMany({});
  await prisma.user.deleteMany({});

  // 2. Seed Users
  console.log('👤 Seeding Users...');
  const passwordHash = await bcrypt.hash('password123', 10);
  const alice = await prisma.user.create({
    data: { email: 'alice@example.com', name: 'Alice Smith', password: passwordHash }
  });
  const bob = await prisma.user.create({
    data: { email: 'bob@example.com', name: 'Bob Jones', password: passwordHash }
  });
  const charlie = await prisma.user.create({
    data: { email: 'charlie@example.com', name: 'Charlie Brown', password: passwordHash }
  });
  const david = await prisma.user.create({
    data: { email: 'david@example.com', name: 'David Miller', password: passwordHash }
  });

  // 3. Seed Groups
  console.log('👥 Seeding Groups...');
  const roommatesGroup = await prisma.group.create({
    data: { name: 'Roommates 2026', description: 'Monthly apartment shared utilities & rent', createdById: alice.id }
  });
  const tripGroup = await prisma.group.create({
    data: { name: 'Goa Road Trip', description: 'Road trip splits & fuel calculations', createdById: bob.id }
  });

  console.log('✉️  Seeding Group Invites...');
  await prisma.groupInvite.create({
    data: { groupId: roommatesGroup.id, code: 'ROOM2026', invitedById: alice.id, expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) }
  });
  await prisma.groupInvite.create({
    data: { groupId: tripGroup.id, code: 'GOATRIP', invitedById: bob.id, expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) }
  });

  // 4. Seed Members
  console.log('🏷️  Seeding Group Members...');
  await prisma.groupMember.createMany({
    data: [
      { groupId: roommatesGroup.id, userId: alice.id, role: 'OWNER' },
      { groupId: roommatesGroup.id, userId: bob.id, role: 'ADMIN' },
      { groupId: roommatesGroup.id, userId: charlie.id, role: 'MEMBER' },
      { groupId: roommatesGroup.id, userId: david.id, role: 'MEMBER' },
      { groupId: tripGroup.id, userId: bob.id, role: 'OWNER' },
      { groupId: tripGroup.id, userId: charlie.id, role: 'ADMIN' },
      { groupId: tripGroup.id, userId: david.id, role: 'MEMBER' }
    ]
  });

  // 5. Seed Expenses & Splits
  console.log('💸 Seeding Expenses & Split distributions...');
  
  // Rent Expense (Equal Split)
  const rent = await prisma.expense.create({
    data: {
      groupId: roommatesGroup.id,
      createdById: alice.id,
      title: 'Apartment Rent',
      amount: 120000, // 1200 INR (expressed in cents)
      category: 'RENT',
      splitType: 'EQUAL',
      createdAt: new Date()
    }
  });
  await prisma.expenseParticipant.createMany({
    data: [
      { expenseId: rent.id, userId: alice.id, shareAmount: 30000 },
      { expenseId: rent.id, userId: bob.id, shareAmount: 30000 },
      { expenseId: rent.id, userId: charlie.id, shareAmount: 30000 },
      { expenseId: rent.id, userId: david.id, shareAmount: 30000 }
    ]
  });
  await prisma.expensePayer.create({
    data: { expenseId: rent.id, userId: alice.id, amount: 120000 }
  });

  // Dinner Expense (Percentage Split)
  const dinner = await prisma.expense.create({
    data: {
      groupId: roommatesGroup.id,
      createdById: bob.id,
      title: 'Weekly Dinner Party',
      amount: 10000, // 100 INR in cents
      category: 'FOOD',
      splitType: 'PERCENTAGE',
      createdAt: new Date()
    }
  });
  await prisma.expenseParticipant.createMany({
    data: [
      { expenseId: dinner.id, userId: alice.id, shareAmount: 4000 }, // 40%
      { expenseId: dinner.id, userId: bob.id, shareAmount: 3000 },  // 30%
      { expenseId: dinner.id, userId: charlie.id, shareAmount: 2000 }, // 20%
      { expenseId: dinner.id, userId: david.id, shareAmount: 1000 }  // 10%
    ]
  });
  await prisma.expensePayer.create({
    data: { expenseId: dinner.id, userId: bob.id, amount: 10000 }
  });

  // 6. Seed Settlements
  console.log('🤝 Seeding Settlements...');
  await prisma.settlement.createMany({
    data: [
      { groupId: roommatesGroup.id, payerId: bob.id, payeeId: alice.id, amount: 15000, status: 'PENDING' },
      { groupId: roommatesGroup.id, payerId: charlie.id, payeeId: alice.id, amount: 25000, status: 'PAID', proofUrl: 'https://res.cloudinary.com/demo/image/upload/sample.jpg' }
    ]
  });

  // 7. Seed Budgets
  console.log('📊 Seeding Budgets...');
  await prisma.budget.create({
    data: { userId: alice.id, groupId: roommatesGroup.id, category: 'FOOD', amount: 50000, currency: 'INR', period: 'MONTHLY', spentAmount: 14000, remainingAmount: 36000 }
  });

  await prisma.recurringExpense.create({
    data: {
      groupId: roommatesGroup.id,
      createdById: alice.id,
      title: 'Netflix Shared Subscription',
      amount: 800,
      category: 'ENTERTAINMENT',
      splitType: 'EQUAL',
      recurrenceType: 'MONTHLY',
      startDate: new Date(),
      nextRunAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      isActive: true,
      lastRunAt: new Date(),
      payload: {
        title: 'Netflix Shared Subscription',
        amount: 800,
        category: 'ENTERTAINMENT',
        splitType: 'EQUAL',
        participants: [
          { userId: alice.id },
          { userId: bob.id },
          { userId: charlie.id },
          { userId: david.id }
        ]
      }
    }
  });

  // 9. Seed System Activities & Notifications
  console.log('📜 Seeding Activities & Notifications logs...');
  await prisma.activity.create({
    data: { userId: alice.id, groupId: roommatesGroup.id, type: 'EXPENSE_CREATE', message: 'Alice added rent expense' }
  });
  await prisma.notification.create({
    data: { userId: bob.id, title: 'New Expense Added', message: 'Alice logged Apartment Rent in Roommates 2026', isRead: false }
  });

  console.log('✨ Seeding Completed Successfully!');
}

if (require.main === module) {
  main()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

module.exports = main;
