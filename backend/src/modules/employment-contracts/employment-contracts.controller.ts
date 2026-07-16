import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AnyPermission, Permissions } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/types/request-user.type';
import { CreateEmploymentContractDto } from './dto/create-employment-contract.dto';
import { QueryEmploymentContractsDto } from './dto/query-employment-contracts.dto';
import { UpdateEmploymentContractDto } from './dto/update-employment-contract.dto';
import { EmploymentContractsService } from './employment-contracts.service';

@ApiTags('Employment Contracts')
@ApiBearerAuth()
@Controller('employment-contracts')
export class EmploymentContractsController {
  constructor(private readonly contractsService: EmploymentContractsService) {}

  @Permissions('contract.hr.manage')
  @Post()
  create(@Body() dto: CreateEmploymentContractDto, @CurrentUser() user: RequestUser) {
    return this.contractsService.create(dto, user);
  }

  @AnyPermission('contract.self.read', 'contract.team.read', 'contract.management.read', 'contract.hr.manage', 'contract.read_all')
  @Get()
  list(@Query() query: QueryEmploymentContractsDto, @CurrentUser() user: RequestUser) {
    return this.contractsService.list(query, user);
  }

  @AnyPermission('contract.self.read', 'contract.team.read', 'contract.management.read', 'contract.hr.manage', 'contract.read_all')
  @Get(':id')
  findById(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.contractsService.findById(id, user);
  }

  @Permissions('contract.hr.manage')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateEmploymentContractDto, @CurrentUser() user: RequestUser) {
    return this.contractsService.update(id, dto, user);
  }

  @Permissions('contract.hr.manage')
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.contractsService.remove(id, user);
  }
}
