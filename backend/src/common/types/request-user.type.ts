import { Permission, Role } from '@prisma/client';

export type RequestUser = {
  id: string;
  email: string;
  role: Role;
  permissions: Permission[];
  sessionVersion: number;
  csrfToken?: string;
  employeeId?: string | null;
};
