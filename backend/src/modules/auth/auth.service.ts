import { HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtPayload } from './types/jwt-payload.type';

@Injectable()
export class AuthService {
  private readonly loginAttempts = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

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
        employeeId: user.employee?.id ?? null,
      }),
      csrfToken,
    };
  }

  async login(dto: LoginDto, ip = 'unknown') {
    this.checkLoginLimit(ip, dto.email);

    const user = await this.usersService.findByEmail(dto.email);
    if (!user || user.deletedAt || !user.isActive) {
      this.recordFailedLogin(ip, dto.email);
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatches) {
      this.recordFailedLogin(ip, dto.email);
      throw new UnauthorizedException('Invalid email or password');
    }

    this.loginAttempts.delete(this.loginKey(ip, dto.email));
    const safeUser = this.usersService.toSafeUser(user);
    const csrfToken = this.csrfToken();
    return {
      user: safeUser,
      accessToken: this.signToken({
        sub: user.id,
        email: user.email,
        role: user.role,
        permissions: user.permissions,
        csrfToken,
        employeeId: user.employee?.id ?? null,
      }),
      csrfToken,
    };
  }

  private csrfToken() {
    return randomBytes(32).toString('base64url');
  }

  private checkLoginLimit(ip: string, email: string) {
    const record = this.loginAttempts.get(this.loginKey(ip, email));
    if (record && record.resetAt > Date.now() && record.count >= 10) {
      throw new HttpException('Too many login attempts. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private recordFailedLogin(ip: string, email: string) {
    const key = this.loginKey(ip, email);
    const now = Date.now();
    const current = this.loginAttempts.get(key);
    const record = current && current.resetAt > now ? current : { count: 0, resetAt: now + 15 * 60 * 1000 };
    record.count += 1;
    this.loginAttempts.set(key, record);
  }

  private loginKey(ip: string, email: string) {
    return `${ip}:${email.toLowerCase()}`;
  }

  private signToken(payload: JwtPayload): string {
    return this.jwtService.sign(payload, {
      secret: this.configService.getOrThrow<string>('JWT_SECRET'),
      expiresIn: this.configService.get<string>('JWT_EXPIRES_IN', '1d') as JwtSignOptions['expiresIn'],
    });
  }
}
