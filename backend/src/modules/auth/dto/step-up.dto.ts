import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class StepUpDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(72) password: string;
}
