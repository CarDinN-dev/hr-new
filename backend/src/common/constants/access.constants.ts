import { Role } from '@prisma/client';

export const HR_ADMIN_ROLES: Role[] = [Role.SUPER_ADMIN, Role.HR_ADMIN];
export const MANAGEMENT_ROLES: Role[] = [Role.SUPER_ADMIN, Role.HR_ADMIN, Role.MANAGER];

export function hasHrAccess(role: Role): boolean {
  return HR_ADMIN_ROLES.includes(role);
}

export function hasManagementAccess(role: Role): boolean {
  return MANAGEMENT_ROLES.includes(role);
}
