const prisma = require('./prisma');

async function migrate() {
  console.log('[Migration] Starting Expense createdById migration...');
  const expenses = await prisma.expense.findMany({
    include: {
      group: { select: { createdById: true } },
      payers: { select: { userId: true } }
    }
  });

  console.log(`[Migration] Found ${expenses.length} expenses to migrate.`);

  let updatedCount = 0;
  for (const exp of expenses) {
    if (!exp.createdById) {
      const creatorId = exp.paidById || 
                        (exp.payers.length > 0 ? exp.payers[0].userId : null) || 
                        exp.group.createdById;
      
      if (creatorId) {
        await prisma.expense.update({
          where: { id: exp.id },
          data: { createdById: creatorId }
        });
        updatedCount++;
      }
    }
  }

  console.log(`[Migration] Successfully updated ${updatedCount} expenses creator references.`);
}

migrate()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
