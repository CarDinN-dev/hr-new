import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DocumentVisibility } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class UploadDocumentDto {
  @ApiProperty() @IsUUID() employeeId: string;
  @ApiProperty({ example: 'Passport' }) @IsString() @MaxLength(100) documentType: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() uploadedById?: string;
  @ApiPropertyOptional({ example: '2030-01-01' }) @IsOptional() @Type(() => Date) @IsDate() expiryDate?: Date;
  @ApiPropertyOptional({ enum: DocumentVisibility }) @IsOptional() @IsEnum(DocumentVisibility) visibility?: DocumentVisibility;
}
