import { HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHmac, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtPayload } from './types/jwt-payload.type';

@Injectable()
export class AuthService {
  private readonly loginWindowMs = 15 * 60 * 1000;
  private readonly dummyPasswordHash: Promise<string>;

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const saltRounds = Number(this.configService.get<number>('BCRYPT_SALT_ROUNDS', 12));
    if (!Number.isInteger(saltRounds) || saltRounds < 10 || saltRounds > 15) {
      throw new Error('BCRYPT_SALT_ROUNDS must be an integer between 10 and 15.');
    }
    this.dummyPasswordHash = bcrypt.hash(randomBytes(32).toString('hex'), saltRounds);
  }

  async register(dto: RegisterDto) {
    const user = await this.usersService.createUser(dto.email, dto.password, Role.EMPLOYEE);
    const csrfToken = this.csrfToken();
    return {
      user,
      accessToken: this.signToken({
        sub: user.id,
        email: user.email,
        role: user.role,
        permissions: user.permissions,
        csrfToken,
        sessionVersion: user.sessionVersion,
        employeeId: user.employee?.id ?? null,
      }),
      csrfToken,
    };
  }

  async login(dto: LoginDto, ip = 'unknown') {
    await this.checkLoginLimit(ip, dto.email);

    const user = await this.usersService.findByEmail(dto.email);
    const activeUser = user && !user.deletedAt && user.isActive && !user.employee?.deletedAt ? user : null;
    const passwordMatches = await bcrypt.compare(
      dto.password,
      activeUser?.passwordHash ?? (await this.dummyPasswordHash),
    );
    if (!activeUser || !passwordMatches) {
      await this.recordFailedLogin(ip, dto.email);
      throw new UnauthorizedException('Invalid email or password');
    }

    await this.prisma.authThrottle.deleteMany({
      where: { key: { in: [this.accountIpLoginKey(ip, dto.email), this.accountLoginKey(dto.email)] } },
    });
    const safeUser = this.usersService.toSafeUser(activeUser);
    const csrfToken = this.csrfToken();
    return {
      user: safeUser,
      accessToken: this.signToken({
        sub: activeUser.id,
        email: activeUser.email,
        role: activeUser.role,
        permissions: activeUser.permissions,
        csrfToken,
        sessionVersion: activeUser.sessionVersion,
        employeeId: activeUser.employee?.id ?? null,
      }),
      csrfToken,
    };
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
      (accountIpRecord && accountIpRecord.resetAt > now && accountIpRecord.count >= 10) ||
      (accountRecord && accountRecord.resetAt > now && accountRecord.count >= 20) ||
      (ipRecord && ipRecord.resetAt > now && ipRecord.count >= 50)
    ) {
      throw new HttpException('Too many login attempts. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private async recordFailedLogin(ip: string, email: string) {
    await Promise.all([
      this.incrementLoginAttempt(this.accountIpLoginKey(ip, email)),
      this.incrementLoginAttempt(this.accountLoginKey(email)),
      this.incrementLoginAttempt(this.ipLoginKey(ip)),
    ]);
    await this.prisma.authThrottle.deleteMany({ where: { resetAt: { lte: new Date() } } });
  }

  private async incrementLoginAttempt(key: string) {
    const now = new Date();
    const resetAt = new Date(now.getTime() + this.loginWindowMs);
    await this.prisma.$executeRaw`
      INSERT INTO "AuthThrottle" ("key", "count", "resetAt", "updatedAt")
      VALUES (${key}, 1, ${resetAt}, NOW())
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE
          WHEN "AuthThrottle"."resetAt" <= ${now} THEN 1
          ELSE "AuthThrottle"."count" + 1
        END,
        "resetAt" = CASE
          WHEN "AuthThrottle"."resetAt" <= ${now} THEN ${resetAt}
          ELSE "AuthThrottle"."resetAt"
        END,
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

  private throttleKey(kind: string, value: string) {
    const secret = this.configService.getOrThrow<string>('JWT_SECRET');
    return `${kind}:${createHmac('sha256', secret).update(value).digest('hex')}`;
  }

  async logout(userId: string) {
    await this.usersService.revokeSessions(userId);
    return { loggedOut: true };
  }

  private signToken(payload: JwtPayload): string {
    return this.jwtService.sign(payload, {
      secret: this.configService.getOrThrow<string>('JWT_SECRET'),
      algorithm: 'HS256',
      expiresIn: this.configService.get<string>('JWT_EXPIRES_IN', '1d') as JwtSignOptions['expiresIn'],
    });
  }
}
