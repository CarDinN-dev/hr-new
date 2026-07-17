import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Storage } from '@google-cloud/storage';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

@Injectable()
export class DocumentStorageService {
  private readonly storage = new Storage();
  private readonly bucketName: string;
  private readonly testStorageDirectory: string | null;

  constructor(config: ConfigService) {
    this.bucketName = config.get<string>('GCS_DOCUMENTS_BUCKET', '').trim();
    const testAdapter = config.get<string>('DOCUMENT_STORAGE_ADAPTER') === 'filesystem-test';
    const configuredDirectory = config.get<string>('TEST_STORAGE_DIRECTORY', '').trim();
    if (testAdapter && config.get<string>('NODE_ENV') !== 'test') {
      throw new Error('The filesystem-test document storage adapter is restricted to NODE_ENV=test');
    }
    if (testAdapter && !configuredDirectory) throw new Error('TEST_STORAGE_DIRECTORY is required for filesystem-test storage');
    if (config.get<string>('NODE_ENV') === 'production' && !testAdapter && !this.bucketName) {
      throw new Error('GCS_DOCUMENTS_BUCKET is required in production');
    }
    this.testStorageDirectory = testAdapter ? resolve(configuredDirectory) : null;
  }

  async upload(employeeId: string, file: Express.Multer.File) {
    const safeName = file.originalname.replace(/[^A-Za-z0-9._-]+/g, '-').slice(-180) || 'document';
    return this.uploadPrivate(
      `employees/${employeeId}/${new Date().getUTCFullYear()}`,
      `${randomUUID()}-${safeName}`,
      file.mimetype,
      file.buffer,
      { employeeId, originalName: file.originalname },
    );
  }

  async uploadPrivate(prefix: string, fileName: string, contentType: string, buffer: Buffer, customMetadata: Record<string, string> = {}) {
    const safePrefix = prefix.split('/').filter(Boolean).map((part) => part.replace(/[^A-Za-z0-9._-]+/g, '-')).join('/');
    const safeName = fileName.replace(/[^A-Za-z0-9._-]+/g, '-').slice(-180) || 'document';
    const objectName = `${safePrefix}/${safeName}`;
    if (this.testStorageDirectory) {
      const target = this.testObjectPath(objectName);
      await mkdir(dirname(target), { recursive: true });
      try {
        await writeFile(target, buffer, { flag: 'wx' });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const existing = await readFile(target);
        if (createHash('sha256').update(existing).digest('hex') !== createHash('sha256').update(buffer).digest('hex')) throw error;
      }
      return {
        objectName,
        generation: createHash('sha256').update(buffer).digest('hex').slice(0, 16),
        sha256: createHash('sha256').update(buffer).digest('hex'),
        sizeBytes: buffer.length,
      };
    }
    const bucket = this.bucket();
    const object = bucket.file(objectName);
    try {
      await object.save(buffer, {
        resumable: false,
        validation: 'crc32c',
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: {
          contentType,
          cacheControl: 'private, no-store, max-age=0',
          metadata: customMetadata,
        },
      });
    } catch (error) {
      if ((error as { code?: number }).code !== 412) throw error;
      const [existing] = await object.download({ validation: true });
      if (createHash('sha256').update(existing).digest('hex') !== createHash('sha256').update(buffer).digest('hex')) throw error;
    }
    const [metadata] = await object.getMetadata();
    return {
      objectName,
      generation: metadata.generation == null ? undefined : String(metadata.generation),
      sha256: createHash('sha256').update(buffer).digest('hex'),
      sizeBytes: buffer.length,
    };
  }

  async download(objectName: string, generation?: string | null) {
    if (this.testStorageDirectory) return readFile(this.testObjectPath(objectName));
    const [buffer] = await this.bucket().file(objectName, generation ? { generation } : undefined).download({ validation: true });
    return buffer;
  }

  async remove(objectName: string, generation?: string | null) {
    if (this.testStorageDirectory) {
      await rm(this.testObjectPath(objectName), { force: true });
      return;
    }
    await this.bucket().file(objectName, generation ? { generation } : undefined).delete({ ignoreNotFound: true });
  }

  private testObjectPath(objectName: string) {
    if (!this.testStorageDirectory) throw new Error('Test storage is not configured');
    const target = resolve(this.testStorageDirectory, ...objectName.split('/'));
    if (target !== this.testStorageDirectory && !target.startsWith(`${this.testStorageDirectory}${sep}`)) {
      throw new ServiceUnavailableException('Invalid document storage object name');
    }
    return target;
  }

  private bucket() {
    if (!this.bucketName) throw new ServiceUnavailableException('Document storage is not configured');
    return this.storage.bucket(this.bucketName);
  }
}
