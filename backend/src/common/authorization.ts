import { RequestUser } from './types/request-user.type';

export function hasPermission(user: RequestUser, permission: string) {
  return user.permissions.includes(permission);
}

export function hasAnyPermission(user: RequestUser, permissions: readonly string[]) {
  return permissions.some((permission) => hasPermission(user, permission));
}
