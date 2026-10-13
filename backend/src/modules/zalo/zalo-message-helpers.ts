/**
 * zalo-message-helpers.ts — utilities for processing incoming Zalo messages.
 * Detects content type from msgType and updates contact avatars fire-and-forget.
 */
import { prisma } from '../../shared/database/prisma-client.js';

/**
 * Map zca-js msgType string to a normalized content type label.
 * Falls back to 'text' for unrecognised types or plain-string content.
 */
export function detectContentType(msgType: string | undefined, content: any): string {
  const typeLower = (msgType || '').toLowerCase();
  if (typeLower.includes('photo') || typeLower.includes('image')) return 'image';
  if (typeLower.includes('file') || typeLower.includes('doc')) return 'file';
  if (typeLower.includes('sticker')) return 'sticker';
  if (typeLower.includes('video')) return 'video';
  if (typeLower.includes('voice')) return 'voice';
  if (typeLower.includes('gif')) return 'gif';
  if (typeLower.includes('location')) return 'location';

  // Deep inspect object or JSON-string content
  let parsed = content;
  if (typeof content === 'string' && content.trim().startsWith('{')) {
    try { parsed = JSON.parse(content); } catch {}
  }

  if (typeof parsed === 'object' && parsed !== null) {
    let params = parsed.params;
    if (typeof params === 'string') {
      try { params = JSON.parse(params); } catch {}
    }

    // 1. Call detection
    if (parsed.action?.includes('call') || parsed.title === 'sendBubbleMessage' || parsed.description === 'Cuộc gọi' || params?.callId !== undefined) {
      return 'call';
    }

    // 2. Voice detection
    if (
      parsed.action?.includes('voice') ||
      params?.waveformSamples ||
      params?.m4a ||
      (parsed.href && (parsed.href.includes('voice') || parsed.href.includes('.aac') || parsed.href.includes('.m4a') || parsed.href.includes('.mp3')))
    ) {
      return 'voice';
    }

    // 3. File detection
    if (params?.fileExt || params?.fType === 1 || /\.(pdf|xlsx?|docx?|pptx?|zip|rar|tar|gz|7z|txt|csv)$/i.test(parsed.title || parsed.href || '')) {
      return 'file';
    }

    // 4. Image detection
    const href = parsed.href || parsed.thumb || parsed.hdUrl || '';
    if (href && (/\.(jpg|jpeg|png|webp|gif)$/i.test(href) || href.includes('/gr/jpg/') || href.includes('/no/jpg/'))) {
      if (!parsed.action?.includes('link')) {
        return 'image';
      }
    }

    // 5. Link detection
    if (parsed.action?.includes('link') || (href && href.startsWith('http')) || params?.redirect_url || params?.src) {
      return 'link';
    }

    // 6. Contact card
    if (parsed.action?.includes('user') || typeLower.includes('recommended') || typeLower.includes('card')) {
      return 'contact_card';
    }

    return 'rich';
  }

  if (typeLower.includes('link')) return 'link';
  if (typeLower.includes('recommended') || typeLower.includes('card')) return 'contact_card';

  if (typeof content === 'string' && /^https?:\/\/\S+$/i.test(content.trim())) {
    return 'link';
  }

  return 'text';
}

/**
 * Fire-and-forget: fill in a missing avatarUrl on a Contact row.
 * Only updates rows where avatarUrl is currently null.
 */
export function updateContactAvatar(zaloUid: string, avatarUrl: string): void {
  prisma.contact
    .updateMany({
      where: { zaloUid, avatarUrl: null },
      data: { avatarUrl },
    })
    .catch(() => {});
}
