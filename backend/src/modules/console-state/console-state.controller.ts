import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequestUser } from '../../common/types/request-user.type';
import { SaveConsoleStateDto } from './console-state.dto';
import { ConsoleStateService } from './console-state.service';

@ApiTags('HR Console State')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN, Role.HR_ADMIN)
@Controller('console-state')
export class ConsoleStateController {
  constructor(private readonly consoleStateService: ConsoleStateService) {}

  @Get()
  get() {
    return this.consoleStateService.get();
  }

  @Put()
  save(@Body() dto: SaveConsoleStateDto, @CurrentUser() user: RequestUser) {
    return this.consoleStateService.save(dto, user);
  }

  @Get('backups/status')
  backupStatus() {
    return this.consoleStateService.backupStatus();
  }

  @Post('backups')
  backup(@CurrentUser() user: RequestUser) {
    return this.consoleStateService.createBackup('MANUAL', user.id);
  }

  @Post('backups/rollback-latest')
  rollbackLatest(@CurrentUser() user: RequestUser) {
    return this.consoleStateService.rollbackLatest(user.id);
  }
}
