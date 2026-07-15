export type RequestUser = {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  permissions: string[];
  sessionId: string;
  authorizationVersion: number;
  csrfToken?: string;
  employeeId?: string | null;
  departmentScopeIds: string[];
  requestId?: string;
};
