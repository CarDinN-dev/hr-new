import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AnnouncementAttachmentKind } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf } from 'class-validator';

export class UploadAnnouncementAttachmentDto {
  @ApiProperty()
  @IsUUID()
  uploadKey: string;

  @ApiProperty({ enum: AnnouncementAttachmentKind })
  @IsEnum(AnnouncementAttachmentKind)
  kind: AnnouncementAttachmentKind;

  @ApiPropertyOptional()
  @ValidateIf((dto: UploadAnnouncementAttachmentDto) => dto.kind === AnnouncementAttachmentKind.INLINE_IMAGE)
  @IsString()
  @MaxLength(300)
  altText?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(99)
  sortOrder?: number;
}
