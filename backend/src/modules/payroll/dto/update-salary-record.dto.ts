import { PartialType } from '@nestjs/swagger';
import { CreateSalaryRecordDto } from './create-salary-record.dto';

export class UpdateSalaryRecordDto extends PartialType(CreateSalaryRecordDto) {}
