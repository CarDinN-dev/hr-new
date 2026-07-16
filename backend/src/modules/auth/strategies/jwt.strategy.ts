import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuthorizationService } from '../../authorization/authorization.service';
import { sessionTokenFromRequest } from '../auth.service';
import { JwtPayload } from '../types/jwt-payload.type';
import { createHash, timingSafeEqual } from 'crypto';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([sessionTokenFromRequest, ExtractJwt.fromAuthHeaderAsBearerToken()]),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
      algorithms: ['HS256'],
      passReqToCallback: true,
    });
  }

  async validate(request: Request, payload: JwtPayload) {
    if (!payload.sid || !Number.isInteger(payload.authorizationVersion)) {
      throw new UnauthorizedException('Legacy session must sign in again');
    }
    const token = sessionTokenFromRequest(request) || ExtractJwt.fromAuthHeaderAsBearerToken()(request);
    if (!token) throw new UnauthorizedException('Session token is missing');
    const session = await this.prisma.authSession.findUnique({
      where: { id: payload.sid },
      select: { id: true, userId: true, tokenHash: true, provider: true, authorizationVersion: true, expiresAt: true, revokedAt: true, lastSeenAt: true, reauthenticatedAt: true, ipHash: true },
    });
    const now = new Date();
    const actualHash = createHash('sha256').update(token).digest();
    const expectedHash = session?.tokenHash ? Buffer.from(session.tokenHash, 'hex') : Buffer.alloc(actualHash.length);
    const validHash = expectedHash.length === actualHash.length && timingSafeEqual(actualHash, expectedHash);
    if (
      !session
      || !validHash
      || session.userId !== payload.sub
      || session.revokedAt
      || session.expiresAt <= now
      || session.authorizationVersion !== payload.authorizationVersion
    ) throw new UnauthorizedException('Session is invalid or expired');

    const user = await this.authorization.loadUserContext(payload.sub);
    if (user.authorizationVersion !== payload.authorizationVersion) throw new UnauthorizedException('Authorization changed; sign in again');
    if (now.getTime() - session.lastSeenAt.getTime() >= 5 * 60 * 1000) {
      await this.prisma.authSession.update({ where: { id: session.id }, data: { lastSeenAt: now } });
    }
    return this.authorization.toRequestUser(user, {
      id: session.id,
      csrfToken: payload.csrfToken,
      provider: session.provider,
      reauthenticatedAt: session.reauthenticatedAt,
      ipHash: session.ipHash,
    });
  }
}
