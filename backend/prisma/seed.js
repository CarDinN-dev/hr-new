const { Permission, Prisma, PrismaClient, Role } = require('@prisma/client');
const bcrypt = require('bcrypt');

async function createInitialLoginUsers(prisma, loginUsers, allPermissions) {
  return prisma.$transaction(async (tx) => {
    const emails = loginUsers.map((user) => user.email);
    const existing = await tx.user.findMany({
      where: { email: { in: emails } },
      select: { email: true },
    });
    if (existing.length) {
      throw new Error(`Login bootstrap refused because these accounts already exist: ${existing.map((user) => user.email).join(', ')}`);
    }
    for (const loginUser of loginUsers) {
      await tx.user.create({
        data: {
          email: loginUser.email,
          passwordHash: loginUser.passwordHash,
          role: loginUser.role,
          permissions: allPermissions,
        },
      });
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function main() {
  const prisma = new PrismaClient();
  const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS ?? 12);
  if (!Number.isInteger(saltRounds) || saltRounds < 10 || saltRounds > 15) {
    throw new Error('BCRYPT_SALT_ROUNDS must be an integer between 10 and 15.');
  }
  const passwordFor = (envName) => {
    const value = process.env[envName];
    if (!value) throw new Error(`${envName} must be set before seeding.`);
    if (value.length < 12 || Buffer.byteLength(value, 'utf8') > 72 || !/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/\d/.test(value)) {
      throw new Error(`${envName} must be 12-72 bytes and include uppercase, lowercase, and number characters.`);
    }
    return value;
  };
  const allPermissions = Object.values(Permission);
  const loginUsers = await Promise.all([
    { email: 'hr@med-tech.com', password: passwordFor('HR_ADMIN_PASSWORD'), role: Role.SUPER_ADMIN },
    { email: 'zahira@med-tech.com', password: passwordFor('ZAHIRA_ADMIN_PASSWORD'), role: Role.HR_ADMIN },
    { email: 'kashif@med-tech.com', password: passwordFor('KASHIF_ADMIN_PASSWORD'), role: Role.HR_ADMIN },
    { email: 'athul@med-tech.com', password: passwordFor('ATHUL_ADMIN_PASSWORD'), role: Role.HR_ADMIN },
  ].map(async (loginUser) => ({
    email: loginUser.email,
    passwordHash: await bcrypt.hash(loginUser.password, saltRounds),
    role: loginUser.role,
  })));

  try {
    await createInitialLoginUsers(prisma, loginUsers, allPermissions);

    console.log('Login bootstrap completed.');
    for (const loginUser of loginUsers) {
      console.log(`${loginUser.role}: ${loginUser.email}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { createInitialLoginUsers };
