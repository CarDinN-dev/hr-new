import { BadRequestException } from '@nestjs/common';
import { extname } from 'node:path';

const documentMimeTypes = new Set([
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const extensionsByMimeType = new Map<string, Set<string>>([
  ['application/pdf', new Set(['.pdf'])],
  ['image/jpeg', new Set(['.jpg', '.jpeg'])],
  ['image/png', new Set(['.png'])],
  ['image/webp', new Set(['.webp'])],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', new Set(['.docx'])],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', new Set(['.xlsx'])],
]);

const pngEnd = Buffer.from('0000000049454e44ae426082', 'hex');

function ooxmlEntries(buffer: Buffer) {
  if (buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50) return new Set<string>();
  const endSignature = Buffer.from('504b0506', 'hex');
  const end = buffer.lastIndexOf(endSignature);
  if (end < 0 || end + 22 > buffer.length) return new Set<string>();
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  const names = new Set<string>();
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > end || buffer.readUInt32LE(offset) !== 0x02014b50) return new Set<string>();
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > end) return new Set<string>();
    names.add(buffer.toString('utf8', offset + 46, offset + 46 + nameLength));
    offset = next;
  }
  return offset === end ? names : new Set<string>();
}

function contentMatchesMimeType(contentType: string, buffer: Buffer) {
  if (contentType === 'application/pdf') return buffer.length >= 14 && buffer.subarray(0, 5).equals(Buffer.from('%PDF-')) && buffer.subarray(-1024).includes(Buffer.from('%%EOF'));
  if (contentType === 'image/jpeg') return buffer.length >= 4 && buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) && buffer.subarray(-2).equals(Buffer.from([0xff, 0xd9]));
  if (contentType === 'image/png') return buffer.length >= 20 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) && buffer.subarray(-12).equals(pngEnd);
  if (contentType === 'image/webp') return buffer.length >= 20 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.readUInt32LE(4) === buffer.length - 8 && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  const entries = ooxmlEntries(buffer);
  if (!entries.has('[Content_Types].xml')) return false;
  if (contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return entries.has('word/document.xml') && !entries.has('xl/workbook.xml');
  if (contentType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return entries.has('xl/workbook.xml') && !entries.has('word/document.xml');
  return false;
}

export const isAllowedDocumentMimeType = (contentType: string) => documentMimeTypes.has(contentType);

export function assertValidDocumentUpload(file: Express.Multer.File) {
  if (!isAllowedDocumentMimeType(file.mimetype)) throw new BadRequestException('Unsupported document type');
  if (!extensionsByMimeType.get(file.mimetype)?.has(extname(file.originalname).toLowerCase())) {
    throw new BadRequestException('The file extension does not match its declared type');
  }
  if (!contentMatchesMimeType(file.mimetype, file.buffer)) {
    throw new BadRequestException('The file content does not match its declared type');
  }
}

const uploadFilter = (allowedTypes: ReadonlySet<string>, message: string) =>
  (_request: unknown, file: Express.Multer.File, callback: (error: Error | null, acceptFile: boolean) => void) => {
    const accepted = allowedTypes.has(file.mimetype) && Boolean(extensionsByMimeType.get(file.mimetype)?.has(extname(file.originalname).toLowerCase()));
    callback(accepted ? null : new BadRequestException(message), accepted);
  };

export const documentUploadOptions = {
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: uploadFilter(documentMimeTypes, 'Unsupported document type or extension'),
};

export const announcementAttachmentUploadOptions = {
  limits: documentUploadOptions.limits,
  fileFilter: documentUploadOptions.fileFilter,
};

const leaveAttachmentMimeTypes = new Set([
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
]);

export const leaveAttachmentUploadOptions = {
  limits: documentUploadOptions.limits,
  fileFilter: uploadFilter(leaveAttachmentMimeTypes, 'Leave attachments must be PDF or image files with a matching extension'),
};
