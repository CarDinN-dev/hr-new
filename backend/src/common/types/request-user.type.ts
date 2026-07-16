import { AccessScopeType, PermissionOverrideEffect } from '@prisma/client';

export type PermissionOverrideContext = {
  permission: string;
  effect: PermissionOverrideEffect;
  scopeType: AccessScopeType;
  scopeIds: string[];
};

export type RequestUser = {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  permissions: string[];
  rolePermissions: string[];
  permissionOverrides: PermissionOverrideContext[];
  isSuperAdmin: boolean;
  sessionId: string;
  authProvider: string;
  authorizationVersion: number;
  csrfToken?: string;
  employeeId?: string | null;
  departmentScopeIds: string[];
  reauthenticatedAt?: Date;
  requestId?: string;
  ipHash?: string | null;
  userAgent?: string | null;
  route?: string;
  httpMethod?: string;
};
