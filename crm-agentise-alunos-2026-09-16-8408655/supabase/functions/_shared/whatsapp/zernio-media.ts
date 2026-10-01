import { asObject, str } from './types.ts';
export function decodeZernioInbound(message: Record<string, unknown>): {
  contentType: 'text' | 'image' | 'audio' | 'video' | 'document';
  content: string | null;
  mediaUrl: string | null;
} {
  const text = str(message, ['text', 'body', 'caption']);
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  const firstAttachment = asObject(attachments[0]);
  const mediaUrl = str(firstAttachment, ['url', 'link', 'href']);
  const attType = (str(firstAttachment, ['type']) ?? '').toLowerCase();

  if (!mediaUrl) return { contentType: 'text', content: text ?? '', mediaUrl: null };
  switch (attType) {
    case 'image':
    case 'sticker':
      return { contentType: 'image', content: text, mediaUrl };
    case 'audio':
    case 'voice':
      return { contentType: 'audio', content: null, mediaUrl };
    case 'video':
      return { contentType: 'video', content: text, mediaUrl };
    default: // file, share, document
      return { contentType: 'document', content: text, mediaUrl };
  }
}

