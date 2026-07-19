import { RequestUser } from './types/request-user.type';

export function hasActiveSuperAdminRole(user: Pick<RequestUser, 'isSuperAdmin' | 'roles'>) {
  return user.isSuperAdmin && user.roles.includes('SUPER_ADMIN');
}

export function hasActiveSystemAdministratorRole(user: Pick<RequestUser, 'isSuperAdmin' | 'roles'>) {
  return hasActiveSuperAdminRole(user) || user.roles.includes('ADMIN');
}

export function hasPermission(user: RequestUser, permission: string) {
  return user.permissions.includes(permission);
}

export function hasAnyPermission(user: RequestUser, permissions: readonly string[]) {
  return permissions.some((permission) => hasPermission(user, permission));
}
