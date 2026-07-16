import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const authenticationEmployeeSelect = {
  id: true,
  firstName: true,
  lastName: true,
  deletedAt: true,
} satisfies Prisma.EmployeeSelect;

const authenticationUserInclude = {
  employee: { select: authenticationEmployeeSelect },
} satisfies Prisma.UserInclude;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: authenticationUserInclude,
    });
  }

  async findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      include: authenticationUserInclude,
    });
  }

  async findOrBindMicrosoftUser(objectId: string, email: string) {
    const boundUser = await this.prisma.user.findUnique({
      where: { microsoftObjectId: objectId },
      include: authenticationUserInclude,
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

}
