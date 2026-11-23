import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { prisma } from '../database/prisma-client.js';
import { logger } from '../utils/logger.js';
import { config } from '../../config/index.js';

const execFileAsync = promisify(execFile);

export interface TelegramCustomerAlertParams {
  customerName?: string | null;
  brandName?: string | null;
  accountDisplayName?: string | null;
  content?: string | null;
  contentType?: string | null;
  channel?: string | null;
  orgId?: string | null;
  attachments?: any;
}

export interface ExtractedMedia {
  kind: 'photo' | 'voice' | 'video' | 'document' | 'none';
  url?: string;
  localPath?: string;
  filename?: string;
  mimeType?: string;
}

const BUILTIN_BOT_TOKEN = '8968122354:AAE5HvtXouoQOj70ibszh9i7oJDKVzGpmXw';
const BUILTIN_CHAT_ID = '-5468075549';

/**
 * Tìm đường dẫn thực thi của FFmpeg trên hệ thống
 */
export function findFfmpeg(): string | null {
  if (fs.existsSync('/usr/bin/ffmpeg')) return '/usr/bin/ffmpeg';
  if (fs.existsSync('/usr/local/bin/ffmpeg')) return '/usr/local/bin/ffmpeg';
  if (fs.existsSync('/opt/homebrew/bin/ffmpeg')) return '/opt/homebrew/bin/ffmpeg';
  return null;
}

/**
 * Chuyển mã âm thanh (Zalo AAC/M4A, WhatsApp OGG/WebM, MP3...) sang chuẩn Telegram Voice (Ogg Opus 48kHz Mono)
 * và chuẩn Audio MP3 (tương thích 100% mọi trình phát trên iOS/Android/PC).
 */
