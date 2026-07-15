const { randomUUID } = require('crypto');
const { Prisma, PrismaClient } = require('@prisma/client');
const catalog = require('./rbac-catalog.json');

function titleFromCode(code) {
  return code
    .split(/[._-]/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function validateCatalog() {
  const invalid = [];
  const permissionCodes = new Set();
  for (const code of catalog.permissions) {
    if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/u.test(code)) invalid.push(`Invalid permission code: ${code}`);
    if (permissionCodes.has(code)) invalid.push(`Duplicate permission code: ${code}`);
    permissionCodes.add(code);
  }

  const roles = new Map();
  for (const role of catalog.roles) {
    if (!/^[A-Z][A-Z0-9_]*$/u.test(role.code)) invalid.push(`Invalid role code: ${role.code}`);
    if (roles.has(role.code)) invalid.push(`Duplicate role code: ${role.code}`);
    roles.set(role.code, role);
    for (const code of role.permissions) {
      if (!permissionCodes.has(code)) invalid.push(`Unknown permission ${code} on ${role.code}`);
    }
  }
  for (const role of catalog.roles) {
    for (const inherited of role.inherits) {
      if (!roles.has(inherited)) invalid.push(`Unknown inherited role ${inherited} on ${role.code}`);
    }
  }
  for (const [legacy, mappedRoles] of Object.entries(catalog.legacyRoleMap)) {
    for (const roleCode of mappedRoles) {
      if (!roles.has(roleCode)) invalid.push(`Unknown role ${roleCode} mapped from ${legacy}`);
    }
  }
  for (const [legacy, mappedPermissions] of Object.entries(catalog.legacyPermissionMap)) {
    for (const code of mappedPermissions) {
      if (!permissionCodes.has(code)) invalid.push(`Unknown permission ${code} mapped from ${legacy}`);
    }
  }
  for (const [legacy, mappedPermissions] of Object.entries(catalog.legacyRoleCompatibilityPermissions ?? {})) {
    if (!catalog.legacyRoleMap[legacy]) invalid.push(`Unknown legacy role compatibility mapping: ${legacy}`);
    for (const code of mappedPermissions) {
      if (!permissionCodes.has(code)) invalid.push(`Unknown compatibility permission ${code} mapped from ${legacy}`);
    }
  }
  if (invalid.length) throw new Error(`RBAC catalogue validation failed:\n${invalid.join('\n')}`);
  return { permissionCodes, roles };
}

function expandedPermissions(roleCode, roles, stack = new Set()) {
  if (stack.has(roleCode)) throw new Error(`RBAC role inheritance cycle at ${roleCode}`);
  const role = roles.get(roleCode);
  if (!role) throw new Error(`Unknown role ${roleCode}`);
  const nextStack = new Set(stack).add(roleCode);
  const permissions = new Set(role.permissions);
  for (const inherited of role.inherits) {
    for (const code of expandedPermissions(inherited, roles, nextStack)) permissions.add(code);
  }
  return permissions;
}

function newReport(mode) {
  return {
    mode,
    created: { permissions: 0, roles: 0, rolePermissions: 0, assignments: 0, compatibilityRoles: 0, users: 0 },
    removed: { rolePermissions: 0 },
    skipped: { users: 0, permissions: 0, roles: 0, rolePermissions: 0, assignments: 0 },
    invalid: [],
    conflicting: [],
  };
}

async function inspectRbac(prisma) {
  const { roles } = validateCatalog();
  const [permissionCount, roleCount, assignmentCount, users] = await Promise.all([
    prisma.permission.count(),
    prisma.role.count(),
    prisma.userRole.count({ where: { revokedAt: null } }),
    prisma.user.findMany({
      select: { id: true, email: true, role: true, permissions: true, rbacMigratedAt: true },
      orderBy: { email: 'asc' },
    }),
  ]);
  const report = newReport('dry-run');
  report.current = { permissionCount, roleCount, assignmentCount, userCount: users.length };
  report.proposed = {
    permissions: catalog.permissions.length,
    roles: catalog.roles.length,
    unmigratedUsers: users.filter((user) => !user.rbacMigratedAt).length,
  };
  for (const user of users.filter((entry) => !entry.rbacMigratedAt)) {
    if (!catalog.legacyRoleMap[user.role]) report.invalid.push({ userId: user.id, email: user.email, reason: `Unknown legacy role ${user.role}` });
    for (const legacyPermission of user.permissions) {
      if (!catalog.legacyPermissionMap[legacyPermission]) {
        report.invalid.push({ userId: user.id, email: user.email, reason: `Unknown legacy permission ${legacyPermission}` });
      }
    }
  }
  for (const role of catalog.roles) expandedPermissions(role.code, roles);
  return report;
}

async function applyRbac(prisma) {
  const { roles } = validateCatalog();
  const report = newReport('apply');

  await prisma.$transaction(async (tx) => {
    const permissionByCode = new Map();
    for (const code of catalog.permissions) {
      const existing = await tx.permission.findUnique({ where: { code }, select: { id: true } });
      const permission = existing
        ? await tx.permission.update({ where: { code }, data: { displayName: titleFromCode(code), category: code.split('.')[0] } })
        : await tx.permission.create({ data: { id: randomUUID(), code, displayName: titleFromCode(code), category: code.split('.')[0] } });
      permissionByCode.set(code, permission);
      if (existing) report.skipped.permissions += 1;
      else report.created.permissions += 1;
    }

    const roleByCode = new Map();
    for (const definition of catalog.roles) {
      const existing = await tx.role.findUnique({ where: { code: definition.code }, select: { id: true, isBuiltIn: true } });
      if (existing && !existing.isBuiltIn) {
        report.conflicting.push({ role: definition.code, reason: 'A custom role already uses a built-in role code' });
        continue;
      }
      const role = existing
        ? await tx.role.update({
            where: { code: definition.code },
            data: { displayName: definition.displayName, description: definition.description, isBuiltIn: true, isActive: true },
          })
        : await tx.role.create({
            data: { id: randomUUID(), code: definition.code, displayName: definition.displayName, description: definition.description, isBuiltIn: true },
          });
      roleByCode.set(definition.code, role);
      if (existing) report.skipped.roles += 1;
      else report.created.roles += 1;

      const desiredPermissionCodes = expandedPermissions(definition.code, roles);
      const existingLinks = await tx.rolePermission.findMany({
        where: { roleId: role.id },
        select: { permissionId: true, permission: { select: { code: true } } },
      });
      const removedPermissionIds = existingLinks
        .filter((link) => !desiredPermissionCodes.has(link.permission.code))
        .map((link) => link.permissionId);
      if (removedPermissionIds.length) {
        const removed = await tx.rolePermission.deleteMany({ where: { roleId: role.id, permissionId: { in: removedPermissionIds } } });
        report.removed.rolePermissions += removed.count;
      }
      let rolePermissionsChanged = removedPermissionIds.length > 0;
      for (const permissionCode of desiredPermissionCodes) {
        const permission = permissionByCode.get(permissionCode);
        const existingLink = await tx.rolePermission.findUnique({
          where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
          select: { roleId: true },
        });
        if (existingLink) report.skipped.rolePermissions += 1;
        else {
          await tx.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
          report.created.rolePermissions += 1;
          rolePermissionsChanged = true;
        }
      }
      if (existing && rolePermissionsChanged) {
        await tx.role.update({ where: { id: role.id }, data: { version: { increment: 1 } } });
        const assignments = await tx.userRole.findMany({
          where: { roleId: role.id, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
          select: { userId: true },
        });
        const userIds = [...new Set(assignments.map((assignment) => assignment.userId))];
        if (userIds.length) {
          await tx.user.updateMany({ where: { id: { in: userIds } }, data: { authorizationVersion: { increment: 1 } } });
          await tx.authSession.updateMany({ where: { userId: { in: userIds }, revokedAt: null }, data: { revokedAt: new Date() } });
        }
      }
    }

    if (report.conflicting.length) throw new Error(`RBAC migration conflicts: ${JSON.stringify(report.conflicting)}`);

    const users = await tx.user.findMany({
      where: { rbacMigratedAt: null },
      select: { id: true, email: true, role: true, permissions: true },
      orderBy: { email: 'asc' },
    });
    report.skipped.users = await tx.user.count({ where: { rbacMigratedAt: { not: null } } });

    for (const user of users) {
      const mappedRoleCodes = catalog.legacyRoleMap[user.role];
      if (!mappedRoleCodes) {
        report.invalid.push({ userId: user.id, email: user.email, reason: `Unknown legacy role ${user.role}` });
        continue;
      }
      const desiredPermissionCodes = new Set();
      let invalidUser = false;
      for (const legacyPermission of user.permissions) {
        const mapped = catalog.legacyPermissionMap[legacyPermission];
        if (!mapped) {
          report.invalid.push({ userId: user.id, email: user.email, reason: `Unknown legacy permission ${legacyPermission}` });
          invalidUser = true;
          continue;
        }
        for (const code of mapped) desiredPermissionCodes.add(code);
      }
      if (invalidUser) continue;

      const coveredPermissions = new Set();
      for (const roleCode of mappedRoleCodes) {
        const role = roleByCode.get(roleCode);
        if (!role) throw new Error(`Built-in role ${roleCode} was not seeded`);
        for (const code of expandedPermissions(roleCode, roles)) coveredPermissions.add(code);
        const existing = await tx.userRole.findUnique({ where: { userId_roleId: { userId: user.id, roleId: role.id } } });
        if (existing) {
          await tx.userRole.update({
            where: { userId_roleId: { userId: user.id, roleId: role.id } },
            data: { revokedAt: null, expiresAt: null, reason: 'Migrated from legacy role' },
          });
          report.skipped.assignments += 1;
        } else {
          await tx.userRole.create({
            data: { id: randomUUID(), userId: user.id, roleId: role.id, reason: 'Migrated from legacy role' },
          });
          report.created.assignments += 1;
        }
      }

      const legacyCompatibilityPermissions = catalog.legacyRoleCompatibilityPermissions?.[user.role] ?? [];
      if (legacyCompatibilityPermissions.length) {
        const compatibilityCode = `LEGACY_${user.role}_COMPATIBILITY`;
        const existingCompatibilityRole = await tx.role.findUnique({ where: { code: compatibilityCode } });
        if (existingCompatibilityRole && !existingCompatibilityRole.isBuiltIn) {
          report.conflicting.push({ role: compatibilityCode, reason: 'A custom role already uses a legacy compatibility role code' });
          continue;
        }
        const compatibilityRole = existingCompatibilityRole
          ? await tx.role.update({
              where: { id: existingCompatibilityRole.id },
              data: { displayName: 'Legacy HR administrator compatibility', isActive: true },
            })
          : await tx.role.create({
              data: {
                id: randomUUID(),
                code: compatibilityCode,
                displayName: 'Legacy HR administrator compatibility',
                description: 'Preserves configuration, import and user-management access for migrated legacy HR administrators',
                isBuiltIn: true,
              },
            });
        if (!existingCompatibilityRole) report.created.compatibilityRoles += 1;
        const desiredCompatibilityCodes = new Set(legacyCompatibilityPermissions);
        const existingCompatibilityLinks = await tx.rolePermission.findMany({
          where: { roleId: compatibilityRole.id },
          select: { permissionId: true, permission: { select: { code: true } } },
        });
        const obsoleteCompatibilityPermissionIds = existingCompatibilityLinks
          .filter((link) => !desiredCompatibilityCodes.has(link.permission.code))
          .map((link) => link.permissionId);
        if (obsoleteCompatibilityPermissionIds.length) {
          const removed = await tx.rolePermission.deleteMany({
            where: { roleId: compatibilityRole.id, permissionId: { in: obsoleteCompatibilityPermissionIds } },
          });
          report.removed.rolePermissions += removed.count;
        }
        for (const code of legacyCompatibilityPermissions) {
          const permission = permissionByCode.get(code);
          await tx.rolePermission.upsert({
            where: { roleId_permissionId: { roleId: compatibilityRole.id, permissionId: permission.id } },
            create: { roleId: compatibilityRole.id, permissionId: permission.id },
            update: {},
          });
          coveredPermissions.add(code);
        }
        const existingAssignment = await tx.userRole.findUnique({
          where: { userId_roleId: { userId: user.id, roleId: compatibilityRole.id } },
        });
        await tx.userRole.upsert({
          where: { userId_roleId: { userId: user.id, roleId: compatibilityRole.id } },
          create: { id: randomUUID(), userId: user.id, roleId: compatibilityRole.id, reason: 'Migrated legacy HR administrator compatibility access' },
          update: { revokedAt: null, expiresAt: null, reason: 'Migrated legacy HR administrator compatibility access' },
        });
        if (existingAssignment) report.skipped.assignments += 1;
        else report.created.assignments += 1;
      }

      const compatibilityPermissions = [...desiredPermissionCodes].filter((code) => !coveredPermissions.has(code));
      if (compatibilityPermissions.length) {
        const compatibilityCode = `LEGACY_${user.id.replace(/[^a-zA-Z0-9]/gu, '').slice(0, 12).toUpperCase()}`;
        let compatibilityRole = await tx.role.findUnique({ where: { code: compatibilityCode } });
        if (!compatibilityRole) {
          compatibilityRole = await tx.role.create({
            data: {
              id: randomUUID(),
              code: compatibilityCode,
              displayName: `Legacy access for ${user.email}`,
              description: 'Visible compatibility role created from explicit legacy permissions',
              isBuiltIn: false,
            },
          });
          report.created.compatibilityRoles += 1;
        }
        for (const code of compatibilityPermissions) {
          const permission = permissionByCode.get(code);
          await tx.rolePermission.upsert({
            where: { roleId_permissionId: { roleId: compatibilityRole.id, permissionId: permission.id } },
            create: { roleId: compatibilityRole.id, permissionId: permission.id },
            update: {},
          });
        }
        await tx.userRole.upsert({
          where: { userId_roleId: { userId: user.id, roleId: compatibilityRole.id } },
          create: { id: randomUUID(), userId: user.id, roleId: compatibilityRole.id, reason: 'Migrated explicit legacy permissions' },
          update: { revokedAt: null, expiresAt: null, reason: 'Migrated explicit legacy permissions' },
        });
        report.created.assignments += 1;
      }

      await tx.user.update({
        where: { id: user.id },
        data: { rbacMigratedAt: new Date(), authorizationVersion: { increment: 1 } },
      });
      report.created.users += 1;
    }

    if (report.invalid.length || report.conflicting.length) {
      throw new Error(`RBAC migration stopped: ${JSON.stringify({ invalid: report.invalid, conflicting: report.conflicting })}`);
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 120_000 });

  return report;
}

async function migrateRbac(prisma, options = {}) {
  return options.apply ? applyRbac(prisma) : inspectRbac(prisma);
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const report = await migrateRbac(prisma, { apply: process.argv.includes('--apply') });
    console.log(JSON.stringify(report, null, 2));
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

module.exports = { expandedPermissions, migrateRbac, validateCatalog };
