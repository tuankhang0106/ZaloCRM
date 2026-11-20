// Pure helper functions for WhatsApp message keys, media classification,
// magic-byte inspection, caption filtering, self-echo merging, and asset extraction.

export interface WhatsAppMediaClassificationInput {
  type?: string;
  hasMedia?: boolean;
  body?: unknown;
}

function normalizeWhatsAppJid(jid?: string | null): string {
  if (!jid || typeof jid !== 'string') return '';
  const trimmed = jid.trim();
  if (!trimmed) return '';
  if (trimmed.endsWith('@s.whatsapp.net')) {
    return trimmed.replace('@s.whatsapp.net', '@c.us');
  }
  return trimmed;
}

export function extractRawMsgId(idOrSerialized?: string | null): string {
  if (!idOrSerialized || typeof idOrSerialized !== 'string') return '';
  const trimmed = idOrSerialized.trim();
  if (!trimmed) return '';
  const match = trimmed.match(/^(?:true|false)_([^_]+@[^_]+)_([^_]+)(?:_([^_]+@[^_]+))?$/);
  if (match && match[2]) {
    return match[2];
  }
  if (/^(?:true|false)_/.test(trimmed)) {
    const parts = trimmed.split('_');
    if (parts.length >= 3 && parts[2]) {
      return parts[2];
    }
  }
  return trimmed;
}

export function getSerializedMsgKey(msg: any): string | undefined {
  if (!msg) return undefined;
  const direct = msg?.id?._serialized;
  if (typeof direct === 'string' && direct.trim() && direct !== 'undefined' && direct !== 'null') {
    return direct.trim();
  }

  const keySource = msg?.id && typeof msg.id === 'object'
    ? msg.id
    : (msg?._data?.id && typeof msg._data.id === 'object' ? msg._data.id : null);

  if (!keySource) return undefined;

  const dataDirect = keySource._serialized;
  if (typeof dataDirect === 'string' && dataDirect.trim() && dataDirect !== 'undefined' && dataDirect !== 'null') {
    return dataDirect.trim();
  }

  const remoteRaw = typeof keySource.remote === 'string'
    ? keySource.remote
    : keySource.remote?._serialized;
  const remote = normalizeWhatsAppJid(remoteRaw);
  const rawId = typeof keySource.id === 'string' ? keySource.id.trim() : '';
  const fromMeVal = keySource.fromMe;

  if (typeof fromMeVal === 'boolean' && remote && rawId) {
    const participantRaw = typeof keySource.participant === 'string'
      ? keySource.participant
      : keySource.participant?._serialized;
    const participant = normalizeWhatsAppJid(participantRaw);
    return participant
      ? `${fromMeVal}_${remote}_${rawId}_${participant}`
      : `${fromMeVal}_${remote}_${rawId}`;
  }

  return undefined;
}

export function buildCandidateSerializedIds(
  rawOrSerializedId: string,
  threadId?: string | null,
  isSelf?: boolean,
  participant?: string | null,
): string[] {
  const candidates = new Set<string>();
  const trimmedInput = typeof rawOrSerializedId === 'string' ? rawOrSerializedId.trim() : '';
  if (!trimmedInput) return [];

  const isAlreadySerialized = /^(?:true|false)_[^_]+@[^_]+_/.test(trimmedInput);
  if (isAlreadySerialized) {
    candidates.add(trimmedInput);
  }

  const rawId = extractRawMsgId(trimmedInput);
  const normThread = normalizeWhatsAppJid(threadId);
  const normParticipant = normalizeWhatsAppJid(participant);

  if (normThread && rawId) {
    const firstPrefix = isSelf === true ? 'true' : (isSelf === false ? 'false' : 'false');
    const secondPrefix = firstPrefix === 'true' ? 'false' : 'true';

    if (normParticipant) {
      candidates.add(`${firstPrefix}_${normThread}_${rawId}_${normParticipant}`);
      candidates.add(`${secondPrefix}_${normThread}_${rawId}_${normParticipant}`);
    }
    candidates.add(`${firstPrefix}_${normThread}_${rawId}`);
    candidates.add(`${secondPrefix}_${normThread}_${rawId}`);
  }

  if (rawId) {
    candidates.add(rawId);
  }
  candidates.add(trimmedInput);

  return Array.from(candidates);
}

