import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { AuditService } from './audit.service';

@ApiTags('Audit history')
@ApiBearerAuth()
@Controller('audit-events')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Permissions('audit.read')
  @Get()
  list(@Query() query: PaginationQueryDto) {
    return this.audit.list(query);
  }
}
