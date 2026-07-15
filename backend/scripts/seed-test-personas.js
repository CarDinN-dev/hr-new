const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');
const { createTestPersonas } = require('../prisma/seed');

async function main() {
  if (process.env.SEED_TEST_PERSONAS !== 'true') throw new Error('SEED_TEST_PERSONAS=true is required.');
  const password = process.env.TEST_PERSONA_PASSWORD;
  if (!password || password.length < 12 || Buffer.byteLength(password, 'utf8') > 72 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    throw new Error('TEST_PERSONA_PASSWORD must be 12-72 bytes and include uppercase, lowercase, and number characters.');
  }
  const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS ?? 12);
  const prisma = new PrismaClient();
  try {
    console.log(JSON.stringify(await createTestPersonas(prisma, await bcrypt.hash(password, saltRounds)), null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