export function classifyWhatsAppMediaType(
  msg: WhatsAppMediaClassificationInput,
  rawThumbB64?: string,
): 'voice' | 'file' | 'video' | 'image' | 'text' {
  const t = String(msg?.type || '').trim().toLowerCase();

  if (t === 'ptt' || t === 'audio' || t === 'voice') return 'voice';
  if (t === 'document') return 'file';
  if (t === 'video' || t === 'ptv') return 'video';
  if (t === 'image' || t === 'sticker' || t === 'location') return 'image';

  // Known non-media message types (e.g. text link previews) may carry a JPEG preview thumbnail;
  // never let rawThumbB64 hijack them into standalone images.
  if (!t || t === 'unknown') {
    if (Boolean(rawThumbB64)) return 'image';
  }

  return 'text';
}

export function detectImageFormatFromBuffer(
  buf: Buffer,
  declaredMime?: string,
): { ext: 'webp' | 'png' | 'gif' | 'jpg' | 'pdf' | 'bin'; mime: string } {
  if (Buffer.isBuffer(buf) && buf.length >= 12) {
    // RIFF....WEBP
    if (
      buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
    ) {
      return { ext: 'webp', mime: 'image/webp' };
    }
  }

  if (Buffer.isBuffer(buf) && buf.length >= 8) {
    // 89 50 4E 47 0D 0A 1A 0A
    if (
      buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
      buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
    ) {
      return { ext: 'png', mime: 'image/png' };
    }
  }

  if (Buffer.isBuffer(buf) && buf.length >= 4) {
    // GIF87a / GIF89a
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) {
      return { ext: 'gif', mime: 'image/gif' };
    }
  }

  if (Buffer.isBuffer(buf) && buf.length >= 3) {
    // FF D8 FF (JPEG)
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
      return { ext: 'jpg', mime: 'image/jpeg' };
    }
  }

  const mimeLower = String(declaredMime || '').toLowerCase();
  if (Buffer.isBuffer(buf) && buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
    return { ext: 'pdf', mime: 'application/pdf' };
  }
  if (mimeLower.includes('pdf')) return { ext: 'pdf', mime: 'application/pdf' };
  if (mimeLower.includes('webp')) return { ext: 'webp', mime: 'image/webp' };
  if (mimeLower.includes('png')) return { ext: 'png', mime: 'image/png' };
  if (mimeLower.includes('gif')) return { ext: 'gif', mime: 'image/gif' };
  if (mimeLower.includes('jpeg') || mimeLower.includes('jpg')) return { ext: 'jpg', mime: 'image/jpeg' };
  if (mimeLower && !mimeLower.startsWith('image/') && mimeLower !== 'application/octet-stream') {
    return { ext: 'bin', mime: mimeLower };
  }
  return { ext: 'jpg', mime: 'image/jpeg' };
}

const NON_IMAGE_THUMB_MSG_TYPES = new Set(['document', 'file', 'video', 'ptt', 'audio', 'voice', 'ptv']);

export function isLikelyTinyWhatsAppThumb(opts: {
  msgType?: string;
  buf: Buffer;
  ext: string;
  declaredSize?: number;
  dataB64?: string;
  rawThumbB64?: string;
}): boolean {
  const byteLen = opts.buf?.length || 0;
  if (byteLen === 0) return true;

  // Never flag small legitimate non-image attachments (PDFs, text/RTF docs, voice clips, videos) as micro-thumbnails
  if (opts.msgType && NON_IMAGE_THUMB_MSG_TYPES.has(opts.msgType.toLowerCase())) {
    return false;
  }

  const detected = detectImageFormatFromBuffer(opts.buf);
  const effectiveExt = (opts.ext || detected.ext).toLowerCase();

  // Authentic WebP stickers on WhatsApp are typically 2KB-40KB; never reject valid WebP data
  // unless it literally equals the JPEG thumbnail string.
  if (opts.msgType === 'sticker' && (effectiveExt === 'webp' || detected.ext === 'webp')) {
    if (opts.rawThumbB64 && opts.dataB64 && opts.dataB64 === opts.rawThumbB64) {
      return true;
    }
    return false;
  }

  if (effectiveExt === 'webp' && detected.ext === 'webp' && byteLen >= 256) {
    return false;
  }

  if (opts.rawThumbB64 && opts.dataB64 && opts.dataB64 === opts.rawThumbB64 && opts.dataB64.length <= 20000) {
    return true;
  }

  const declared = Number(opts.declaredSize || 0);
  if (declared >= 20000 && byteLen < 12000 && byteLen * 4 < declared) {
    return true;
  }

  // Regular JPEG photo under 5.5KB is a 72px/100px WA micro-thumbnail
  if (effectiveExt === 'jpg' && byteLen < 5500) {
    return true;
  }

  return false;
}

