import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class PayrollTransitionDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion: number;
  @ApiPropertyOptional({ maxLength: 1000 }) @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

export class PayrollReasonTransitionDto extends PayrollTransitionDto {
  @ApiProperty({ minLength: 3, maxLength: 1000 }) @IsString() @MinLength(3) @MaxLength(1000) declare reason: string;
}
