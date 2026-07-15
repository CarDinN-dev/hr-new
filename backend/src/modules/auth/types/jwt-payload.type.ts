export type JwtPayload = {
  sub: string;
  email: string;
  sid: string;
  authorizationVersion: number;
  csrfToken: string;
};