const IGNORED_PLACEHOLDER_CAPTIONS = new Set([
  '[hình ảnh]',
  '[video]',
  '[tài liệu]',
  '[tin nhắn thoại]',
  '[nhãn dán]',
  '[sticker]',
  '[image]',
  '[document]',
  '[file]',
  '[tệp đính kèm]',
]);

export function shouldIgnoreWhatsAppCaption(caption: unknown): boolean {
  if (typeof caption !== 'string') return true;
  const trimmed = caption.trim();
  if (!trimmed) return true;

  if (IGNORED_PLACEHOLDER_CAPTIONS.has(trimmed.toLowerCase())) return true;
  if (/^\[(?:gửi\s+file|tệp)\s*:/i.test(trimmed)) return true;

  if (
    trimmed.startsWith('/9j/') ||
    trimmed.startsWith('data:image/') ||
    trimmed.startsWith('iVBORw0K') ||
    trimmed.startsWith('UklGR')
  ) {
    return true;
  }

  if (
    trimmed.startsWith('/storage/') ||
    trimmed.startsWith('/uploads/') ||
    trimmed.startsWith('/api/') ||
    /^https?:\/\/\S+$/i.test(trimmed)
  ) {
    return true;
  }

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === 'object' && parsed !== null) {
        return true;
      }
    } catch {
      if (trimmed.startsWith('{"')) return true;
    }
  }

  if (trimmed.length > 200 && !/\s/.test(trimmed) && /^[A-Za-z0-9+/=]+$/.test(trimmed.slice(0, 64))) {
    return true;
  }

  return false;
}

export function hasExplicitVoiceMarker(raw: unknown): boolean {
  if (typeof raw !== 'string' || !raw) return false;
  return (
    /\.(aac|mp3|m4a|wav|ogg|opus)(\?|$)/i.test(raw) ||
    /(?:^|[^a-z])voice(?:Url|_|\/|-|\.)|waveformSamples|\[Tin nhắn thoại\]|msginfo\.voice/i.test(raw)
  );
}

export function extractUsableCaptionFromIncoming(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('{')) {
    try {
      const p = JSON.parse(trimmed);
      for (const field of [p?.caption, p?.title]) {
        if (typeof field === 'string' && !shouldIgnoreWhatsAppCaption(field)) {
          return field.trim();
        }
      }
    } catch {}
    return '';
  }
  return !shouldIgnoreWhatsAppCaption(trimmed) ? trimmed : '';
}

function hasUsableMediaUrl(parsed: any, attachments: any): boolean {
  if (parsed && typeof parsed === 'object') {
    const candidates = [parsed.localUrl, parsed.hdUrl, parsed.href, parsed.videoUrl, parsed.voiceUrl, parsed.url];
    if (candidates.some((u) => typeof u === 'string' && u.trim().length > 0)) {
      return true;
    }
  }
  if (Array.isArray(attachments) && attachments.length > 0) {
    return attachments.some((a) => {
      if (typeof a === 'string') return a.trim().length > 0;
      if (a && typeof a === 'object') {
        return Boolean(a.localUrl || a.url || a.href || a.fileUrl);
      }
      return false;
    });
  }
  return false;
}

