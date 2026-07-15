import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';

export type SafeUser = Omit<Prisma.UserGetPayload<{ include: { employee: true } }>, 'passwordHash'>;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { employee: true },
    });
  }

  async findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      include: { employee: true },
    });
  }

  async findOrBindMicrosoftUser(objectId: string, email: string) {
    const boundUser = await this.prisma.user.findUnique({
      where: { microsoftObjectId: objectId },
      include: { employee: true },
    });
    if (boundUser) return boundUser;

    const emailUser = await this.findByEmail(email);
    if (!emailUser || (emailUser.microsoftObjectId && emailUser.microsoftObjectId !== objectId)) return null;

    await this.prisma.user.updateMany({
      where: { id: emailUser.id, microsoftObjectId: null },
      data: { microsoftObjectId: objectId },
    });
    const user = await this.findById(emailUser.id);
    return user?.microsoftObjectId === objectId ? user : null;
  }

  async createUser(email: string, password: string, role: Role = Role.EMPLOYEE) {
    if (
      password.length < 12
      || Buffer.byteLength(password, 'utf8') > 72
      || !/[a-z]/.test(password)
      || !/[A-Z]/.test(password)
      || !/\d/.test(password)
    ) {
      throw new BadRequestException('Password must be 12-72 bytes and include uppercase, lowercase, and number characters');
    }
    const existing = await this.findByEmail(email);
    if (existing) {
      throw new ConflictException('Email is already registered');
    }

    const saltRounds = Number(this.configService.get<number>('BCRYPT_SALT_ROUNDS', 12));
    if (!Number.isInteger(saltRounds) || saltRounds < 10 || saltRounds > 15) {
      throw new Error('BCRYPT_SALT_ROUNDS must be an integer between 10 and 15.');
    }
    const passwordHash = await bcrypt.hash(password, saltRounds);
    const user = await this.prisma.user.create({
      data: {
        email: email.toLowerCase(),
        passwordHash,
        role,
      },
      include: { employee: true },
    });

    return this.toSafeUser(user);
  }

  revokeSessions(id: string) {
    return this.prisma.user.update({
      where: { id },
      data: { sessionVersion: { increment: 1 } },
      select: { sessionVersion: true },
    });
  }

  toSafeUser<T extends { passwordHash?: string }>(user: T): Omit<T, 'passwordHash'> {
    const safeUser = { ...user };
    delete safeUser.passwordHash;
    return safeUser;
  }
}
