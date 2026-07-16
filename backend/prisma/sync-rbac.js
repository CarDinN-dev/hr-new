const { Prisma, PrismaClient } = require('@prisma/client');
const catalog = require('./rbac-catalog.json');

function titleFromCode(code) {
  return code.split(/[._-]/u).filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join(' ');
}

function validateCatalog() {
  const invalid = [];
  const permissionCodes = new Set(catalog.permissions);
  if (permissionCodes.size !== catalog.permissions.length) invalid.push('Duplicate permission code');
  for (const code of permissionCodes) if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/u.test(code)) invalid.push(`Invalid permission code: ${code}`);
  const roles = new Map();
  for (const role of catalog.roles) {
    if (!/^[A-Z][A-Z0-9_]*$/u.test(role.code) || roles.has(role.code)) invalid.push(`Invalid or duplicate role code: ${role.code}`);
    roles.set(role.code, role);
    for (const code of role.permissions) if (!permissionCodes.has(code)) invalid.push(`Unknown permission ${code} on ${role.code}`);
  }
  for (const role of catalog.roles) for (const inherited of role.inherits) if (!roles.has(inherited)) invalid.push(`Unknown inherited role ${inherited} on ${role.code}`);
  for (const code of catalog.protectedPermissions) if (!permissionCodes.has(code)) invalid.push(`Unknown protected permission ${code}`);
  if (invalid.length) throw new Error(`RBAC catalogue validation failed:\n${invalid.join('\n')}`);
  return { permissionCodes, roles };
}

function expandedPermissions(roleCode, roles, stack = new Set()) {
  if (stack.has(roleCode)) throw new Error(`RBAC role inheritance cycle at ${roleCode}`);
  const role = roles.get(roleCode);
  if (!role) throw new Error(`Unknown role ${roleCode}`);
  const next = new Set(stack).add(roleCode);
  const permissions = new Set(role.permissions);
  for (const inherited of role.inherits) for (const code of expandedPermissions(inherited, roles, next)) permissions.add(code);
  return permissions;
}

async function syncRbac(prisma, options = {}) {
  const { roles } = validateCatalog();
  const report = { permissionsCreated: 0, rolesCreated: 0, rolePermissionsCreated: 0, rolePermissionsRemoved: 0 };
  await prisma.$transaction(async (tx) => {
    const permissionByCode = new Map();
    for (const code of catalog.permissions) {
      const existing = await tx.permission.findUnique({ where: { code }, select: { id: true } });
      const permission = await tx.permission.upsert({
        where: { code },
        create: { code, displayName: titleFromCode(code), category: code.split('.')[0], isProtected: catalog.protectedPermissions.includes(code) },
        update: { displayName: titleFromCode(code), category: code.split('.')[0], isProtected: catalog.protectedPermissions.includes(code), isDeprecated: false },
      });
      permissionByCode.set(code, permission);
      if (!existing) report.permissionsCreated += 1;
    }
    for (const definition of catalog.roles) {
      const existing = await tx.role.findUnique({ where: { code: definition.code }, select: { id: true, isBuiltIn: true } });
      if (existing && !existing.isBuiltIn) throw new Error(`Custom role conflicts with built-in role ${definition.code}`);
      const role = await tx.role.upsert({
        where: { code: definition.code },
        create: { code: definition.code, displayName: definition.displayName, description: definition.description, isBuiltIn: true, protection: definition.protection },
        update: { displayName: definition.displayName, description: definition.description, isBuiltIn: true, protection: definition.protection, isActive: true },
      });
      if (!existing) report.rolesCreated += 1;
      const desired = definition.code === 'SUPER_ADMIN' ? new Set(catalog.permissions) : expandedPermissions(definition.code, roles);
      const links = await tx.rolePermission.findMany({ where: { roleId: role.id }, select: { permissionId: true, permission: { select: { code: true } } } });
      const remove = links.filter((link) => !desired.has(link.permission.code)).map((link) => link.permissionId);
      if (remove.length) report.rolePermissionsRemoved += (await tx.rolePermission.deleteMany({ where: { roleId: role.id, permissionId: { in: remove } } })).count;
      for (const code of desired) {
        const permission = permissionByCode.get(code);
        const found = links.some((link) => link.permissionId === permission.id);
        if (!found) {
          await tx.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
          report.rolePermissionsCreated += 1;
        }
      }
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 120_000 });
  return report;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log(JSON.stringify(await syncRbac(prisma, { resetBuiltins: process.argv.includes('--reset-builtins') }), null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) main().catch((error) => { console.error(error); process.exit(1); });

module.exports = { expandedPermissions, syncRbac, validateCatalog };