export function mergeOutgoingSelfEcho(
  existing: {
    zaloMsgId: string | null;
    content: string | null;
    contentType: string;
    attachments: any;
  },
  incoming: {
    msgId?: string | null;
    content?: string | null;
    contentType?: string;
    attachments?: any;
  },
): {
  zaloMsgId: string | null;
  content: string;
  contentType: string;
  attachments: any;
} {
  const existingType = existing.contentType || incoming.contentType || 'text';
  const isMediaType = ['image', 'video', 'file', 'voice'].includes(existingType);
  const existingStr = (existing.content || '').trim();
  const isExistingJson = existingStr.startsWith('{');

  let existingParsed: any = null;
  if (isExistingJson) {
    try { existingParsed = JSON.parse(existingStr); } catch {}
  }

  const parsedAttachments = typeof existing.attachments === 'string'
    ? (() => { try { return JSON.parse(existing.attachments); } catch { return []; } })()
    : (Array.isArray(existing.attachments) ? existing.attachments : []);

  const incomingAttachments = Array.isArray(incoming.attachments) ? incoming.attachments : [];

  const canonicalMsgId =
    (incoming.msgId && !incoming.msgId.startsWith('wa_out_') ? incoming.msgId : null) ||
    existing.zaloMsgId ||
    incoming.msgId ||
    null;

  // Case 1: Existing record already holds valid media URL(s) (e.g. CRM /storage/chat_files/...)
  if (isMediaType && existingParsed && hasUsableMediaUrl(existingParsed, parsedAttachments)) {
    const mergedObj = { ...existingParsed };
    if (shouldIgnoreWhatsAppCaption(mergedObj.caption)) delete mergedObj.caption;
    if (existingType !== 'file' && shouldIgnoreWhatsAppCaption(mergedObj.title)) delete mergedObj.title;

    const incomingCap = extractUsableCaptionFromIncoming(incoming.content);
    if (existingType !== 'file' && !mergedObj.caption && !mergedObj.title && incomingCap) {
      mergedObj.caption = incomingCap;
      mergedObj.title = incomingCap;
    }

    const finalAttachments = parsedAttachments.length > 0 ? parsedAttachments : incomingAttachments;
    return {
      zaloMsgId: canonicalMsgId,
      content: JSON.stringify(mergedObj),
      contentType: existingType,
      attachments: finalAttachments,
    };
  }

  // Case 2: Existing plain URL pointing to /storage/ or /uploads/ on a media message
  if (
    isMediaType &&
    !isExistingJson &&
    (existingStr.startsWith('/storage/') || existingStr.startsWith('/uploads/') || existingStr.startsWith('http'))
  ) {
    return {
      zaloMsgId: canonicalMsgId,
      content: existingStr,
      contentType: existingType,
      attachments: parsedAttachments.length > 0 ? parsedAttachments : incomingAttachments,
    };
  }

  // Case 3: Existing record was an empty placeholder (e.g. {"href":"","thumb":"","hdUrl":""}) or text
  let nextContent = existingStr;
  if (incoming.content && !shouldIgnoreWhatsAppCaption(incoming.content)) {
    nextContent = incoming.content.trim();
  } else if (incoming.content && incoming.content.trim().startsWith('{')) {
    nextContent = incoming.content.trim();
  } else if (!nextContent && incoming.content) {
    nextContent = incoming.content.trim();
  }

  return {
    zaloMsgId: canonicalMsgId,
    content: nextContent,
    contentType: existing.contentType || incoming.contentType || 'text',
    attachments: incomingAttachments.length > 0 ? incomingAttachments : parsedAttachments,
  };
}

export interface ExtractedMedia {
  id: string;
  url: string;
  thumbUrl?: string;
  caption?: string | null;
  senderType: string;
  senderName: string | null;
  sentAt: Date;
}

export interface ExtractedFile {
  id: string;
  name: string;
  size: string;
  href: string;
  extension: string;
  senderType: string;
  senderName: string | null;
  sentAt: Date;
}

export interface ExtractedLink {
  id: string;
  url: string;
  title: string;
  description?: string;
  domain: string;
  senderType: string;
  senderName: string | null;
  sentAt: Date;
}

