import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
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

  @Roles(Role.SUPER_ADMIN, Role.HR_ADMIN)
  @Post()
  create(@Body() dto: CreateEmploymentContractDto) {
    return this.contractsService.create(dto);
  }

  @Get()
  list(@Query() query: QueryEmploymentContractsDto, @CurrentUser() user: RequestUser) {
    return this.contractsService.list(query, user);
  }

  @Get(':id')
  findById(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.contractsService.findById(id, user);
  }

  @Roles(Role.SUPER_ADMIN, Role.HR_ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateEmploymentContractDto) {
    return this.contractsService.update(id, dto);
  }

  @Roles(Role.SUPER_ADMIN, Role.HR_ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.contractsService.remove(id);
  }
}
