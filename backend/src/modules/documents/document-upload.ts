const documentMimeTypes = new Set([
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

export const isAllowedDocumentMimeType = (contentType: string) => documentMimeTypes.has(contentType);

export const documentUploadOptions = {
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_request: unknown, file: Express.Multer.File, callback: (error: Error | null, acceptFile: boolean) => void) => {
    const accepted = isAllowedDocumentMimeType(file.mimetype);
    callback(accepted ? null : new Error('Unsupported document type'), accepted);
  },
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
  fileFilter: (_request: unknown, file: Express.Multer.File, callback: (error: Error | null, acceptFile: boolean) => void) => {
    const accepted = leaveAttachmentMimeTypes.has(file.mimetype);
    callback(accepted ? null : new Error('Leave attachments must be PDF or image files'), accepted);
  },
};
