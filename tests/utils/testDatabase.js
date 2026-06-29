const prisma = require('../../src/utils/prisma');
const cleanupTestData = require('./cleanupTestData');

async function initTestDb() {
  await prisma.$connect();
}

async function closeTestDb() {
  await prisma.$disconnect();
}

module.exports = {
  prisma,
  initTestDb,
  closeTestDb,
  cleanupTestData
};