function isMediaAssetPath(u: unknown): u is string {
  if (typeof u !== 'string') return false;
  const t = u.trim();
  return (
    t.startsWith('http://') ||
    t.startsWith('https://') ||
    t.startsWith('data:') ||
    t.startsWith('/storage/') ||
    t.startsWith('/uploads/') ||
    t.startsWith('/api/')
  );
}

export function extractConversationAssets(messages: Array<{
  id: string;
  contentType: string;
  content: string | null;
  senderType: string;
  senderName: string | null;
  sentAt: Date;
  attachments?: any;
}>): { images: ExtractedMedia[]; files: ExtractedFile[]; links: ExtractedLink[] } {
  const images: ExtractedMedia[] = [];
  const files: ExtractedFile[] = [];
  const links: ExtractedLink[] = [];
  const seenImageUrls = new Set<string>();
  const seenFileHrefs = new Set<string>();
  const seenLinkUrls = new Set<string>();

  for (const msg of messages) {
    const attList = Array.isArray(msg.attachments) ? msg.attachments : [];
    if (!msg.content && attList.length === 0) {
      continue;
    }

    const contentStr = (msg.content || '').trim();
    let parsedJson: any = null;
    if (contentStr.startsWith('{')) {
      try { parsedJson = JSON.parse(contentStr); } catch {}
    }

    // 1. Process as Image / Video
    if (msg.contentType === 'image' || msg.contentType === 'video') {
      let imgUrl = '';
      let thumbUrl = '';
      let caption: string | null = null;

      if (parsedJson) {
        imgUrl = parsedJson.hdUrl || parsedJson.localUrl || parsedJson.normalUrl || parsedJson.href || parsedJson.videoUrl || parsedJson.url || parsedJson.thumb || '';
        thumbUrl = parsedJson.thumb || parsedJson.localUrl || parsedJson.href || imgUrl;
        const rawCap = parsedJson.caption || parsedJson.title || parsedJson.description || null;
        caption = !shouldIgnoreWhatsAppCaption(rawCap) ? String(rawCap).trim() : null;
      } else if (isMediaAssetPath(contentStr)) {
        imgUrl = contentStr;
        thumbUrl = contentStr;
      }

      if (!imgUrl && attList.length > 0) {
        const imgAtt = attList.find((a: any) => a && a.type !== 'zalo_meta' && a.type !== 'reaction' && isMediaAssetPath(a.localUrl || a.url || a.href));
        if (imgAtt) {
          imgUrl = imgAtt.localUrl || imgAtt.url || imgAtt.href;
          thumbUrl = imgUrl;
        }
      }

      if (imgUrl && !seenImageUrls.has(imgUrl)) {
        seenImageUrls.add(imgUrl);
        images.push({
          id: msg.id,
          url: imgUrl,
          thumbUrl: thumbUrl || imgUrl,
          caption,
          senderType: msg.senderType,
          senderName: msg.senderName,
          sentAt: msg.sentAt,
        });
        continue;
      }
    }

    // 2. Check JSON for Image if contentType wasn't 'image'
    if (parsedJson && msg.contentType !== 'file' && msg.contentType !== 'voice' && msg.contentType !== 'call') {
      const href = parsedJson.localUrl || parsedJson.hdUrl || parsedJson.href || parsedJson.url || parsedJson.thumb || '';
      const isVoiceOrAudio =
        hasExplicitVoiceMarker(href) ||
        Boolean(parsedJson.voiceUrl) ||
        parsedJson.action?.includes('voice') ||
        (typeof parsedJson.params === 'string' && parsedJson.params.includes('waveformSamples'));
      const isImg =
        isMediaAssetPath(href) &&
        !isVoiceOrAudio &&
        (/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(href) || (href.includes('zdn.vn') && !String(parsedJson.params || '').includes('fileExt')));
      if (isImg && !seenImageUrls.has(href)) {
        seenImageUrls.add(href);
        const rawCap = parsedJson.caption || parsedJson.title || null;
        images.push({
          id: msg.id,
          url: href,
          thumbUrl: parsedJson.thumb || href,
          caption: !shouldIgnoreWhatsAppCaption(rawCap) ? String(rawCap).trim() : null,
          senderType: msg.senderType,
          senderName: msg.senderName,
          sentAt: msg.sentAt,
        });
        continue;
      }
    }

    // 3. Process as File
    const isFile = msg.contentType === 'file';
    let fileInfo: { name: string; size: string; href: string; extension: string } | null = null;

    if (parsedJson) {
      let params = parsedJson.params;
      if (typeof params === 'string') {
        try { params = JSON.parse(params); } catch {}
      }
      const hasFileExt = params?.fileExt || /\.(pdf|xlsx?|docx?|pptx?|zip|rar|tar|gz|7z|txt|csv)$/i.test(parsedJson.title || parsedJson.href || parsedJson.localUrl || '');
      if (isFile || params?.fType === 1 || hasFileExt) {
        const bytes = parseInt(params?.fileSize || '0', 10);
        const sizeStr = bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : (bytes > 0 ? `${Math.round(bytes / 1024)} KB` : '');
        const href = parsedJson.localUrl || parsedJson.href || '';
        const ext = params?.fileExt || (parsedJson.title ? parsedJson.title.split('.').pop() : (href ? href.split('?')[0].split('.').pop() : 'file'));
        fileInfo = {
          name: parsedJson.title || `Tài liệu.${ext}`,
          size: sizeStr,
          href,
          extension: (ext || 'file').toLowerCase(),
        };
      }
    } else if (isFile && attList.length > 0) {
      const fAtt = attList.find((a: any) => a && (a.url || a.href || a.localUrl));
      if (fAtt) {
        const href = fAtt.localUrl || fAtt.url || fAtt.href;
        const name = fAtt.name || fAtt.fileName || 'Tài liệu';
        const ext = name.includes('.') ? name.split('.').pop()! : 'file';
        fileInfo = { name, size: fAtt.size || '', href, extension: ext.toLowerCase() };
      }
    }

    if (fileInfo && fileInfo.href && !seenFileHrefs.has(fileInfo.href)) {
      seenFileHrefs.add(fileInfo.href);
      files.push({
        id: msg.id,
        name: fileInfo.name,
        size: fileInfo.size,
        href: fileInfo.href,
        extension: fileInfo.extension,
        senderType: msg.senderType,
        senderName: msg.senderName,
        sentAt: msg.sentAt,
      });
      continue;
    }

    // 4. Process as Link (external URLs only)
    if (msg.contentType === 'link' || parsedJson?.href?.startsWith('http')) {
      const linkHref = parsedJson?.href || (contentStr.startsWith('http') ? contentStr : '');
      if (linkHref && linkHref.startsWith('http') && !seenLinkUrls.has(linkHref)) {
        if (!linkHref.includes('/gr/jpg/') && !linkHref.includes('/no/jpg/') && !/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(linkHref)) {
          seenLinkUrls.add(linkHref);
          let domain = '';
          try { domain = new URL(linkHref).hostname; } catch {}
          let linkTitle = parsedJson?.title;
          if (!linkTitle && parsedJson?.params) {
            let p = parsedJson.params;
            if (typeof p === 'string') { try { p = JSON.parse(p); } catch {} }
            linkTitle = p?.mediaTitle;
          }
          links.push({
            id: msg.id,
            url: linkHref,
            title: (linkTitle && String(linkTitle).trim()) || linkHref,
            description: parsedJson?.description || '',
            domain,
            senderType: msg.senderType,
            senderName: msg.senderName,
            sentAt: msg.sentAt,
          });
          continue;
        }
      }
    }

    if (!parsedJson && msg.contentType === 'text' && contentStr.includes('http')) {
      const urlMatches = contentStr.match(/https?:\/\/[^\s"'<>]+/g);
      if (urlMatches) {
        for (const u of urlMatches) {
          if (!seenLinkUrls.has(u) && !/\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(u)) {
            seenLinkUrls.add(u);
            let domain = '';
            try { domain = new URL(u).hostname; } catch {}
            links.push({
              id: msg.id,
              url: u,
              title: u,
              domain,
              senderType: msg.senderType,
              senderName: msg.senderName,
              sentAt: msg.sentAt,
            });
          }
        }
      }
    }
  }

  return { images, files, links };
}
