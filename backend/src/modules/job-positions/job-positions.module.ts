import { Module } from '@nestjs/common';
import { JobPositionsController } from './job-positions.controller';
import { JobPositionsService } from './job-positions.service';

@Module({
  controllers: [JobPositionsController],
  providers: [JobPositionsService],
})
export class JobPositionsModule {}