export async function transcodeAudioForTelegram(
  inputPathOrBuffer: string | Buffer,
  origFilename = 'voice.ogg'
): Promise<{
  oggPath?: string;
  mp3Path?: string;
  cleanup: () => Promise<void>;
}> {
  const tmpFiles: string[] = [];
  const cleanup = async () => {
    for (const f of tmpFiles) {
      try {
        if (fs.existsSync(f)) await fs.promises.unlink(f);
      } catch {}
    }
  };

  const ffmpeg = findFfmpeg();
  if (!ffmpeg) {
    return { cleanup };
  }

  let inputPath: string;
  if (typeof inputPathOrBuffer === 'string' && fs.existsSync(inputPathOrBuffer)) {
    inputPath = inputPathOrBuffer;
  } else if (Buffer.isBuffer(inputPathOrBuffer)) {
    inputPath = path.join('/tmp', `raw_in_${Date.now()}_${Math.random().toString(36).slice(2, 6)}_${origFilename}`);
    await fs.promises.writeFile(inputPath, inputPathOrBuffer);
    tmpFiles.push(inputPath);
  } else {
    return { cleanup };
  }

  const baseTmp = path.join('/tmp', `tg_transcode_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
  const oggPath = `${baseTmp}.ogg`;
  const mp3Path = `${baseTmp}.mp3`;
  tmpFiles.push(oggPath, mp3Path);

  let hasOgg = false;
  let hasMp3 = false;

  // 1. Chuyển mã sang chuẩn Ogg Opus của Telegram (48000Hz, Mono, 32kbps)
  try {
    await execFileAsync(ffmpeg, [
      '-y',
      '-i', inputPath,
      '-c:a', 'libopus',
      '-b:a', '32k',
      '-vbr', 'on',
      '-compression_level', '10',
      '-ar', '48000',
      '-ac', '1',
      oggPath,
    ], { timeout: 15000 });

    if (fs.existsSync(oggPath) && (await fs.promises.stat(oggPath)).size > 0) {
      hasOgg = true;
    }
  } catch (err) {
    logger.warn('[telegram-notification] FFmpeg Ogg Opus transcode failed:', err);
  }

  // 2. Chuyển mã sang chuẩn MP3 (Phát tương thích tuyệt đối trên mọi thiết bị di động)
  try {
    await execFileAsync(ffmpeg, [
      '-y',
      '-i', inputPath,
      '-c:a', 'libmp3lame',
      '-b:a', '64k',
      '-ar', '44100',
      '-ac', '1',
      mp3Path,
    ], { timeout: 15000 });

    if (fs.existsSync(mp3Path) && (await fs.promises.stat(mp3Path)).size > 0) {
      hasMp3 = true;
    }
  } catch (err) {
    logger.warn('[telegram-notification] FFmpeg MP3 transcode failed:', err);
  }

  return {
    oggPath: hasOgg ? oggPath : undefined,
    mp3Path: hasMp3 ? mp3Path : undefined,
    cleanup,
  };
}

/**
 * Chuẩn hóa tên thương hiệu theo hệ sinh thái doanh nghiệp
 */
export function resolveBrandName(accountDisplayName?: string | null, fallbackName?: string | null): string {
  const raw = (accountDisplayName || fallbackName || '').trim();
  if (!raw) return 'Portal';

  const normalized = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[\s\-_.]/g, '');

  if (normalized.includes('adameva') || normalized.includes('adam')) {
    return 'AdamEva.vn';
  }
  if (normalized.includes('chuyengiadongphuc') || normalized.includes('dongphuc') || normalized.includes('cgia')) {
    return 'ChuyenGiaDongPhuc.vn';
  }
  if (normalized.includes('cgdp') || normalized.includes('cgd')) {
    return 'CGDP.vn';
  }
  if (normalized.includes('piju')) {
    return 'PIJU.vn';
  }
  if (normalized.includes('teamkcn') || normalized.includes('kcn')) {
    return 'Team KCN';
  }
  if (normalized.includes('vinmerica')) {
    return 'VINMERICA';
  }
  if (normalized.includes('robert')) {
    return 'Robert Việt';
  }

  return raw;
}

/**
 * Chuẩn hóa nội dung tin nhắn hiển thị trong thông báo Telegram
 */
export function formatMessageSnippet(content?: string | null, contentType?: string | null): string {
  const trimmed = (content || '').trim();

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      const caption = parsed.caption || parsed.description || (parsed.title && !parsed.title.startsWith('{') ? parsed.title : '');
      if (caption && typeof caption === 'string' && caption.trim()) {
        const cTrimmed = caption.trim();
        return cTrimmed.length > 1000 ? `${cTrimmed.slice(0, 1000)}...` : cTrimmed;
      }
    } catch {
      // not valid JSON, proceed
    }
  } else if (trimmed && !/^\/(?:uploads|storage|api)\//i.test(trimmed)) {
    return trimmed.length > 1000 ? `${trimmed.slice(0, 1000)}...` : trimmed;
  }

  switch (contentType) {
    case 'image':
    case 'chat.photo':
      return '[Hình ảnh]';
    case 'video':
      return '[Video]';
    case 'voice':
    case 'audio':
      return '[Tin nhắn thoại]';
    case 'file':
    case 'doc':
      return '[Tệp đính kèm]';
    case 'sticker':
    case 'chat.sticker':
      return '[Nhãn dán]';
    default:
      return '[Tin nhắn mới]';
  }
}

/**
 * Kiểm tra và phân giải đường dẫn tập tin nội bộ trên máy chủ
 */
export function resolveLocalPath(urlOrPath?: string | null): string | null {
  if (!urlOrPath || typeof urlOrPath !== 'string') return null;
  const trimmed = urlOrPath.trim();
  if (!trimmed) return null;

  try {
    const uploadDir = path.resolve(config.uploadDir || path.join(process.cwd(), 'uploads'));

    // Đường dẫn tuyệt đối đã tồn tại
    if (path.isAbsolute(trimmed) && fs.existsSync(trimmed)) {
      return trimmed;
    }

    // Định dạng /uploads/... hoặc /storage/...
    if (/^\/?(?:uploads|storage)\//i.test(trimmed)) {
      const rel = trimmed.replace(/^\/?(?:uploads|storage)\//i, '');
      const candidate1 = path.join(uploadDir, rel);
      if (fs.existsSync(candidate1)) return candidate1;

      const candidate2 = path.join(uploadDir, 'media', path.basename(rel));
      if (fs.existsSync(candidate2)) return candidate2;
    }
  } catch (err) {
    logger.warn('[telegram-notification] Error in resolveLocalPath:', err);
  }

  return null;
}

/**
 * Trích xuất thông tin đa phương tiện (Ảnh, Nhãn dán, Giọng nói, Video, Tập tin) từ tin nhắn
 */
export function extractTelegramMedia(
  content?: string | null,
  contentType?: string | null,
  attachments?: any
): ExtractedMedia {
  const cType = (contentType || '').toLowerCase();
  const trimmed = (content || '').trim();

  let parsed: any = null;
  let params: any = null;
  if (trimmed.startsWith('{')) {
    try {
      parsed = JSON.parse(trimmed);
      if (typeof parsed.params === 'string') {
        try { params = JSON.parse(parsed.params); } catch {}
      } else if (typeof parsed.params === 'object' && parsed.params !== null) {
        params = parsed.params;
      }
    } catch {}
  }

  let attList: any[] = [];
  if (Array.isArray(attachments)) {
    attList = attachments;
  } else if (typeof attachments === 'string' && attachments.trim().startsWith('[')) {
    try {
      const p = JSON.parse(attachments.trim());
      if (Array.isArray(p)) attList = p;
    } catch {}
  }

  // 1. NHÃN DÁN (STICKER)
  if (cType === 'sticker' || cType === 'chat.sticker' || parsed?.isSticker || parsed?.catId) {
    const localWaSticker = resolveLocalPath(parsed?.localUrl || parsed?.href || parsed?.url || trimmed);
    if (localWaSticker) {
      return { kind: 'photo', localPath: localWaSticker, filename: path.basename(localWaSticker), mimeType: 'image/webp' };
    }
    const eid = parsed?.id || parsed?.stickerId || parsed?.eid || (/^\d+$/.test(trimmed) ? trimmed : null);
    if (eid) {
      return {
        kind: 'photo',
        url: `https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=${eid}&size=200`,
        filename: `sticker_${eid}.webp`,
        mimeType: 'image/webp',
      };
    }
    const stickerUrl = parsed?.stickerUrl || parsed?.url || (trimmed.startsWith('http') ? trimmed : null);
    if (stickerUrl) {
      return { kind: 'photo', url: stickerUrl, filename: 'sticker.webp', mimeType: 'image/webp' };
    }
  }

  // 2. HÌNH ẢNH (PHOTO / IMAGE)
  if (
    cType === 'image' ||
    cType === 'chat.photo' ||
    parsed?.thumb ||
    parsed?.hdUrl ||
    params?.hd ||
    params?.rawUrl ||
    /\.(?:jpe?g|png|webp|gif|bmp|heic)(?:\?.*)?$/i.test(trimmed)
  ) {
    const rawUrl =
      parsed?.hdUrl ||
      params?.hd ||
      parsed?.href ||
      params?.rawUrl ||
      parsed?.thumb ||
      parsed?.normalUrl ||
      parsed?.localUrl ||
      parsed?.url ||
      (trimmed.startsWith('http') || trimmed.startsWith('/') ? trimmed : null);

    const localFile = resolveLocalPath(rawUrl);
    if (localFile) {
      return { kind: 'photo', localPath: localFile, filename: path.basename(localFile) };
    }
    if (rawUrl && /^https?:\/\//i.test(rawUrl)) {
      return { kind: 'photo', url: rawUrl };
    }

    for (const att of attList) {
      if (!att || typeof att !== 'object') continue;
      const attUrl = att.url || att.href || att.localUrl;
      const attLocal = resolveLocalPath(attUrl);
      if (attLocal) {
        return { kind: 'photo', localPath: attLocal, filename: path.basename(attLocal) };
      }
      if (attUrl && /^https?:\/\//i.test(attUrl)) {
        return { kind: 'photo', url: attUrl };
      }
    }
  }

  // 3. TIN NHẮN THOẠI (VOICE / AUDIO)
  if (
    cType === 'voice' ||
    cType === 'audio' ||
    parsed?.voiceUrl ||
    parsed?.action === 'voice' ||
    params?.waveformSamples ||
    params?.m4a ||
    /\.(?:aac|mp3|m4a|wav|ogg|opus)(?:\?.*)?$/i.test(trimmed)
  ) {
    const voiceCandidate =
      parsed?.voiceUrl ||
      params?.m4a ||
      parsed?.localUrl ||
      parsed?.href ||
      parsed?.url ||
      (trimmed.startsWith('http') || trimmed.startsWith('/') ? trimmed : null);

    const localVoice = resolveLocalPath(voiceCandidate);
    if (localVoice) {
      return { kind: 'voice', localPath: localVoice, filename: path.basename(localVoice) };
    }
    if (voiceCandidate && /^https?:\/\//i.test(voiceCandidate)) {
      return { kind: 'voice', url: voiceCandidate };
    }

    for (const att of attList) {
      if (!att || typeof att !== 'object') continue;
      if (att.type === 'voice' || att.type === 'audio' || /\.(?:aac|mp3|m4a|wav|ogg|opus)/i.test(att.url || att.href || '')) {
        const attLocal = resolveLocalPath(att.localUrl || att.url || att.href);
        if (attLocal) return { kind: 'voice', localPath: attLocal, filename: path.basename(attLocal) };
        const u = att.url || att.href;
        if (u && /^https?:\/\//i.test(u)) return { kind: 'voice', url: u };
      }
    }
  }

  // 4. VIDEO
  if (cType === 'video' || parsed?.videoUrl || params?.videoUrl || /\.(?:mp4|mov|avi|webm)(?:\?.*)?$/i.test(trimmed)) {
    const videoCandidate =
      parsed?.videoUrl ||
      params?.videoUrl ||
      params?.streamUrl ||
      parsed?.localUrl ||
      parsed?.href ||
      parsed?.url ||
      (trimmed.startsWith('http') || trimmed.startsWith('/') ? trimmed : null);

    const localVid = resolveLocalPath(videoCandidate);
    if (localVid) {
      return { kind: 'video', localPath: localVid, filename: path.basename(localVid) };
    }
    if (videoCandidate && /^https?:\/\//i.test(videoCandidate)) {
      return { kind: 'video', url: videoCandidate };
    }
  }

  // 5. TẬP TIN / TÀI LIỆU (DOCUMENT / FILE)
  if (
    cType === 'file' ||
    cType === 'doc' ||
    params?.fileExt ||
    params?.fType === 1 ||
    /\.(?:pdf|docx?|xlsx?|pptx?|zip|rar|7z|txt|csv)(?:\?.*)?$/i.test(trimmed)
  ) {
    const fileCandidate =
      parsed?.href ||
      parsed?.localUrl ||
      parsed?.url ||
      (trimmed.startsWith('http') || trimmed.startsWith('/') ? trimmed : null);

    const docName = parsed?.title || parsed?.fileName || parsed?.name || (fileCandidate ? path.basename(fileCandidate) : 'tai_lieu');
    const localDoc = resolveLocalPath(fileCandidate);
    if (localDoc) {
      return { kind: 'document', localPath: localDoc, filename: docName };
    }
    if (fileCandidate && /^https?:\/\//i.test(fileCandidate)) {
      return { kind: 'document', url: fileCandidate, filename: docName };
    }
  }

  return { kind: 'none' };
}

/**
 * Gửi một mục đa phương tiện (Ảnh, Sticker, Voice, Video, File) đến 1 Chat ID Telegram
 */
export async function sendMediaToChat(
  botToken: string,
  chatId: string,
  media: ExtractedMedia,
  caption: string
): Promise<boolean> {
  const safeCaption = caption.length > 1000 ? `${caption.slice(0, 995)}...` : caption;

  try {
    // 1. PHOTO HOẶC STICKER
    if (media.kind === 'photo') {
      const fd = new FormData();
      fd.append('chat_id', chatId);
      fd.append('caption', safeCaption);

      if (media.localPath && fs.existsSync(media.localPath)) {
        const fileBuf = await fs.promises.readFile(media.localPath);
        const ext = path.extname(media.localPath).toLowerCase();
        const mime = ext === '.webp' ? 'image/webp' : ext === '.png' ? 'image/png' : 'image/jpeg';
        fd.append('photo', new Blob([fileBuf], { type: media.mimeType || mime }), media.filename || path.basename(media.localPath));
      } else if (media.url) {
        fd.append('photo', media.url);
      } else {
        return false;
      }

      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
        method: 'POST',
        body: fd,
        signal: AbortSignal.timeout(15000),
      });

      const json: any = await res.json().catch(() => null);
      if (res.ok && json?.ok) {
        logger.info(`[telegram-notification] Sent photo alert to ${chatId} successfully`);
        return true;
      }

      // Nếu gửi URL trực tiếp thất bại do Telegram server không tải được, thử tải buffer nội bộ rồi gửi
      if (media.url && (!res.ok || !json?.ok)) {
        try {
          const fetchRes = await fetch(media.url, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(7000),
          });
          if (fetchRes.ok) {
            const buf = Buffer.from(await fetchRes.arrayBuffer());
            if (buf.length > 0 && buf.length <= 10 * 1024 * 1024) {
              const retryFd = new FormData();
              retryFd.append('chat_id', chatId);
              const mime = media.mimeType || (media.url.includes('webpc') || media.url.includes('.webp') ? 'image/webp' : 'image/jpeg');
              retryFd.append('photo', new Blob([buf], { type: mime }), media.filename || 'photo.jpg');
              retryFd.append('caption', safeCaption);
              const retryRes = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
                method: 'POST',
                body: retryFd,
                signal: AbortSignal.timeout(15000),
              });
              const retryJson: any = await retryRes.json().catch(() => null);
              if (retryRes.ok && retryJson?.ok) {
                logger.info(`[telegram-notification] Sent buffered photo alert to ${chatId} successfully`);
                return true;
              }
            }
          }
        } catch (bufErr) {
          logger.warn('[telegram-notification] Retry downloading media buffer failed:', bufErr);
        }
      }

      logger.warn(`[telegram-notification] sendPhoto to ${chatId} failed:`, json);
      return false;
    }

    // 2. TIN NHẮN THOẠI (VOICE / AUDIO)
    if (media.kind === 'voice') {
      let rawBuffer: Buffer | null = null;
      const rawPath = media.localPath;

      if (!rawPath && media.url) {
        try {
          const fetchRes = await fetch(media.url, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(10000),
          });
          if (fetchRes.ok) {
            rawBuffer = Buffer.from(await fetchRes.arrayBuffer());
          }
        } catch (fetchErr) {
          logger.warn('[telegram-notification] Failed to download voice URL for transcoding:', fetchErr);
        }
      }

      // Tự động chuyển mã âm thanh sang chuẩn Telegram Ogg Opus và MP3
      const { oggPath, mp3Path, cleanup } = await transcodeAudioForTelegram(
        rawBuffer || rawPath || '',
        media.filename || 'voice.ogg'
      );

      try {
        // Ưu tiên 1: Gửi dạng Voice Note chuẩn (Ogg Opus 48kHz Mono)
        if (oggPath && fs.existsSync(oggPath)) {
          const fd = new FormData();
          fd.append('chat_id', chatId);
          fd.append('caption', safeCaption);
          const oggBuf = await fs.promises.readFile(oggPath);
          fd.append('voice', new Blob([oggBuf], { type: 'audio/ogg' }), 'voice.ogg');

          const res = await fetch(`https://api.telegram.org/bot${botToken}/sendVoice`, {
            method: 'POST',
            body: fd,
            signal: AbortSignal.timeout(15000),
          });
          const json: any = await res.json().catch(() => null);
          if (res.ok && json?.ok) {
            logger.info(`[telegram-notification] Sent transcoded voice note to ${chatId} successfully`);
            return true;
          }
        }

        // Ưu tiên 2: Gửi dạng Audio MP3 (tương thích 100% mọi trình phát trên iOS/Android/PC)
        if (mp3Path && fs.existsSync(mp3Path)) {
          const audioFd = new FormData();
          audioFd.append('chat_id', chatId);
          audioFd.append('caption', safeCaption);
          audioFd.append('title', 'Tin nhắn thoại khách hàng');
          audioFd.append('performer', 'Zalo/WhatsApp CRM');
          const mp3Buf = await fs.promises.readFile(mp3Path);
          audioFd.append('audio', new Blob([mp3Buf], { type: 'audio/mpeg' }), 'voice.mp3');

          const res = await fetch(`https://api.telegram.org/bot${botToken}/sendAudio`, {
            method: 'POST',
            body: audioFd,
            signal: AbortSignal.timeout(15000),
          });
          const json: any = await res.json().catch(() => null);
          if (res.ok && json?.ok) {
            logger.info(`[telegram-notification] Sent transcoded MP3 audio to ${chatId} successfully`);
            return true;
          }
        }

        // Fallback khi không có ffmpeg: gửi trực tiếp file gốc
        if (rawPath && fs.existsSync(rawPath)) {
          const directFd = new FormData();
          directFd.append('chat_id', chatId);
          directFd.append('caption', safeCaption);
          const buf = await fs.promises.readFile(rawPath);
          directFd.append('voice', new Blob([buf], { type: 'audio/ogg' }), 'voice.ogg');
          const res = await fetch(`https://api.telegram.org/bot${botToken}/sendVoice`, {
            method: 'POST',
            body: directFd,
            signal: AbortSignal.timeout(15000),
          });
          const json: any = await res.json().catch(() => null);
          if (res.ok && json?.ok) return true;
        }
      } finally {
        await cleanup();
      }

      return false;
    }

    // 3. VIDEO
    if (media.kind === 'video') {
      const fd = new FormData();
      fd.append('chat_id', chatId);
      fd.append('caption', safeCaption);

      if (media.localPath && fs.existsSync(media.localPath)) {
        const fileBuf = await fs.promises.readFile(media.localPath);
        fd.append('video', new Blob([fileBuf], { type: 'video/mp4' }), media.filename || path.basename(media.localPath));
      } else if (media.url) {
        fd.append('video', media.url);
      } else {
        return false;
      }

      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendVideo`, {
        method: 'POST',
        body: fd,
        signal: AbortSignal.timeout(30000),
      });
      const json: any = await res.json().catch(() => null);
      if (res.ok && json?.ok) {
        logger.info(`[telegram-notification] Sent video alert to ${chatId} successfully`);
        return true;
      }
      return false;
    }

    // 4. DOCUMENT / FILE
    if (media.kind === 'document') {
      const fd = new FormData();
      fd.append('chat_id', chatId);
      fd.append('caption', safeCaption);

      if (media.localPath && fs.existsSync(media.localPath)) {
        const fileBuf = await fs.promises.readFile(media.localPath);
        fd.append('document', new Blob([fileBuf]), media.filename || path.basename(media.localPath));
      } else if (media.url) {
        fd.append('document', media.url);
      } else {
        return false;
      }

      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
        method: 'POST',
        body: fd,
        signal: AbortSignal.timeout(20000),
      });
      const json: any = await res.json().catch(() => null);
      if (res.ok && json?.ok) {
        logger.info(`[telegram-notification] Sent document alert to ${chatId} successfully`);
        return true;
      }
      return false;
    }
  } catch (err) {
    logger.warn(`[telegram-notification] Exception sending media alert to ${chatId}:`, err);
  }

  return false;
}

/**
 * Lấy cấu hình Telegram (Token, Chat ID, Enabled)
 */
export async function getTelegramConfig(orgId?: string | null) {
  let botToken = process.env.TELEGRAM_BOT_TOKEN || BUILTIN_BOT_TOKEN;
  let chatId = process.env.TELEGRAM_CHAT_ID || BUILTIN_CHAT_ID;
  let enabled = true;

  try {
    if (orgId) {
      const [tokenSetting, chatSetting, enabledSetting] = await Promise.all([
        prisma.appSetting.findFirst({ where: { orgId, settingKey: 'telegram_bot_token' } }),
        prisma.appSetting.findFirst({ where: { orgId, settingKey: 'telegram_chat_id' } }),
        prisma.appSetting.findFirst({ where: { orgId, settingKey: 'telegram_alert_enabled' } }),
      ]);

      if (tokenSetting?.valuePlain && tokenSetting.valuePlain.trim()) {
        botToken = tokenSetting.valuePlain.trim();
      }
      if (chatSetting?.valuePlain && chatSetting.valuePlain.trim()) {
        chatId = chatSetting.valuePlain.trim();
      }
      if (enabledSetting?.valuePlain !== undefined && enabledSetting?.valuePlain !== null) {
        const val = enabledSetting.valuePlain.trim().toLowerCase();
        if (val === 'false' || val === '0' || val === 'off') {
          enabled = false;
        }
      }
    }
  } catch (err) {
    logger.warn('[telegram-notification] Error loading app settings, using environment fallback:', err);
  }

  return { botToken, chatId, enabled };
}

/**
 * Gửi tin nhắn đến một hoặc nhiều Telegram Chat ID
 */
export async function sendTelegramDirect(botToken: string, chatIdOrList: string, text: string): Promise<boolean> {
  if (!botToken || !chatIdOrList) return false;

  const chatIds = chatIdOrList
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (chatIds.length === 0) return false;

  // Giới hạn độ dài tin nhắn để không vượt quá giới hạn 4096 ký tự của Telegram
  const safeText = text.length > 4000 ? `${text.slice(0, 3995)}...` : text;

  let allSuccess = true;

  for (const cid of chatIds) {
    try {
      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: cid,
          text: safeText,
        }),
        signal: AbortSignal.timeout(10000),
      });

      const json: any = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        logger.error(`[telegram-notification] Failed to send message to chat_id ${cid}:`, json);
        allSuccess = false;
      } else {
        logger.info(`[telegram-notification] Sent alert to Telegram chat ${cid} successfully`);
      }
    } catch (e) {
      logger.error(`[telegram-notification] Network error sending to chat_id ${cid}:`, e);
      allSuccess = false;
    }
  }

  return allSuccess;
}

/**
 * Gửi thông báo đến Telegram Bot khi có khách hàng nhắn tin mới đến Zalo / WhatsApp.
 * Tự động gửi kèm ảnh trực tiếp, sticker, file ghi âm giọng nói chuẩn (Ogg Opus + MP3), video, tài liệu lên Telegram!
 * 
 * Cú pháp chuẩn theo yêu cầu:
 * Khách: [Tên khách] từ [tên thương hiệu mà khách đang nhắn đến] 
 * Nội dung: [Nội dung của khách nhắn đến]
 */
export function sendTelegramCustomerAlert(params: TelegramCustomerAlertParams): void {
  // Fire-and-forget: không chặn luồng xử lý nhận tin nhắn chính
  Promise.resolve().then(async () => {
    try {
      const { botToken, chatId, enabled } = await getTelegramConfig(params.orgId);
      if (!enabled) {
        return;
      }

      const brand = resolveBrandName(params.accountDisplayName, params.brandName);
      const customer = (params.customerName || 'Khách hàng').trim();
      const snippet = formatMessageSnippet(params.content, params.contentType);

      // Cú pháp chuẩn tuyệt đối theo yêu cầu của user:
      // Khách: [Tên khách] từ [tên thương hiệu mà khách đang nhắn đến] 
      // Nội dung: [Nội dung của khách nhắn đến]
      const text = `Khách: ${customer} từ ${brand}\nNội dung: ${snippet}`;

      const chatIds = chatId
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      if (chatIds.length === 0) return;

      const media = extractTelegramMedia(params.content, params.contentType, params.attachments);

      for (const cid of chatIds) {
        let sent = false;

        // Nếu có đa phương tiện (ảnh, nhãn dán, giọng nói, video, tập tin) -> Gửi trực tiếp media kèm caption
        if (media.kind !== 'none') {
          sent = await sendMediaToChat(botToken, cid, media, text);
        }

        // Nếu không có media HOẶC việc gửi media thất bại -> Tự động fallback gửi dạng text chuẩn
        if (!sent) {
          await sendTelegramDirect(botToken, cid, text);
        }
      }
    } catch (err) {
      logger.error('[telegram-notification] sendTelegramCustomerAlert unhandled error:', err);
    }
  });
}
