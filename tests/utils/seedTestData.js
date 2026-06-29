require('dotenv').config();
const testFactory = require('./testFactory');

async function seedTestData() {
  console.log('Seeding initial test records...');
  
  // Seed two main users
  const user1 = await testFactory.createUser({ email: 'user1@test.com', name: 'User One' });
  const user2 = await testFactory.createUser({ email: 'user2@test.com', name: 'User Two' });

  // Seed a group
  const group = await testFactory.createGroup(user1.id, { name: 'Holiday Trip' });
  
  // Add second user to the group
  await testFactory.addMember(group.id, user2.id, 'MEMBER');

  console.log('✓ Successfully seeded initial test users and group.');
  return {
    user1,
    user2,
    group
  };
}

if (require.main === module) {
  (async () => {
    const prisma = require('../../src/utils/prisma');
    const cleanupTestData = require('./cleanupTestData');
    try {
      await prisma.$connect();
      await cleanupTestData();
      await seedTestData();
      await prisma.$disconnect();
      process.exit(0);
    } catch (err) {
      console.error('Failed to seed database test fixtures:', err);
      await prisma.$disconnect();
      process.exit(1);
    }
  })();
}

module.exports = seedTestData;
