import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Storage } from '@google-cloud/storage';
import { createHash, randomUUID } from 'node:crypto';

@Injectable()
export class DocumentStorageService {
  private readonly storage = new Storage();
  private readonly bucketName: string;

  constructor(config: ConfigService) {
    this.bucketName = config.get<string>('GCS_DOCUMENTS_BUCKET', '').trim();
  }

  async upload(employeeId: string, file: Express.Multer.File) {
    const bucket = this.bucket();
    const safeName = file.originalname.replace(/[^A-Za-z0-9._-]+/g, '-').slice(-180) || 'document';
    const objectName = `employees/${employeeId}/${new Date().getUTCFullYear()}/${randomUUID()}-${safeName}`;
    const object = bucket.file(objectName);
    await object.save(file.buffer, {
      resumable: false,
      validation: 'crc32c',
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: {
        contentType: file.mimetype,
        cacheControl: 'private, no-store, max-age=0',
        metadata: { employeeId, originalName: file.originalname },
      },
    });
    const [metadata] = await object.getMetadata();
    return {
      objectName,
      generation: metadata.generation == null ? undefined : String(metadata.generation),
      sha256: createHash('sha256').update(file.buffer).digest('hex'),
    };
  }

  async download(objectName: string, generation?: string | null) {
    const [buffer] = await this.bucket().file(objectName, generation ? { generation } : undefined).download({ validation: true });
    return buffer;
  }

  async remove(objectName: string, generation?: string | null) {
    await this.bucket().file(objectName, generation ? { generation } : undefined).delete({ ignoreNotFound: true });
  }

  private bucket() {
    if (!this.bucketName) throw new ServiceUnavailableException('Document storage is not configured');
    return this.storage.bucket(this.bucketName);
  }
}
