import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DocumentVisibility } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsOptional, IsString, IsUrl, IsUUID } from 'class-validator';

export class CreateDocumentDto {
  @ApiProperty()
  @IsUUID()
  employeeId: string;

  @ApiProperty({ example: 'Passport' })
  @IsString()
  documentType: string;

  @ApiProperty({ example: 'passport.pdf' })
  @IsString()
  fileName: string;

  @ApiProperty({ example: 'https://files.example.com/documents/passport.pdf' })
  @IsUrl({ require_tld: false })
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
