import { PartialType } from '@nestjs/swagger';
import { CreateEmploymentContractDto } from './create-employment-contract.dto';

export class UpdateEmploymentContractDto extends PartialType(CreateEmploymentContractDto) {}
