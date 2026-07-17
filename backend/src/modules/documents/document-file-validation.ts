import { BadRequestException } from '@nestjs/common';

const signatures: Record<string, (buffer: Buffer) => boolean> = {
  'application/pdf': (buffer) => buffer.subarray(0, 5).equals(Buffer.from('%PDF-')),
  'image/jpeg': (buffer) => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
  'image/png': (buffer) => buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (buffer) => buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': (buffer) => officeArchive(buffer, 'word/'),
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': (buffer) => officeArchive(buffer, 'xl/'),
};

export function assertDocumentFile(file: Express.Multer.File) {
  const matches = signatures[file.mimetype];
  if (!matches || !matches(file.buffer)) throw new BadRequestException('Document content does not match its declared file type');
}

function officeArchive(buffer: Buffer, directory: string) {
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b || ![0x03, 0x05, 0x07].includes(buffer[2])) return false;
  return buffer.includes(Buffer.from('[Content_Types].xml')) && buffer.includes(Buffer.from(directory));
}
