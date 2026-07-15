import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/request-user.type';
import { CreateDocumentDto } from './dto/create-document.dto';
import { QueryDocumentsDto } from './dto/query-documents.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { DocumentsService } from './documents.service';
import { UploadDocumentDto } from './dto/upload-document.dto';

@ApiTags('Documents')
@ApiBearerAuth()
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post()
  create(@Body() dto: CreateDocumentDto, @CurrentUser() user: RequestUser) {
    return this.documentsService.create(dto, user);
  }

  @ApiConsumes('multipart/form-data')
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    fileFilter: (_request, file, callback) => {
      const allowed = new Set([
        'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ]);
      callback(allowed.has(file.mimetype) ? null : new Error('Unsupported document type'), allowed.has(file.mimetype));
    },
  }))
  upload(@Body() dto: UploadDocumentDto, @UploadedFile() file: Express.Multer.File, @CurrentUser() user: RequestUser) {
    return this.documentsService.upload(dto, file, user);
  }

  @Get(':id/content')
  async content(@Param('id') id: string, @CurrentUser() user: RequestUser, @Res({ passthrough: true }) response: Response) {
    const result = await this.documentsService.content(id, user);
    response.setHeader('Content-Type', result.contentType);
    response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`);
    response.setHeader('Cache-Control', 'private, no-store, max-age=0');
    return result.buffer;
  }

  @Get()
  list(@Query() query: QueryDocumentsDto, @CurrentUser() user: RequestUser) {
    return this.documentsService.list(query, user);
  }

  @Get(':id')
  findById(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.documentsService.findById(id, user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateDocumentDto, @CurrentUser() user: RequestUser) {
    return this.documentsService.update(id, dto, user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.documentsService.remove(id, user);
  }
}
