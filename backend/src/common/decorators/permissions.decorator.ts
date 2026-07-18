import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';
export const ANY_PERMISSIONS_KEY = 'anyPermissions';
export const SUPER_ADMIN_ONLY_KEY = 'superAdminOnly';

export const Permissions = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);
export const AnyPermission = (...permissions: string[]) => SetMetadata(ANY_PERMISSIONS_KEY, permissions);
export const SuperAdminOnly = () => SetMetadata(SUPER_ADMIN_ONLY_KEY, true);
