const { LegacyPermission, LegacyRole, Prisma, PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const { migrateRbac } = require('./migrate-rbac');

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

async function createTestPersonas(prisma, passwordHash) {
  if (process.env.SEED_TEST_PERSONAS !== 'true') return { created: 0, skipped: true };
  const definitions = [
    ['EMPLOYEE', 'EMPLOYEE'], ['LINE_MANAGER', 'MANAGER'], ['DEPARTMENT_HEAD', 'MANAGER'],
    ['HR_OFFICER', 'HR_ADMIN'], ['HR_MANAGER', 'HR_ADMIN'], ['PAYROLL_OFFICER', 'HR_ADMIN'],
    ['AUDITOR', 'HR_ADMIN'], ['SYSTEM_ADMIN', 'SUPER_ADMIN'],
  ];
  return prisma.$transaction(async (tx) => {
    const roles = await tx.role.findMany({ where: { code: { in: definitions.map(([code]) => code) }, isActive: true } });
    const roleByCode = new Map(roles.map((role) => [role.code, role]));
    if (roles.length !== definitions.length) throw new Error('Run the RBAC migration before seeding test personas.');
    const department = await tx.department.upsert({
      where: { code: 'RBAC_TEST' },
      create: { code: 'RBAC_TEST', name: 'RBAC Test Department' },
      update: { deletedAt: null },
    });
    const employees = new Map();
    let created = 0;
    for (const [roleCode, legacyRole] of definitions) {
      const email = `rbac.${roleCode.toLowerCase()}@example.invalid`;
      const existing = await tx.user.findUnique({ where: { email }, select: { id: true } });
      const account = await tx.user.upsert({
        where: { email },
        create: { email, passwordHash, role: legacyRole, permissions: [], isActive: true, rbacMigratedAt: new Date() },
        update: { passwordHash, isActive: true, deletedAt: null, rbacMigratedAt: new Date() },
      });
      if (!existing) created += 1;
      const role = roleByCode.get(roleCode);
      await tx.userRole.upsert({
        where: { userId_roleId: { userId: account.id, roleId: role.id } },
        create: { userId: account.id, roleId: role.id, reason: 'Automated integration-test persona' },
        update: { revokedAt: null, expiresAt: null, reason: 'Automated integration-test persona' },
      });
      if (roleCode !== 'SYSTEM_ADMIN') {
        const employeeCode = `RBAC-${roleCode.slice(0, 12)}`;
        const employee = await tx.employee.upsert({
          where: { employeeCode },
          create: {
            employeeCode, userId: account.id, firstName: roleCode.split('_').map((part) => part[0] + part.slice(1).toLowerCase()).join(' '),
            lastName: 'Persona', email, hireDate: new Date('2026-01-01T00:00:00.000Z'), salary: '10000.00', departmentId: department.id,
          },
          update: { userId: account.id, email, departmentId: department.id, deletedAt: null },
        });
        employees.set(roleCode, employee);
      }
    }
    const manager = employees.get('LINE_MANAGER');
    const head = employees.get('DEPARTMENT_HEAD');
    const employee = employees.get('EMPLOYEE');
    await tx.department.update({ where: { id: department.id }, data: { managerId: head.id } });
    await tx.employee.update({ where: { id: employee.id }, data: { managerId: manager.id } });
    return { created, skipped: false };
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
  const allPermissions = Object.values(LegacyPermission);
  const loginUsers = await Promise.all([
    { email: 'hr@med-tech.com', password: passwordFor('HR_ADMIN_PASSWORD'), role: LegacyRole.SUPER_ADMIN },
    { email: 'zahira@med-tech.com', password: passwordFor('ZAHIRA_ADMIN_PASSWORD'), role: LegacyRole.HR_ADMIN },
    { email: 'kashif@med-tech.com', password: passwordFor('KASHIF_ADMIN_PASSWORD'), role: LegacyRole.HR_ADMIN },
    { email: 'athul@med-tech.com', password: passwordFor('ATHUL_ADMIN_PASSWORD'), role: LegacyRole.HR_ADMIN },
  ].map(async (loginUser) => ({
    email: loginUser.email,
    passwordHash: await bcrypt.hash(loginUser.password, saltRounds),
    role: loginUser.role,
  })));

  try {
    await createInitialLoginUsers(prisma, loginUsers, allPermissions);
    const rbacReport = await migrateRbac(prisma, { apply: true });
    const testPersonaReport = process.env.SEED_TEST_PERSONAS === 'true'
      ? await createTestPersonas(prisma, await bcrypt.hash(passwordFor('TEST_PERSONA_PASSWORD'), saltRounds))
      : { skipped: true };

    console.log('Login bootstrap completed.');
    for (const loginUser of loginUsers) {
      console.log(`${loginUser.role}: ${loginUser.email}`);
    }
    console.log(`RBAC bootstrap: ${JSON.stringify(rbacReport)}`);
    console.log(`Test personas: ${JSON.stringify(testPersonaReport)}`);
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

module.exports = { createInitialLoginUsers, createTestPersonas };
