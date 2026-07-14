const { Permission, PrismaClient, Role } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
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
  const loginUsers = [
    { email: 'hr@med-tech.com', password: passwordFor('HR_ADMIN_PASSWORD'), role: Role.SUPER_ADMIN },
    { email: 'zahira@med-tech.com', password: passwordFor('ZAHIRA_ADMIN_PASSWORD'), role: Role.HR_ADMIN },
    { email: 'kashif@med-tech.com', password: passwordFor('KASHIF_ADMIN_PASSWORD'), role: Role.HR_ADMIN },
    { email: 'athul@med-tech.com', password: passwordFor('ATHUL_ADMIN_PASSWORD'), role: Role.HR_ADMIN },
  ];

  for (const loginUser of loginUsers) {
    const existing = await prisma.user.findUnique({ where: { email: loginUser.email } });
    if (existing) continue;
    await prisma.user.create({
      data: {
        email: loginUser.email,
        passwordHash: await bcrypt.hash(loginUser.password, saltRounds),
        role: loginUser.role,
        permissions: allPermissions,
      },
    });
  }

  console.log('Login bootstrap completed. Existing accounts were left unchanged.');
  for (const loginUser of loginUsers) {
    console.log(`${loginUser.role}: ${loginUser.email}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
