import { BadRequestException } from '@nestjs/common';

export type AnnouncementParagraphBlock = { id: string; type: 'paragraph'; text: string };
export type AnnouncementImageBlock = { id: string; type: 'image'; attachmentKey: string; altText: string };
export type AnnouncementContentBlock = AnnouncementParagraphBlock | AnnouncementImageBlock;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseAnnouncementBlocks(value: unknown): AnnouncementContentBlock[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new BadRequestException('Announcement content must contain between 1 and 100 blocks');
  }
  const ids = new Set<string>();
  const attachmentKeys = new Set<string>();
  let textLength = 0;
  let imageCount = 0;
  const blocks = value.map((candidate): AnnouncementContentBlock => {
    if (!candidate || typeof candidate !== 'object') throw new BadRequestException('Announcement content contains an invalid block');
    const block = candidate as Record<string, unknown>;
    if (typeof block.id !== 'string' || !uuidPattern.test(block.id) || ids.has(block.id)) {
      throw new BadRequestException('Announcement content block IDs must be unique UUIDs');
    }
    ids.add(block.id);
    if (block.type === 'paragraph') {
      if (typeof block.text !== 'string') throw new BadRequestException('Announcement paragraph text is invalid');
      textLength += block.text.length;
      if (textLength > 10_000) throw new BadRequestException('Announcement message must not exceed 10,000 characters');
      return { id: block.id, type: 'paragraph', text: block.text };
    }
    if (block.type === 'image') {
      imageCount += 1;
      if (imageCount > 5) throw new BadRequestException('Announcements support up to five inline pictures');
      if (typeof block.attachmentKey !== 'string' || !uuidPattern.test(block.attachmentKey) || attachmentKeys.has(block.attachmentKey)) {
        throw new BadRequestException('Each inline picture must use a unique upload key');
      }
      const altText = typeof block.altText === 'string' ? block.altText.trim() : '';
      if (!altText || altText.length > 300) throw new BadRequestException('Each inline picture needs alt text of 300 characters or fewer');
      attachmentKeys.add(block.attachmentKey);
      return { id: block.id, type: 'image', attachmentKey: block.attachmentKey, altText };
    }
    throw new BadRequestException('Announcement content contains an unsupported block type');
  });
  if (!plainTextFromBlocks(blocks)) throw new BadRequestException('Announcement message text is required');
  return blocks;
}

export function plainTextFromBlocks(blocks: AnnouncementContentBlock[]) {
  return blocks.filter((block): block is AnnouncementParagraphBlock => block.type === 'paragraph').map((block) => block.text).join('\n').trim();
}

export function imageBlockSignature(blocks: AnnouncementContentBlock[] | undefined) {
  return JSON.stringify((blocks ?? []).filter((block): block is AnnouncementImageBlock => block.type === 'image').map((block) => ({ attachmentKey: block.attachmentKey, altText: block.altText })));
}
