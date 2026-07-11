import { Permission, Role } from '@prisma/client';

export type RequestUser = {
  id: string;
  email: string;
  role: Role;
  permissions: Permission[];
  csrfToken?: string;
  employeeId?: string | null;
};
