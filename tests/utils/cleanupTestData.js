const prisma = require('../../src/utils/prisma');

async function cleanupTestData() {
  // Query all tables in public schema except prisma migrations
  const tablenames = await prisma.$queryRaw`
    SELECT tablename FROM pg_tables 
    WHERE schemaname='public' 
    AND tablename NOT LIKE '_prisma_migrations';
  `;

  if (!tablenames || tablenames.length === 0) return;

  const tableList = tablenames
    .map(t => `"public"."${t.tablename}"`)
    .join(', ');

  try {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tableList} CASCADE;`);
  } catch (error) {
    // Silent fail if schema is empty or blocked
  }
}

module.exports = cleanupTestData;
