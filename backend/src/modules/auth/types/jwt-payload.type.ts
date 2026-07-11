import { Permission, Role } from '@prisma/client';

export type JwtPayload = {
  sub: string;
  email: string;
  role: Role;
  permissions: Permission[];
  csrfToken: string;
  sessionVersion: number;
  employeeId?: string | null;
};
