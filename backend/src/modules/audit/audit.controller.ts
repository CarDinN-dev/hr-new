import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { AuditService } from './audit.service';

@ApiTags('Audit history')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN, Role.HR_ADMIN)
@Controller('audit-events')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(@Query() query: PaginationQueryDto) {
    return this.audit.list(query);
  }
}
