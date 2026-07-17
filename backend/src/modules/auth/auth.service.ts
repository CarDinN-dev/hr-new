import { HttpException, HttpStatus, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { AuditAction, AuditOutcome, Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, createHmac, randomBytes, randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { RequestUser } from '../../common/types/request-user.type';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { AuditService } from '../audit/audit.service';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './types/jwt-payload.type';
import { StepUpDto } from './dto/step-up.dto';

const productionSessionCookie = '__Host-medtech_hr_session';
const developmentSessionCookie = 'medtech_hr_session';

export function sessionTokenFromRequest(request?: Request) {
  const header = request?.headers?.cookie;
  if (!header) return null;
  const cookies = new Map(
    header.split(';').map((part) => {
      const separator = part.indexOf('=');
      return separator < 0
        ? [part.trim(), '']
        : [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
    }),
  );
  return cookies.get(productionSessionCookie) || cookies.get(developmentSessionCookie) || null;
}

type SessionUser = {
  id: string;
  email: string;
  authorizationVersion: number;
};

export type IssuedSession = {
  user: RequestUser;
  accessToken: string;
  csrfToken: string;
};

@Injectable()
export class AuthService {
  private readonly loginWindowMs = 15 * 60 * 1000;
  private readonly dummyPasswordHash: Promise<string>;

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
  ) {
    const saltRounds = Number(this.configService.get<number>('BCRYPT_SALT_ROUNDS', 12));
    if (!Number.isInteger(saltRounds) || saltRounds < 10 || saltRounds > 15) {
      throw new Error('BCRYPT_SALT_ROUNDS must be an integer between 10 and 15.');
    }
    this.dummyPasswordHash = bcrypt.hash(randomBytes(32).toString('hex'), saltRounds);
  }

  async login(dto: LoginDto, request: Request) {
    const ip = request.ip || 'unknown';
    await this.checkLoginLimit(ip, dto.email);

    const user = await this.usersService.findByEmail(dto.email);
    const activeUser = user && !user.deletedAt && user.isActive && user.localLoginEnabled && !user.employee?.deletedAt ? user : null;
    const passwordMatches = await bcrypt.compare(dto.password, activeUser?.passwordHash ?? (await this.dummyPasswordHash));
    if (!activeUser || !passwordMatches) {
      await this.recordFailedLogin(ip, dto.email);
      throw new UnauthorizedException('Invalid email or password');
    }

    await this.prisma.authThrottle.deleteMany({
      where: { key: { in: [this.accountIpLoginKey(ip, dto.email), this.accountLoginKey(dto.email)] } },
    });
    return this.issueSession(activeUser, request, 'local');
  }

  async issueSession(user: SessionUser, request: Request, provider: 'local' | 'microsoft'): Promise<IssuedSession> {
    const authorizationUser = await this.authorization.loadUserContext(user.id);
    const csrfToken = this.csrfToken();
    const sid = randomUUID();
    const accessToken = this.signToken({
      sub: user.id,
      email: authorizationUser.email,
      sid,
      authorizationVersion: authorizationUser.authorizationVersion,
      csrfToken,
    });
    const decoded = this.jwtService.decode(accessToken) as { exp?: number } | null;
    if (!decoded?.exp) throw new Error('JWT expiry was not generated');
    const expiresAt = new Date(decoded.exp * 1000);
    const ipHash = this.ipHash(request.ip);
    const context = this.authorization.toRequestUser(authorizationUser, {
      id: sid,
      csrfToken,
      provider,
      reauthenticatedAt: new Date(),
      ipHash,
    });
    context.requestId = this.requestId(request);
    context.userAgent = this.userAgent(request);
    context.route = request.path.slice(0, 500);
    context.httpMethod = request.method.slice(0, 16);
    await this.prisma.$transaction(async (tx) => {
      await tx.authSession.create({
        data: {
          id: sid,
          userId: user.id,
          tokenHash: this.tokenHash(accessToken),
          provider,
          authorizationVersion: authorizationUser.authorizationVersion,
          ipHash,
          userAgent: this.userAgent(request),
          expiresAt,
        },
      });
      await this.audit.record(tx, context, {
        action: AuditAction.LOGIN,
        resourceType: 'AuthSession',
        resourceId: sid,
        summary: `${provider} login`,
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return { user: context, accessToken, csrfToken };
  }

  browserSession(session: IssuedSession) {
    return {
      user: {
        id: session.user.id,
        email: session.user.email,
        employeeId: session.user.employeeId ?? null,
        displayName: session.user.displayName,
        roles: session.user.roles,
        permissions: session.user.permissions,
        departmentScopeIds: session.user.departmentScopeIds,
        sessionId: session.user.sessionId,
        authProvider: session.user.authProvider,
        authorizationVersion: session.user.authorizationVersion,
      },
      csrfToken: session.csrfToken,
    };
  }

  setSessionCookie(response: Response, accessToken: string) {
    const production = this.configService.get<string>('NODE_ENV') === 'production';
    const decoded = this.jwtService.decode(accessToken) as { exp?: number; iat?: number } | null;
    const maxAge = decoded?.exp && decoded.iat ? Math.max(0, (decoded.exp - decoded.iat) * 1000) : 8 * 60 * 60 * 1000;
    response.cookie(production ? productionSessionCookie : developmentSessionCookie, accessToken, {
      httpOnly: true,
      secure: production,
      sameSite: 'strict',
      path: '/',
      maxAge,
    });
  }

  clearSessionCookie(response: Response) {
    for (const name of [productionSessionCookie, developmentSessionCookie]) {
      response.clearCookie(name, { httpOnly: true, secure: name === productionSessionCookie, sameSite: 'strict', path: '/' });
    }
  }

  async listOwnSessions(user: RequestUser) {
    return this.prisma.authSession.findMany({
      where: { userId: user.id },
      select: { id: true, provider: true, userAgent: true, createdAt: true, lastSeenAt: true, expiresAt: true, revokedAt: true },
      orderBy: { lastSeenAt: 'desc' },
    }).then((sessions) => sessions.map((session) => ({ ...session, current: session.id === user.sessionId })));
  }

  async revokeOwnSession(user: RequestUser, sessionId: string) {
    const session = await this.prisma.authSession.findFirst({ where: { id: sessionId, userId: user.id }, select: { id: true, revokedAt: true } });
    if (!session) throw new NotFoundException('Session not found');
    if (!session.revokedAt) {
      await this.prisma.$transaction(async (tx) => {
        await tx.authSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
        await this.audit.record(tx, user, {
          action: AuditAction.LOGOUT,
          resourceType: 'AuthSession',
          resourceId: session.id,
          summary: 'Session revoked',
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }
    return { revoked: true, current: session.id === user.sessionId };
  }

  async logout(user: RequestUser) {
    await this.revokeOwnSession(user, user.sessionId);
    return { loggedOut: true };
  }

  async logoutAll(user: RequestUser) {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.authSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } });
      await this.audit.record(tx, user, {
        action: AuditAction.LOGOUT,
        resourceType: 'AuthSession',
        resourceId: user.id,
        summary: 'All sessions revoked',
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return { loggedOut: true };
  }

  async stepUpLocal(dto: StepUpDto, user: RequestUser) {
    const throttleKey = this.stepUpKey(user);
    const throttle = await this.prisma.authThrottle.findUnique({ where: { key: throttleKey } });
    if (throttle && throttle.resetAt > new Date() && throttle.count >= 5) {
      throw new HttpException('Too many authentication attempts. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const account = await this.usersService.findById(user.id);
    const passwordMatches = await bcrypt.compare(dto.password, account?.passwordHash ?? (await this.dummyPasswordHash));
    if (!account || !account.isActive || account.deletedAt || !account.localLoginEnabled || !account.passwordHash || !passwordMatches) {
      await this.incrementLoginAttempt(throttleKey);
      await this.audit.record(this.prisma, user, {
        action: AuditAction.LOGIN,
        outcome: AuditOutcome.FAILED,
        resourceType: 'AuthSession',
        resourceId: user.sessionId,
        summary: 'Local step-up authentication failed',
      });
      throw new UnauthorizedException('Authentication could not be verified');
    }
    const reauthenticatedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.authSession.updateMany({ where: { id: user.sessionId, userId: user.id, revokedAt: null, expiresAt: { gt: reauthenticatedAt } }, data: { reauthenticatedAt } });
      if (updated.count !== 1) throw new UnauthorizedException('Session is invalid or expired');
      await this.audit.record(tx, { ...user, reauthenticatedAt }, { action: AuditAction.LOGIN, resourceType: 'AuthSession', resourceId: user.sessionId, summary: 'Local step-up authentication completed' });
      await tx.authThrottle.deleteMany({ where: { key: throttleKey } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return { reauthenticatedAt };
  }

  async replaceMicrosoftSession(previousSessionId: string, userId: string) {
    await this.prisma.authSession.updateMany({ where: { id: previousSessionId, userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async recordProviderLoginFailure(provider: string, request: Request) {
    await this.audit.record(this.prisma, null, {
      action: AuditAction.LOGIN,
      outcome: AuditOutcome.FAILED,
      resourceType: 'AuthenticationAttempt',
      resourceId: this.auditIdentityHash(`${provider}\0${request.ip || 'unknown'}`),
      summary: `${provider} login failed`,
      metadata: { provider, ipHash: this.ipHash(request.ip), userAgent: this.userAgent(request) },
    });
  }

  async consumeMicrosoftLoginStart(ip = 'unknown') {
    const key = this.throttleKey('microsoft-start-ip', ip);
    const now = new Date();
    const record = await this.prisma.authThrottle.findUnique({ where: { key } });
    if (record && record.resetAt > now && record.count >= 20) {
      throw new HttpException('Too many sign-in attempts. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
    await this.incrementLoginAttempt(key);
  }

  tokenHash(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private csrfToken() {
    return randomBytes(32).toString('base64url');
  }

  private async checkLoginLimit(ip: string, email: string) {
    const now = new Date();
    const [accountIpRecord, accountRecord, ipRecord] = await Promise.all([
      this.prisma.authThrottle.findUnique({ where: { key: this.accountIpLoginKey(ip, email) } }),
      this.prisma.authThrottle.findUnique({ where: { key: this.accountLoginKey(email) } }),
      this.prisma.authThrottle.findUnique({ where: { key: this.ipLoginKey(ip) } }),
    ]);
    if (
      (accountIpRecord && accountIpRecord.resetAt > now && accountIpRecord.count >= 10)
      || (accountRecord && accountRecord.resetAt > now && accountRecord.count >= 20)
      || (ipRecord && ipRecord.resetAt > now && ipRecord.count >= 50)
    ) throw new HttpException('Too many login attempts. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
  }

  private async recordFailedLogin(ip: string, email: string) {
    await Promise.all([
      this.incrementLoginAttempt(this.accountIpLoginKey(ip, email)),
      this.incrementLoginAttempt(this.accountLoginKey(email)),
      this.incrementLoginAttempt(this.ipLoginKey(ip)),
    ]);
    await this.prisma.authThrottle.deleteMany({ where: { resetAt: { lte: new Date() } } });
    await this.audit.record(this.prisma, null, {
      action: AuditAction.LOGIN,
      outcome: AuditOutcome.FAILED,
      resourceType: 'AuthenticationAttempt',
      resourceId: this.auditIdentityHash(email.toLowerCase()),
      summary: 'Local login failed',
      metadata: { provider: 'local', accountHash: this.auditIdentityHash(email.toLowerCase()), ipHash: this.ipHash(ip) },
    });
  }

  private async incrementLoginAttempt(key: string) {
    const now = new Date();
    const resetAt = new Date(now.getTime() + this.loginWindowMs);
    await this.prisma.$executeRaw`
      INSERT INTO "AuthThrottle" ("key", "count", "resetAt", "updatedAt")
      VALUES (${key}, 1, ${resetAt}, NOW())
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "AuthThrottle"."resetAt" <= ${now} THEN 1 ELSE "AuthThrottle"."count" + 1 END,
        "resetAt" = CASE WHEN "AuthThrottle"."resetAt" <= ${now} THEN ${resetAt} ELSE "AuthThrottle"."resetAt" END,
        "updatedAt" = NOW()
    `;
  }

  private accountIpLoginKey(ip: string, email: string) {
    return this.throttleKey('account-ip', `${email.toLowerCase()}\0${ip}`);
  }

  private ipLoginKey(ip: string) {
    return this.throttleKey('ip', ip);
  }

  private accountLoginKey(email: string) {
    return this.throttleKey('account', email.toLowerCase());
  }

  private stepUpKey(user: RequestUser) {
    return this.throttleKey('step-up-account-session', `${user.id}\0${user.sessionId}`);
  }

  private throttleKey(kind: string, value: string) {
    return `${kind}:${createHmac('sha256', this.configService.getOrThrow<string>('JWT_SECRET')).update(value).digest('hex')}`;
  }

  private auditIdentityHash(value: string) {
    return createHmac('sha256', this.configService.getOrThrow<string>('JWT_SECRET')).update(`audit\0${value}`).digest('hex');
  }

  private ipHash(ip?: string) {
    return ip ? createHmac('sha256', this.configService.getOrThrow<string>('JWT_SECRET')).update(ip).digest('hex') : null;
  }

  private userAgent(request: Request) {
    const value = request.get('user-agent')?.trim();
    return value ? value.slice(0, 512) : null;
  }

  private requestId(request: Request) {
    const value = (request as Request & { requestId?: unknown }).requestId;
    return typeof value === 'string' ? value : undefined;
  }

  private signToken(payload: JwtPayload): string {
    return this.jwtService.sign(payload, {
      secret: this.configService.getOrThrow<string>('JWT_SECRET'),
      algorithm: 'HS256',
      expiresIn: this.configService.get<string>('JWT_EXPIRES_IN', '1d') as JwtSignOptions['expiresIn'],
    });
  }
}
