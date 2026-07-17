import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DocumentVisibility } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsOptional, IsString, IsUrl, IsUUID, MaxLength } from 'class-validator';

export class CreateDocumentDto {
  @ApiPropertyOptional({ description: 'Omit for an organization-level HR document' })
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiProperty({ example: 'Passport' })
  @IsString()
  @MaxLength(100)
  documentType: string;

  @ApiProperty({ example: 'passport.pdf' })
  @IsString()
  @MaxLength(255)
  fileName: string;

  @ApiProperty({ example: 'https://files.example.com/documents/passport.pdf' })
  @IsUrl({ require_tld: false, protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2_048)
  fileUrl: string;

  @ApiPropertyOptional({ description: 'Defaults to the current employee profile' })
  @IsOptional()
  @IsUUID()
  uploadedById?: string;

  @ApiPropertyOptional({ example: '2030-01-01' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiryDate?: Date;

  @ApiPropertyOptional({ enum: DocumentVisibility })
  @IsOptional()
  @IsEnum(DocumentVisibility)
  visibility?: DocumentVisibility;
}
