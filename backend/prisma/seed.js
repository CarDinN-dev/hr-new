const { Prisma, PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const { syncRbac } = require('./sync-rbac');

function requiredPassword(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set before seeding.`);
  if (value.length < 12 || Buffer.byteLength(value, 'utf8') > 72 || !/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/\d/.test(value)) {
    throw new Error(`${name} must be 12-72 bytes and include uppercase, lowercase, and number characters.`);
  }
  return value;
}

function saltRounds() {
  const value = Number(process.env.BCRYPT_SALT_ROUNDS ?? 12);
  if (!Number.isInteger(value) || value < 10 || value > 15) throw new Error('BCRYPT_SALT_ROUNDS must be an integer between 10 and 15.');
  return value;
}

async function seedReferenceData(prisma) {
  await prisma.$transaction(async (tx) => {
    for (const [code, name, title, body] of [
      ['SALARY_CERTIFICATE', 'Salary Certificate', 'Salary Certificate', 'This certifies the employee\'s current employment and compensation details.'],
      ['EXPERIENCE_CERTIFICATE', 'Experience Certificate', 'Experience Certificate', 'This certifies the employee\'s service and position with the company.'],
      ['CLEARANCE_CERTIFICATE', 'Clearance Certificate', 'Clearance Certificate', 'This certifies the recorded clearance status for the employee.'],
    ]) {
      await tx.documentTemplate.upsert({
        where: { code_version: { code, version: 1 } },
        create: { code, version: 1, name, title, body },
        update: { name, title, body, isActive: true },
      });
    }
    for (const [stage, mode] of [['HR', 'ANY_ONE'], ['CPO', 'PRIMARY_APPROVER'], ['COO', 'PRIMARY_APPROVER']]) {
      await tx.workflowStagePolicy.upsert({
        where: { workflowType_stage: { workflowType: 'LEAVE', stage } },
        create: { workflowType: 'LEAVE', stage, mode },
        update: {},
      });
    }
    await tx.auditChainState.upsert({ where: { id: 'default' }, create: { id: 'default' }, update: {} });
    await tx.auditRetentionPolicy.upsert({ where: { id: 'default' }, create: { id: 'default' }, update: {} });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function createInitialSuperAdmin(prisma) {
  const email = process.env.INITIAL_SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  if (!email) throw new Error('INITIAL_SUPER_ADMIN_EMAIL must be set before production seeding.');
  const role = await prisma.role.findUniqueOrThrow({ where: { code: 'SUPER_ADMIN' }, select: { id: true } });
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  const passwordHash = existing ? undefined : await bcrypt.hash(requiredPassword('INITIAL_SUPER_ADMIN_PASSWORD'), saltRounds());
  const user = await prisma.$transaction(async (tx) => {
    const account = await tx.user.upsert({
      where: { email },
      create: { email, passwordHash, isActive: true, localLoginEnabled: true },
      update: { isActive: true, deletedAt: null },
    });
    await tx.userRole.upsert({
      where: { userId_roleId: { userId: account.id, roleId: role.id } },
      create: { userId: account.id, roleId: role.id, reason: 'Initial protected administrator bootstrap' },
      update: { revokedAt: null, expiresAt: null, reason: 'Initial protected administrator bootstrap' },
    });
    return account;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return { created: !existing, user: { id: user.id, email: user.email } };
}

async function createTestPersonas(prisma, passwordHash) {
  if (process.env.SEED_TEST_PERSONAS !== 'true') return { created: 0, skipped: true };
  const codes = ['EMPLOYEE', 'LINE_MANAGER', 'MANAGER', 'HR', 'CPO', 'COO', 'ADMIN', 'SUPER_ADMIN'];
  return prisma.$transaction(async (tx) => {
    const roles = await tx.role.findMany({ where: { code: { in: codes }, isActive: true } });
    const roleByCode = new Map(roles.map((role) => [role.code, role]));
    if (roles.length !== codes.length) throw new Error('Run the RBAC seed before creating test personas.');
    const department = await tx.department.upsert({
      where: { code: 'RBAC_TEST' },
      create: { code: 'RBAC_TEST', name: 'RBAC Test Department' },
      update: { deletedAt: null },
    });
    const employees = new Map();
    const users = new Map();
    let created = 0;
    for (const roleCode of codes) {
      const email = `rbac.${roleCode.toLowerCase()}@example.invalid`;
      const existing = await tx.user.findUnique({ where: { email }, select: { id: true } });
      const account = await tx.user.upsert({
        where: { email },
        create: { email, passwordHash, isActive: true },
        update: { passwordHash, localLoginEnabled: true, isActive: true, deletedAt: null },
      });
      users.set(roleCode, account);
      if (!existing) created += 1;
      const role = roleByCode.get(roleCode);
      await tx.userRole.upsert({
        where: { userId_roleId: { userId: account.id, roleId: role.id } },
        create: { userId: account.id, roleId: role.id, reason: 'Automated integration-test persona' },
        update: { revokedAt: null, expiresAt: null, reason: 'Automated integration-test persona' },
      });
      const employeeCode = `RBAC-${roleCode.slice(0, 12)}`;
      const employee = await tx.employee.upsert({
        where: { employeeCode },
        create: {
          employeeCode, userId: account.id,
          firstName: roleCode.split('_').map((part) => part[0] + part.slice(1).toLowerCase()).join(' '),
          lastName: 'Persona', email, hireDate: new Date('2026-01-01T00:00:00.000Z'), salary: '10000.00', departmentId: department.id,
        },
        update: { userId: account.id, email, departmentId: department.id, deletedAt: null },
      });
      employees.set(roleCode, employee);
    }
    await tx.employee.update({ where: { id: employees.get('EMPLOYEE').id }, data: { managerId: employees.get('LINE_MANAGER').id } });
    await tx.employee.update({ where: { id: employees.get('LINE_MANAGER').id }, data: { managerId: employees.get('MANAGER').id } });
    await tx.employee.update({ where: { id: employees.get('MANAGER').id }, data: { managerId: employees.get('CPO').id } });
    await tx.employee.update({ where: { id: employees.get('HR').id }, data: { managerId: employees.get('CPO').id } });
    await tx.employee.update({ where: { id: employees.get('CPO').id }, data: { managerId: employees.get('COO').id } });
    await tx.department.update({ where: { id: department.id }, data: { managerId: employees.get('MANAGER').id } });
    await tx.workflowStagePolicy.update({ where: { workflowType_stage: { workflowType: 'LEAVE', stage: 'CPO' } }, data: { primaryUserId: users.get('CPO').id } });
    await tx.workflowStagePolicy.update({ where: { workflowType_stage: { workflowType: 'LEAVE', stage: 'COO' } }, data: { primaryUserId: users.get('COO').id } });
    await tx.leaveType.upsert({
      where: { code: 'ANNUAL' },
      create: { code: 'ANNUAL', name: 'Annual leave', annualAllowanceDays: new Prisma.Decimal(30), isPaid: true },
      update: { deletedAt: null },
    });
    return { created, skipped: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const rbac = await syncRbac(prisma, { resetBuiltins: process.env.RESET_BUILTIN_ROLES === 'true' });
    await seedReferenceData(prisma);
    const bootstrap = process.env.SEED_TEST_PERSONAS === 'true' ? { skipped: true } : await createInitialSuperAdmin(prisma);
    const personas = process.env.SEED_TEST_PERSONAS === 'true'
      ? await createTestPersonas(prisma, await bcrypt.hash(requiredPassword('TEST_PERSONA_PASSWORD'), saltRounds()))
      : { skipped: true };
    console.log(JSON.stringify({ rbac, bootstrap, personas }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) main().catch((error) => { console.error(error); process.exit(1); });

module.exports = { createInitialSuperAdmin, createTestPersonas, seedReferenceData };
