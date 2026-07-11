import { Module } from '@nestjs/common';
import { ConsoleStateController } from './console-state.controller';
import { ConsoleStateService } from './console-state.service';

@Module({
  controllers: [ConsoleStateController],
  providers: [ConsoleStateService],
})
export class ConsoleStateModule {}
