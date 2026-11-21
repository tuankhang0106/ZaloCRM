/**
 * chat-routes.ts — REST API for conversations and messages.
 * All routes require JWT auth and are scoped to the user's org.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { requireZaloAccess } from '../zalo/zalo-access-middleware.js';
import { zaloPool } from '../zalo/zalo-pool.js';
import { whatsappPool } from '../whatsapp/whatsapp-pool.js';
import { zaloRateLimiter } from '../zalo/zalo-rate-limiter.js';
import { logger } from '../../shared/utils/logger.js';
import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../config/index.js';
import type { Server } from 'socket.io';
import {
  detectImageFormatFromBuffer,
  shouldIgnoreWhatsAppCaption,
  extractConversationAssets,
  type ExtractedMedia,
  type ExtractedFile,
  type ExtractedLink,
} from '../whatsapp/whatsapp-media-helpers.js';
import {
  sanitizeUploadExtension,
  buildContentDisposition,
  validateZaloProxyUrl,
  detectUploadMediaKind,
} from './chat-file-helpers.js';
import {
  normalizeTone,
  normalizeTargetLanguage,
  extractChatContextFromMessages,
  buildChatAiDraftPrompts,
  buildChatAiSuggestPrompts,
  extractJsonObject,
  buildFallbackDraft,
  buildFallbackSuggestions,
} from './chat-ai-helpers.js';

type QueryParams = Record<string, string>;

const MAX_REMOTE_PROXY_BYTES = 100 * 1024 * 1024;

function isValidBridgeToken(request: FastifyRequest): boolean {
  const rawExpected = process.env.PORTAL_BRIDGE_TOKEN || '';
  const headerVal = request.headers['x-portal-bridge-token'];
  const rawProvided = typeof headerVal === 'string' ? headerVal : '';
  if (!rawExpected || !rawProvided) return false;
  const expected = Buffer.from(rawExpected, 'utf8');
  const provided = Buffer.from(rawProvided, 'utf8');
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

async function resolveSafeLocalFilePath(rawUrlOrName: string): Promise<string | null> {
  if (!rawUrlOrName || rawUrlOrName.includes('\0') || rawUrlOrName.includes('..')) return null;
  const stripped = rawUrlOrName.split('?')[0].split('#')[0];
  let cleanName = path.basename(stripped);
  try {
    cleanName = decodeURIComponent(cleanName);
  } catch {
    return null;
  }
  if (!cleanName || cleanName === '.' || cleanName === '..' || /[\\/\0]/.test(cleanName)) {
    return null;
  }

  const candidateDirs = [
    path.resolve(getChatStorageDir()),
    path.resolve(path.join(path.resolve(config.uploadDir), 'media')),
    path.resolve(config.uploadDir),
  ];

  for (const baseDir of candidateDirs) {
    const resolved = path.resolve(baseDir, cleanName);
    if (!resolved.startsWith(baseDir + path.sep)) continue;
    try {
      const st = await fs.promises.stat(resolved);
      if (st.isFile()) return resolved;
    } catch {}
  }

  return null;
}

async function hasOrgFileAccess(cleanName: string, orgId: string): Promise<boolean> {
  if (!cleanName || !orgId) return false;
  if (cleanName.startsWith(`zcache_${orgId}_`)) return true;

  const [mediaItem, msgMatch, contactMatch, accountMatch] = await Promise.all([
    prisma.mediaItem.findFirst({
      where: { orgId, url: { contains: cleanName } },
      select: { id: true },
    }).catch(() => null),
    prisma.$queryRaw<Array<{ id: string }>>`
      SELECT m.id FROM messages m
      INNER JOIN conversations c ON c.id = m.conversation_id
      WHERE c.org_id = ${orgId}
        AND (STRPOS(COALESCE(m.content, ''), ${cleanName}) > 0 OR STRPOS(m.attachments::text, ${cleanName}) > 0)
      LIMIT 1
    `.catch(() => []),
    prisma.contact.findFirst({
      where: { orgId, avatarUrl: { contains: cleanName } },
      select: { id: true },
    }).catch(() => null),
    prisma.zaloAccount.findFirst({
      where: { orgId, avatarUrl: { contains: cleanName } },
      select: { id: true },
    }).catch(() => null),
  ]);

  return Boolean(mediaItem || (msgMatch && msgMatch.length > 0) || contactMatch || accountMatch);
}

function getSafeServeMimeType(filename: string, upstreamMime?: string): string {
  const ext = path.extname(filename).toLowerCase().replace('.', '');
  const mimeTypes: Record<string, string> = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    bmp: 'image/bmp',
    txt: 'text/plain; charset=utf-8',
    csv: 'text/csv; charset=utf-8',
    rtf: 'application/rtf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    zip: 'application/zip',
    rar: 'application/x-rar-compressed',
    ogg: 'audio/ogg',
    opus: 'audio/ogg',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    wav: 'audio/wav',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
  };
  if (ext && mimeTypes[ext]) return mimeTypes[ext];
  const lower = (upstreamMime || '').toLowerCase();
  if (lower.includes('svg') || lower.includes('html') || lower.includes('javascript')) {
    return 'application/octet-stream';
  }
  return upstreamMime || 'application/octet-stream';
}

async function optimizeImageForSend(
  fileBuffer: Buffer,
  fileName: string,
  fileExt: string,
): Promise<{ buffer: Buffer; fileName: string; fileExt: string; width: number; height: number }> {
  let width = 800;
  let height = 600;
  let nextBuffer = fileBuffer;
  let nextName = fileName;
  let nextExt = fileExt;

  try {
    if (fileBuffer.length > 1024 * 1024 && fileExt !== 'gif') {
      const pipeline = sharp(fileBuffer)
        .rotate()
        .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true });

      let formatted;
      let outExt = 'jpg';
      if (fileExt === 'png') {
        formatted = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true, palette: true });
        outExt = 'png';
      } else if (fileExt === 'webp') {
        formatted = pipeline.webp({ quality: 82 });
        outExt = 'webp';
      } else {
        formatted = pipeline.flatten({ background: '#ffffff' }).jpeg({ quality: 82, progressive: true });
        outExt = 'jpg';
      }

      const { data, info } = await formatted.toBuffer({ resolveWithObject: true });
      if (data.length < fileBuffer.length) {
        nextBuffer = data;
        if (outExt === 'jpg' && !nextName.toLowerCase().endsWith('.jpg') && !nextName.toLowerCase().endsWith('.jpeg')) {
          nextName = nextName.replace(/\.[^.]+$/, '') + '.jpg';
          nextExt = 'jpg';
        }
        width = info.width || width;
        height = info.height || height;
      } else {
        width = info.width || width;
        height = info.height || height;
      }
    } else {
      const meta = await sharp(fileBuffer).metadata();
      if (meta.width) width = meta.width;
      if (meta.height) height = meta.height;
    }
  } catch (sharpErr) {
    logger.warn('[chat] Image sharp optimization fallback:', sharpErr);
  }

  return { buffer: nextBuffer, fileName: nextName, fileExt: nextExt, width, height };
}

function getChatStorageDir(): string {
  if (process.env.CHAT_FILES_STORAGE_DIR && fs.existsSync(process.env.CHAT_FILES_STORAGE_DIR)) {
    return process.env.CHAT_FILES_STORAGE_DIR;
  }
  const laravelStorage = path.resolve(process.cwd(), '../../storage/app/public/chat_files');
  try {
    if (!fs.existsSync(laravelStorage)) {
      fs.mkdirSync(laravelStorage, { recursive: true });
    }
    return laravelStorage;
  } catch {}
  const fallback = path.resolve(process.cwd(), 'public/chat_files');
  try {
    if (!fs.existsSync(fallback)) {
      fs.mkdirSync(fallback, { recursive: true });
    }
    return fallback;
  } catch {}
  return path.resolve(process.cwd(), 'uploads');
}

async function saveChatFileBuffer(
  fileBuffer: Buffer,
  originalName: string,
): Promise<{ localUrl: string; savedFilename: string; filePath: string }> {
  const dir = getChatStorageDir();
  const { ext, baseName } = sanitizeUploadExtension(originalName);
  const savedFilename = `${Date.now()}_${randomUUID().slice(0, 8)}_${baseName}${ext}`;
  const filePath = path.join(dir, savedFilename);
  await fs.promises.writeFile(filePath, fileBuffer);
  return {
    localUrl: `/storage/chat_files/${savedFilename}`,
    savedFilename,
    filePath,
  };
}

function extractZaloMsgDetails(res: any): { zaloMsgId: string | null; cliMsgId: string | null } {
  if (!res) return { zaloMsgId: null, cliMsgId: null };
  const rawMsg = res.message || res;
  const rawAtt = Array.isArray(res.attachment) && res.attachment.length > 0 ? res.attachment[0] : null;

  const rawMsgId =
    rawMsg?.msgId ||
    rawMsg?.messageId ||
    rawMsg?.id ||
    rawMsg?.data?.msgId ||
    rawMsg?.data?.messageId ||
    rawAtt?.msgId ||
    rawAtt?.messageId ||
    rawAtt?.id ||
    rawAtt?.data?.msgId ||
    rawAtt?.data?.messageId ||
    res?.msgId ||
    res?.messageId ||
    res?.id ||
    null;

  const rawCliId =
    rawMsg?.cliMsgId ||
    rawMsg?.data?.cliMsgId ||
    rawAtt?.cliMsgId ||
    rawAtt?.data?.cliMsgId ||
    res?.cliMsgId ||
    null;

  return {
    zaloMsgId: rawMsgId ? String(rawMsgId) : null,
    cliMsgId: rawCliId ? String(rawCliId) : null,
  };
}

export async function chatRoutes(app: FastifyInstance) {
  async function authenticateFileRequest(
    request: FastifyRequest,
  ): Promise<{ authorized: true; isBridge: boolean; user?: any } | { authorized: false }> {
    if (isValidBridgeToken(request)) {
      return { authorized: true, isBridge: true };
    }
    const authHeader = request.headers.authorization;
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const queryToken = (request.query as { token?: string } | undefined)?.token;
    const effectiveToken = bearerToken || queryToken;
    if (!effectiveToken) return { authorized: false };
    try {
      const decoded = await app.jwt.verify(effectiveToken);
      return { authorized: true, isBridge: false, user: decoded };
    } catch {
      return { authorized: false };
    }
  }

  async function proxyRemoteZaloFile(opts: {
    url: string;
    accountId?: string | null;
    orgId: string;
    mode?: string;
    filename?: string;
    reply: FastifyReply;
  }) {
    const { url, accountId, orgId, mode, filename, reply } = opts;

    const urlCheck = await validateZaloProxyUrl(url);
    if (!urlCheck.ok) {
      return reply.status(urlCheck.status).send({ error: urlCheck.reason });
    }

    if (!accountId) {
      return reply.status(400).send({ error: 'URL and accountId required' });
    }

    const acc = await prisma.zaloAccount.findFirst({
      where: { id: accountId, orgId },
      select: { id: true },
    });
    if (!acc) {
      return reply.status(403).send({ error: 'Forbidden: Tài khoản không thuộc tổ chức của bạn' });
    }

    const dir = getChatStorageDir();
    const urlHash = createHash('sha256').update(url).digest('hex').slice(0, 32);
    const cachedFilePath = path.join(dir, `zcache_${orgId}_${urlHash}.dat`);
    const cachedMetaPath = path.join(dir, `zcache_${orgId}_${urlHash}.json`);

    try {
      const cachedStat = await fs.promises.stat(cachedFilePath);
      if (cachedStat.isFile()) {
        let cachedMeta: any = {};
        try {
          cachedMeta = JSON.parse(await fs.promises.readFile(cachedMetaPath, 'utf8'));
        } catch {}

        const effectiveName = filename || cachedMeta.filename || 'document';
        const contentType = getSafeServeMimeType(effectiveName, cachedMeta.contentType);
        reply.header('Content-Type', contentType);
        reply.header('Cache-Control', 'private, max-age=86400, no-transform');
        reply.header('Content-Disposition', buildContentDisposition(mode, effectiveName));
        return fs.createReadStream(cachedFilePath);
      }
    } catch {}

    const instance = zaloPool.getInstance(accountId);
    if (!instance?.api) {
      return reply.status(400).send({ error: 'Zalo account not connected' });
    }

    try {
      const context = instance.api.getContext();
      let currentUrl = urlCheck.url;
      let response: Response | null = null;

      for (let hops = 0; hops < 4; hops++) {
        const hostAllowedCookie = /(?:^|\.)zalo\.me$/i.test(currentUrl.hostname);
        const cookieString = hostAllowedCookie
          ? await context.cookie.getCookieString(currentUrl.toString()).catch(() => '')
          : '';

        const res = await fetch(currentUrl.toString(), {
          redirect: 'manual',
          signal: AbortSignal.timeout(30000),
          headers: {
            ...(cookieString ? { Cookie: cookieString } : {}),
            Referer: 'https://chat.zalo.me/',
            Origin: 'https://chat.zalo.me',
            'User-Agent': context.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            Accept: '*/*',
            'Accept-Encoding': 'gzip, deflate, br',
          },
        });

        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get('location');
          if (!location) {
            return reply.status(502).send({ error: 'Chuyển hướng không hợp lệ từ Zalo CDN' });
          }
          const nextRaw = new URL(location, currentUrl).toString();
          const redirectCheck = await validateZaloProxyUrl(nextRaw);
          if (!redirectCheck.ok) {
            return reply.status(redirectCheck.status).send({ error: redirectCheck.reason });
          }
          currentUrl = redirectCheck.url;
          continue;
        }

        response = res;
        break;
      }

      if (!response) {
        return reply.status(502).send({ error: 'Quá nhiều chuyển hướng khi tải tệp từ Zalo' });
      }
      if (!response.ok) {
        return reply.status(502).send({ error: `Failed to fetch file from Zalo, status: ${response.status}` });
      }

      const contentLen = Number(response.headers.get('content-length') || 0);
      if (contentLen > MAX_REMOTE_PROXY_BYTES) {
        return reply.status(413).send({ error: 'Tệp vượt quá giới hạn dung lượng 100MB' });
      }

      const rawContentType = response.headers.get('content-type') || 'application/octet-stream';
      const dispHeader = response.headers.get('content-disposition') || '';
      const effectiveFilename =
        filename ||
        dispHeader.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)?.[1]?.replace(/['"]/g, '') ||
        'document';

      let contentType = getSafeServeMimeType(effectiveFilename, rawContentType);
      if (effectiveFilename.toLowerCase().endsWith('.pdf') || url.toLowerCase().includes('.pdf')) {
        contentType = 'application/pdf';
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > MAX_REMOTE_PROXY_BYTES) {
        return reply.status(413).send({ error: 'Tệp vượt quá giới hạn dung lượng 100MB' });
      }

      reply.header('Content-Type', contentType);
      reply.header('Cache-Control', 'private, max-age=86400, no-transform');
      reply.header('Content-Disposition', buildContentDisposition(mode, effectiveFilename));

      try {
        await Promise.all([
          fs.promises.writeFile(cachedFilePath, buffer),
          fs.promises.writeFile(cachedMetaPath, JSON.stringify({ contentType, filename: effectiveFilename })),
        ]);
      } catch (cacheErr) {
        logger.warn('[chat] Cache write error:', cacheErr);
      }

      return buffer;
    } catch (err: any) {
      logger.error('[chat] File download proxy error:', err);
      return reply.status(500).send({ error: `Không thể tải file: ${err.message}` });
    }
  }

  // ── Raw file streaming for local chat uploads ─────────────────────────────
  app.get('/api/v1/files/raw/:filename', { preHandler: authMiddleware }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { filename } = request.params as { filename: string };
    if (!filename || filename.includes('..') || /[\\/\0]/.test(filename)) {
      return reply.status(404).send({ error: 'File not found' });
    }

    const cleanName = path.basename(filename);
    const dir = path.resolve(getChatStorageDir());
    const filePath = path.resolve(dir, cleanName);
    if (!filePath.startsWith(dir + path.sep)) {
      return reply.status(404).send({ error: 'File not found' });
    }

    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(filePath);
    } catch {
      return reply.status(404).send({ error: 'File not found' });
    }
    if (!stat.isFile()) {
      return reply.status(404).send({ error: 'File not found' });
    }

    const allowed = await hasOrgFileAccess(cleanName, user.orgId);
    if (!allowed) {
      return reply.status(404).send({ error: 'File not found' });
    }

    reply.header('Content-Type', getSafeServeMimeType(cleanName));
    reply.header('Cache-Control', 'private, max-age=86400, no-transform');
    reply.header('Content-Disposition', buildContentDisposition('view', cleanName));
    return fs.createReadStream(filePath);
  });

  // ── Proxy file downloads & quick-views from Zalo servers ──────────────────
  app.get('/api/v1/files/download', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await authenticateFileRequest(request);
    if (!auth.authorized) {
      return reply.status(401).send({ error: 'Unauthorized: Token required' });
    }

    const { url, accountId, mode, filename } = request.query as {
      url?: string;
      accountId?: string;
      token?: string;
      mode?: string;
      filename?: string;
    };

    if (!url) {
      return reply.status(400).send({ error: 'URL required' });
    }

    // Check if URL references a local stored file
    if (
      url.startsWith('/storage/chat_files/') ||
      url.includes('chat_files/') ||
      url.includes('/files/raw/') ||
      url.startsWith('/uploads/') ||
      url.includes('/uploads/') ||
      url.startsWith('/api/zalo-assets/') ||
      url.includes('/api/zalo-assets/')
    ) {
      const localPath = await resolveSafeLocalFilePath(url);
      if (!localPath) {
        return reply.status(404).send({ error: 'File not found' });
      }
      const cleanName = path.basename(localPath);
      if (!auth.isBridge) {
        const allowed = await hasOrgFileAccess(cleanName, auth.user.orgId);
        if (!allowed) {
          return reply.status(403).send({ error: 'Forbidden' });
        }
      }

      const effectiveName = filename || cleanName;
      reply.header('Content-Type', getSafeServeMimeType(cleanName));
      reply.header('Cache-Control', 'private, max-age=86400, no-transform');
      reply.header('Content-Disposition', buildContentDisposition(mode, effectiveName));
      return fs.createReadStream(localPath);
    }

    if (auth.isBridge || !auth.user?.orgId) {
      return reply.status(401).send({ error: 'Unauthorized: User JWT required for remote download' });
    }

    return await proxyRemoteZaloFile({
      url,
      accountId,
      orgId: auth.user.orgId,
      mode,
      filename,
      reply,
    });
  });

  // ── Stream / Download file directly associated with a DB Message ──────────
  app.get('/api/v1/files/message-file/:messageId', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await authenticateFileRequest(request);
    if (!auth.authorized) {
      return reply.status(401).send({ error: 'Unauthorized: Token required' });
    }

    const { messageId } = request.params as { messageId: string };
    const { mode, filename } = request.query as { mode?: string; filename?: string };

    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: { conversation: { include: { zaloAccount: true } } },
    });
    if (!message) return reply.status(404).send({ error: 'Message not found' });

    if (!auth.isBridge) {
      if (!auth.user?.orgId || message.conversation?.orgId !== auth.user.orgId) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
      if (auth.user.role === 'member' && message.conversation?.zaloAccountId) {
        const access = await prisma.zaloAccountAccess.findFirst({
          where: { zaloAccountId: message.conversation.zaloAccountId, userId: auth.user.id },
          select: { id: true },
        });
        if (!access) {
          return reply.status(403).send({ error: 'Chưa được phân quyền tài khoản này' });
        }
      }
    }

    let fileUrl = '';
    let fileName = filename || '';
    let parsedContentJson: any = null;

    // 1. Check content JSON
    if (typeof message.content === 'string' && message.content.trim().startsWith('{')) {
      try {
        const p = JSON.parse(message.content);
        parsedContentJson = p;
        fileUrl =
          p.localUrl ||
          p.href ||
          p.fileUrl ||
          p.voiceUrl ||
          p.videoUrl ||
          p.hdUrl ||
          p.normalUrl ||
          p.url ||
          p.thumb ||
          '';
        const candidateName = p.fileName || (!shouldIgnoreWhatsAppCaption(p.title) ? p.title : '');
        if (!fileName && candidateName) fileName = String(candidateName).trim();
      } catch {}
    } else if (typeof message.content === 'string') {
      const trimmed = message.content.trim();
      if (
        trimmed.startsWith('/storage/') ||
        trimmed.startsWith('/uploads/') ||
        trimmed.startsWith('/api/zalo-assets/') ||
        trimmed.startsWith('http://') ||
        trimmed.startsWith('https://')
      ) {
        fileUrl = trimmed;
      }
    }

    // 2. Check attachments (skip metadata-only items)
    const existingAtts = Array.isArray(message.attachments) ? (message.attachments as any[]) : [];
    if (!fileUrl && existingAtts.length > 0) {
      const att = existingAtts.find(
        (a: any) => a && a.type !== 'zalo_meta' && a.type !== 'reaction' && (a.localUrl || a.url || a.fileUrl || a.href),
      );
      if (att) {
        fileUrl = att.localUrl || att.url || att.fileUrl || att.href || '';
        if (!fileName) fileName = att.name || att.fileName || '';
      }
    }

    // 3. Fallback: if message is plain filename string (never placeholder / JSON)
    if (!fileName && typeof message.content === 'string' && !shouldIgnoreWhatsAppCaption(message.content)) {
      fileName = message.content.trim();
    }

    const mediaDir = path.join(path.resolve(config.uploadDir), 'media');
    const isWhatsAppMsg =
      message.conversation?.channel === 'whatsapp' ||
      (message.conversation as any)?.zaloAccount?.channel === 'whatsapp';

    const sendLocalFile = (targetPath: string, downloadName?: string) => {
      const base = path.basename(targetPath);
      const effectiveName = downloadName || fileName || base;
      reply.header('Content-Type', getSafeServeMimeType(base));
      reply.header('Cache-Control', 'private, max-age=86400, no-transform');
      reply.header('Content-Disposition', buildContentDisposition(mode, effectiveName));
      return fs.createReadStream(targetPath);
    };

    // 4. Resolve local file on disk
    let existingLocalPath: string | null = null;
    let existingLocalSize = 0;

    if (fileUrl) {
      existingLocalPath = await resolveSafeLocalFilePath(fileUrl);
      if (existingLocalPath) {
        try {
          existingLocalSize = (await fs.promises.stat(existingLocalPath)).size;
        } catch {}
      }
    }

    const isSuspiciousTinyWaJpg =
      isWhatsAppMsg &&
      existingLocalPath !== null &&
      /\.(jpe?g)$/i.test(existingLocalPath) &&
      existingLocalSize > 0 &&
      existingLocalSize < 12000 &&
      !fileUrl.startsWith('/storage/') &&
      !fileUrl.includes('chat_files/');

    if (existingLocalPath && !isSuspiciousTinyWaJpg) {
      return sendLocalFile(existingLocalPath);
    }

    // 5. If it's a remote URL from Zalo — proxy inline instead of redirecting and losing Authorization
    if (!existingLocalPath && fileUrl && (fileUrl.startsWith('http://') || fileUrl.startsWith('https://'))) {
      return await proxyRemoteZaloFile({
        url: fileUrl,
        accountId: message.conversation?.zaloAccountId,
        orgId: message.conversation.orgId,
        mode,
        filename: fileName || 'file',
        reply,
      });
    }

    // 6. On-demand download (or tiny-thumb upgrade) for WhatsApp message media
    if (isWhatsAppMsg && message.zaloMsgId && message.conversation?.zaloAccountId) {
      try {
        const waMedia = await whatsappPool.downloadMediaByMsgId(
          message.conversation.zaloAccountId,
          message.zaloMsgId,
          message.conversation?.externalThreadId,
          message.senderType === 'self',
        );
        if (waMedia?.data) {
          const mediaBuf = Buffer.from(waMedia.data, 'base64');
          // Do not replace an existing file on disk if WA only yielded another tiny thumb
          if (waMedia.isThumb && existingLocalPath && existingLocalSize >= mediaBuf.length) {
            return sendLocalFile(existingLocalPath);
          }

          const mimeLower = String(waMedia.mimetype || '').toLowerCase().split(';')[0].trim();
          const isDoc =
            message.contentType === 'file' ||
            mimeLower.includes('pdf') ||
            mimeLower.includes('document') ||
            mimeLower.includes('msword') ||
            mimeLower.includes('sheet') ||
            mimeLower.includes('excel') ||
            mimeLower.includes('presentation') ||
            mimeLower.includes('powerpoint') ||
            mimeLower.includes('zip') ||
            mimeLower.includes('rar') ||
            mimeLower.startsWith('text/');
          const isVideo = message.contentType === 'video' || mimeLower.startsWith('video/');
          const isAudio = message.contentType === 'voice' || mimeLower.startsWith('audio/');

          let ext = 'jpg';
          let resolvedMime = waMedia.mimetype || 'application/octet-stream';

          if (isDoc) {
            if (mimeLower.includes('pdf')) { ext = 'pdf'; resolvedMime = 'application/pdf'; }
            else if (mimeLower.includes('wordprocessingml')) ext = 'docx';
            else if (mimeLower.includes('msword')) ext = 'doc';
            else if (mimeLower.includes('spreadsheetml')) ext = 'xlsx';
            else if (mimeLower.includes('ms-excel')) ext = 'xls';
            else if (mimeLower.includes('presentationml')) ext = 'pptx';
            else if (mimeLower.includes('zip')) ext = 'zip';
            else if (mimeLower.includes('rar')) ext = 'rar';
            else if (mimeLower.startsWith('text/') && !mimeLower.includes('html')) ext = 'txt';
            else if (waMedia.filename && waMedia.filename.includes('.')) {
              const sanitized = sanitizeUploadExtension(waMedia.filename);
              ext = sanitized.ext.replace(/^\./, '') || 'bin';
            } else {
              ext = 'doc';
            }
          } else if (isVideo) {
            ext = mimeLower.includes('quicktime') ? 'mov' : (mimeLower.includes('webm') ? 'webm' : 'mp4');
            resolvedMime = mimeLower || 'video/mp4';
          } else if (isAudio) {
            ext = mimeLower.includes('mpeg') ? 'mp3' : (mimeLower.includes('mp4') || mimeLower.includes('m4a') ? 'm4a' : 'ogg');
            resolvedMime = mimeLower || 'audio/ogg';
          } else {
            const imgFmt = detectImageFormatFromBuffer(mediaBuf, mimeLower);
            ext = imgFmt.ext;
            resolvedMime = imgFmt.mime;
          }

          const cleanIdSlug = message.zaloMsgId.replace(/[^a-zA-Z0-9]/g, '').slice(-10) || 'media';
          const cleanName = `wa_${isDoc ? 'doc' : 'media'}_${Date.now()}_${cleanIdSlug}.${ext}`;
          await fs.promises.mkdir(mediaDir, { recursive: true });
          const filePath = path.join(mediaDir, cleanName);
          await fs.promises.writeFile(filePath, mediaBuf);
          const localUrl = `/uploads/media/${cleanName}`;
          const effectiveName = waMedia.filename || fileName || cleanName;

          // Update message record in database while preserving genuine captions & attachments
          try {
            const preservedCap =
              parsedContentJson && !shouldIgnoreWhatsAppCaption(parsedContentJson.caption)
                ? String(parsedContentJson.caption).trim()
                : parsedContentJson && !shouldIgnoreWhatsAppCaption(parsedContentJson.title) && !isDoc
                  ? String(parsedContentJson.title).trim()
                  : '';

            const nextJson = isDoc
              ? {
                  title: effectiveName,
                  href: localUrl,
                  localUrl,
                }
              : isVideo
                ? {
                    videoUrl: localUrl,
                    href: localUrl,
                    localUrl,
                    ...(preservedCap ? { title: preservedCap, caption: preservedCap } : {}),
                  }
                : isAudio
                  ? {
                      href: localUrl,
                      voiceUrl: localUrl,
                      localUrl,
                      action: 'voice',
                    }
                  : {
                      href: localUrl,
                      localUrl,
                      ...(waMedia.isThumb ? { thumb: localUrl } : { thumb: localUrl, hdUrl: localUrl }),
                      ...(preservedCap ? { title: preservedCap, caption: preservedCap } : {}),
                    };

            const preservedMeta = existingAtts.filter((a: any) => a?.type === 'zalo_meta' || a?.type === 'reaction');
            const nextAtt = {
              type: isDoc ? 'file' : (isVideo ? 'video' : (isAudio ? 'voice' : 'image')),
              url: localUrl,
              href: localUrl,
              localUrl,
              name: effectiveName,
            };

            await prisma.message.update({
              where: { id: messageId },
              data: {
                content: JSON.stringify(nextJson),
                contentType: isDoc ? 'file' : (isVideo ? 'video' : (isAudio ? 'voice' : 'image')),
                attachments: [...preservedMeta, nextAtt] as any,
              },
            });
          } catch {}

          reply.header('Content-Type', getSafeServeMimeType(cleanName, resolvedMime));
          reply.header('Cache-Control', 'private, max-age=86400, no-transform');
          reply.header('Content-Disposition', buildContentDisposition(mode, effectiveName));
          return fs.createReadStream(filePath);
        }
      } catch (err: any) {
        logger.warn(`[chat] On-demand WhatsApp media download error:`, err?.message || err);
      }
    }

    // Fallback: if we skipped a <12KB WA jpg hoping for upgrade and upgrade failed, still serve existing disk file
    if (existingLocalPath) {
      return sendLocalFile(existingLocalPath);
    }

    return reply
      .status(404)
      .header('Content-Type', 'text/plain; charset=utf-8')
      .send('Không tìm thấy tệp đính kèm trên máy chủ hoặc tệp đã hết hạn');
  });

  // Background helper to backfill missing avatars and names for contacts without blocking responses
  async function enrichMissingAvatars(conversations: any[], orgId: string): Promise<number> {
    let updatedCount = 0;
    const accountMap = new Map<string, { uids: string[]; groupIds: string[] }>();

    for (const conv of conversations) {
      if (conv.channel === 'whatsapp' || conv.zaloAccount?.channel === 'whatsapp') {
        continue;
      }
      // Auto-link conversation if contactId is missing
      if (!conv.contact && conv.externalThreadId) {
        try {
          let contact = await prisma.contact.findFirst({
            where: { orgId, zaloUid: conv.externalThreadId },
          });
          if (!contact) {
            contact = await prisma.contact.create({
              data: {
                id: randomUUID(),
                orgId,
                zaloUid: conv.externalThreadId,
                channel: conv.channel || 'zalo',
                fullName: 'Khách hàng',
              },
            });
          }
          await prisma.conversation.update({
            where: { id: conv.id },
            data: { contactId: contact.id },
          });
          conv.contact = contact;
        } catch {}
      }

      const isGroup = conv.threadType === 'group';
      const targetUid = conv.contact?.zaloUid || conv.externalThreadId;
      const missingAvatar = !conv.contact?.avatarUrl;
      const placeholderName = !conv.contact?.fullName || conv.contact.fullName === 'Khách hàng' || conv.contact.fullName === 'Unknown';

      // Immediate backfill from latest contact message if name is a placeholder
      if (conv.contact && placeholderName && !isGroup) {
        try {
          const lastContactMsg = await prisma.message.findFirst({
            where: {
              conversationId: conv.id,
              senderType: 'contact',
              senderName: { not: null },
            },
            orderBy: { sentAt: 'desc' },
            select: { senderName: true, attachments: true },
          });

          if (lastContactMsg?.senderName && lastContactMsg.senderName !== 'Khách hàng' && lastContactMsg.senderName !== 'Unknown') {
            await prisma.contact.update({
              where: { id: conv.contact.id },
              data: { fullName: lastContactMsg.senderName },
            });
            conv.contact.fullName = lastContactMsg.senderName;
            updatedCount++;
            zaloPool.getIO()?.emit('contact:updated', {
              id: conv.contact.id,
              contactId: conv.contact.id,
              zaloUid: conv.contact.zaloUid,
              fullName: lastContactMsg.senderName,
            });
          }
        } catch {}
      }

      const accId = conv.zaloAccountId || 'fallback';
      if (targetUid && (missingAvatar || placeholderName)) {
        if (!accountMap.has(accId)) {
          accountMap.set(accId, { uids: [], groupIds: [] });
        }
        const item = accountMap.get(accId)!;
        if (isGroup) {
          if (!item.groupIds.includes(targetUid)) item.groupIds.push(targetUid);
        } else {
          if (!item.uids.includes(targetUid)) item.uids.push(targetUid);
        }
      }
    }

    for (const [accountId, { uids, groupIds }] of accountMap) {
      let api = (accountId !== 'fallback' ? zaloPool.getApi(accountId) : null) || zaloPool.getAnyActiveApi();
      if (!api) continue;

      // 1. Batch fetch user contacts in chunks of 30
      for (let i = 0; i < uids.length; i += 30) {
        const chunk = uids.slice(i, i + 30);
        try {
          const userInfoRes = await api.getUserInfo(chunk);
          const changed = userInfoRes?.changed_profiles || {};
          const matchedUids = new Set<string>();

          for (const [key, profile] of Object.entries(changed) as [string, any][]) {
            const rawUid = key.replace(/_0$/, '');
            matchedUids.add(rawUid);
            const realAvatar = profile?.avatar || profile?.avatarUrl || profile?.avatar_url || null;
            const realName = profile?.zaloName || profile?.zalo_name || profile?.displayName || profile?.display_name || null;
            const phone = profile?.phoneNumber || null;

            if (realAvatar || realName) {
              const updated = await prisma.contact.updateMany({
                where: { zaloUid: rawUid, orgId },
                data: {
                  ...(realAvatar ? { avatarUrl: realAvatar } : {}),
                  ...(realName ? { fullName: realName } : {}),
                  ...(phone ? { phone } : {}),
                },
              });

              if (updated.count > 0) {
                updatedCount += updated.count;
                zaloPool.getIO()?.emit('contact:updated', {
                  zaloUid: rawUid,
                  avatarUrl: realAvatar,
                  fullName: realName,
                  phone,
                });
              }
            }
          }

          // Fallback for avatar url if some UIDs were not in changed_profiles
          const missingUids = chunk.filter((u: string) => !matchedUids.has(u));
          if (missingUids.length > 0 && typeof api.getAvatarUrlProfile === 'function') {
            try {
              const avatarMap = await api.getAvatarUrlProfile(missingUids);
              if (avatarMap && typeof avatarMap === 'object') {
                for (const [uid, avtUrl] of Object.entries(avatarMap)) {
                  if (typeof avtUrl === 'string' && avtUrl.startsWith('http')) {
                    const rawUid = uid.replace(/_0$/, '');
                    const updated = await prisma.contact.updateMany({
                      where: { zaloUid: rawUid, orgId, OR: [{ avatarUrl: null }, { avatarUrl: '' }] },
                      data: { avatarUrl: avtUrl },
                    });
                    if (updated.count > 0) {
                      updatedCount += updated.count;
                      zaloPool.getIO()?.emit('contact:updated', {
                        zaloUid: rawUid,
                        avatarUrl: avtUrl,
                      });
                    }
                  }
                }
              }
            } catch {}
          }
        } catch (err: any) {
          logger.warn(`[chat-routes] Batch getUserInfo failed for account ${accountId}:`, err?.message || err);
        }
      }

      // 2. Fetch group contacts
      for (const gid of groupIds) {
        try {
          const groupRes = await api.getGroupInfo(gid);
          const gInfo = groupRes?.gridInfoMap?.[gid];
          const avt = gInfo?.avt || gInfo?.fullAvt || null;
          const gName = gInfo?.name || null;
          if (avt || gName) {
            const updated = await prisma.contact.updateMany({
              where: { zaloUid: gid, orgId },
              data: {
                ...(avt ? { avatarUrl: avt } : {}),
                ...(gName ? { fullName: gName } : {}),
              },
            });
            if (updated.count > 0) {
              updatedCount += updated.count;
              zaloPool.getIO()?.emit('contact:updated', {
                zaloUid: gid,
                avatarUrl: avt,
                fullName: gName,
              });
            }
          }
        } catch (err: any) {
          logger.warn(`[chat-routes] getGroupInfo ${gid} failed for account ${accountId}:`, err?.message || err);
        }
      }
    }

    return updatedCount;
  }

  app.addHook('preHandler', authMiddleware);

  // ── List conversations (paginated) ──────────────────────────────────────
  app.get('/api/v1/conversations', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { page = '1', limit = '50', search = '', accountId = '', uncompletedOnly = '', unreadOnly = '', category = '', threadType = '', status = '', channel = '' } = request.query as QueryParams;

    const where: any = { orgId: user.orgId };
    if (accountId) where.zaloAccountId = accountId;
    if (channel) where.channel = channel;
    if (unreadOnly === 'true') where.unreadCount = { gt: 0 };
    if (threadType === 'user' || threadType === 'group') where.threadType = threadType;

    const contactConditions: any[] = [];
    if (status) {
      if (status === 'new') {
        contactConditions.push({
          OR: [
            { status: 'new' },
            { status: null },
          ],
        });
      } else if (status === 'completed') {
        contactConditions.push({
          OR: [
            { status: 'completed' },
            { status: 'vip' },
          ],
        });
      } else {
        contactConditions.push({ status });
      }
    }
    if (category) {
      if (category === 'KH quan trọng' || category === 'Khách hàng quan trọng') {
        contactConditions.push({
          OR: [
            { tags: { array_contains: ['KH quan trọng'] } },
            { tags: { array_contains: ['Khách hàng quan trọng'] } },
          ],
        });
      } else {
        contactConditions.push({ tags: { array_contains: [category] } });
      }
    }
    if (search) {
      const trimmedSearch = search.trim();
      const cleanPhone = trimmedSearch.replace(/\D/g, '');
      const searchTerms: any[] = [
        { fullName: { contains: trimmedSearch, mode: 'insensitive' } },
        { phone: { contains: trimmedSearch } },
        { notes: { contains: trimmedSearch, mode: 'insensitive' } },
      ];
      if (cleanPhone.length >= 4) {
        searchTerms.push({ phone: { contains: cleanPhone } });
      }
      contactConditions.push({
        OR: searchTerms,
      });
    }

    if (uncompletedOnly === 'true') {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      where.quoteCompleted = false;
      where.OR = [
        { threadType: 'user' },
        { isCustomer: true }
      ];
      where.AND = [
        {
          OR: [
            {
              isReplied: false,
              lastMessageAt: { lte: fiveMinutesAgo }
            },
            {
              isReplied: true,
              lastMessageAt: { lte: twentyFourHoursAgo }
            }
          ]
        },
        {
          OR: [
            { contact: null },
            {
              contact: {
                OR: [
                  {
                    AND: [
                      {
                        OR: [
                          { notes: null },
                          { NOT: { notes: { contains: '[Chuyển cho Kế toán]' } } }
                        ]
                      },
                      {
                        metadata: {
                          path: ['customerCode'],
                          equals: Prisma.DbNull
                        }
                      }
                    ]
                  },
                  {
                    metadata: {
                      path: ['accountantStatus'],
                      equals: 'completed'
                    }
                  }
                ]
              }
            }
          ]
        }
      ];
    } else if (uncompletedOnly === 'tracked') {
      contactConditions.push({
        NOT: {
          metadata: {
            path: ['accountantStatus'],
            equals: 'completed'
          }
        }
      });

      if (user.role !== 'accountant') {
        contactConditions.push({
          OR: [
            { notes: { contains: '[Chuyển cho Kế toán]' } },
            {
              metadata: {
                path: ['customerCode'],
                not: null
              }
            }
          ]
        });
      }
    }

    if (contactConditions.length > 0) {
      where.contact = {
        AND: contactConditions
      };
    }

    // Members can only see conversations from Zalo accounts they have access to
    if (user.role === 'member') {
      const accessibleAccounts = await prisma.zaloAccountAccess.findMany({
        where: { userId: user.id },
        select: { zaloAccountId: true },
      });
      where.zaloAccountId = { in: accessibleAccounts.map((a) => a.zaloAccountId).filter(id => !accountId || id === accountId) };
    }

    const [conversations, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        include: {
          contact: { select: { id: true, fullName: true, phone: true, avatarUrl: true, zaloUid: true, whatsappJid: true, channel: true, status: true, notes: true, tags: true, metadata: true } },
          zaloAccount: { select: { id: true, displayName: true, zaloUid: true, status: true, channel: true } },
          messages: {
            take: 1,
            orderBy: { sentAt: 'desc' },
            select: { content: true, contentType: true, senderType: true, sentAt: true, isDeleted: true },
          },
        },
        orderBy: { lastMessageAt: 'desc' },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
      }),
      prisma.conversation.count({ where }),
    ]);

    // Asynchronously backfill missing avatars and names in background without slowing response
    enrichMissingAvatars(conversations, user.orgId).catch((err) => {
      logger.warn('[chat-routes] enrichMissingAvatars background error:', err);
    });

    return { conversations, total, page: parseInt(page), limit: parseInt(limit) };
  });

  // ── Refresh all missing avatars for the organization ────────────────────
  app.post('/api/v1/conversations/refresh-missing-avatars', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;

    // 1. Auto-link orphan conversations missing contactId
    const orphanConvs = await prisma.conversation.findMany({
      where: {
        orgId: user.orgId,
        contactId: null,
        externalThreadId: { not: null },
      },
      take: 100,
    });
    for (const oc of orphanConvs) {
      if (!oc.externalThreadId) continue;
      try {
        let contact = await prisma.contact.findFirst({
          where: { orgId: user.orgId, zaloUid: oc.externalThreadId },
        });
        if (!contact) {
          contact = await prisma.contact.create({
            data: {
              id: randomUUID(),
              orgId: user.orgId,
              zaloUid: oc.externalThreadId,
              channel: oc.channel || 'zalo',
              fullName: 'Khách hàng',
            },
          });
        }
        await prisma.conversation.update({
          where: { id: oc.id },
          data: { contactId: contact.id },
        });
      } catch {}
    }

    // 2. Find all conversations with missing avatars or placeholder names in user org
    const convs = await prisma.conversation.findMany({
      where: {
        orgId: user.orgId,
        channel: 'zalo',
        OR: [
          { contact: { avatarUrl: null } },
          { contact: { avatarUrl: '' } },
          { contact: { fullName: 'Khách hàng' } },
          { contact: { fullName: 'Unknown' } },
          { contact: { fullName: null } },
          { contactId: null },
        ],
      },
      include: {
        contact: { select: { id: true, zaloUid: true, fullName: true, avatarUrl: true } },
      },
      take: 200,
    });

    const updatedCount = await enrichMissingAvatars(convs, user.orgId);
    return { success: true, totalMissingChecked: convs.length, updatedCount };
  });

  // ── Get single conversation ──────────────────────────────────────────────
  app.get('/api/v1/conversations/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
      include: {
        contact: true,
        zaloAccount: { select: { id: true, displayName: true, zaloUid: true, status: true } },
      },
    });
    if (!conversation) return reply.status(404).send({ error: 'Not found' });

    if (conversation.contact && (!conversation.contact.avatarUrl || conversation.contact.fullName === 'Khách hàng')) {
      enrichMissingAvatars([conversation], user.orgId).catch(() => {});
    }

    return conversation;
  });

  // ── Refresh avatar for a single conversation ─────────────────────────────
  app.post('/api/v1/conversations/:id/refresh-avatar', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
      include: {
        contact: true,
        zaloAccount: { select: { id: true, displayName: true, zaloUid: true, status: true } },
      },
    });
    if (!conversation) return reply.status(404).send({ error: 'Not found' });

    const updatedCount = await enrichMissingAvatars([conversation], user.orgId);
    const refreshed = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
      include: { contact: true },
    });

    return { success: true, updated: updatedCount > 0, contact: refreshed?.contact };
  });

  // ── List messages for a conversation (paginated, newest first) ──────────
  app.get('/api/v1/conversations/:id/messages', { preHandler: requireZaloAccess('read') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const { page = '1', limit = '50' } = request.query as QueryParams;

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
      include: { contact: { select: { notes: true } } },
    });
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });


    let [messages, total] = await Promise.all([
      prisma.message.findMany({
        where: { conversationId: id },
        include: { repliedBy: { select: { id: true, fullName: true, role: true } } },
        orderBy: { sentAt: 'desc' },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
      }),
      prisma.message.count({ where: { conversationId: id } }),
    ]);

    // On-demand fetch for WhatsApp if conversation currently has 0 messages
    if (total === 0 && conversation.channel === 'whatsapp' && conversation.externalThreadId) {
      try {
        const fetchedCount = await whatsappPool.fetchChatMessages(conversation.zaloAccountId, conversation.externalThreadId, 30);
        if (fetchedCount > 0) {
          [messages, total] = await Promise.all([
            prisma.message.findMany({
              where: { conversationId: id },
              include: { repliedBy: { select: { id: true, fullName: true, role: true } } },
              orderBy: { sentAt: 'desc' },
              skip: (parseInt(page) - 1) * parseInt(limit),
              take: parseInt(limit),
            }),
            prisma.message.count({ where: { conversationId: id } }),
          ]);
        }
      } catch (err: any) {
        logger.debug(`[chat-routes] fetchChatMessages on-demand error: ${err?.message || err}`);
      }
    }

    return { messages: messages.reverse(), total, page: parseInt(page), limit: parseInt(limit) };
  });

  // ── Get conversation assets (images, files, links) ────────────────────────
  app.get('/api/v1/conversations/:id/assets', { preHandler: requireZaloAccess('read') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
      include: { contact: { select: { notes: true } } },
    });
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });


    const messages = await prisma.message.findMany({
      where: {
        conversationId: id,
        isDeleted: false,
        OR: [
          { contentType: { in: ['image', 'file', 'link', 'video'] } },
          { content: { contains: 'http' } },
          { content: { contains: '"href":' } },
          { content: { contains: '"thumb":' } },
        ],
      },
      orderBy: { sentAt: 'desc' },
      select: {
        id: true,
        contentType: true,
        content: true,
        senderType: true,
        senderName: true,
        sentAt: true,
        attachments: true,
      },
    });

    const assets = extractConversationAssets(messages);
    return assets;
  });

  // ── Send message ─────────────────────────────────────────────────────────
  app.post('/api/v1/conversations/:id/messages', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    let content = '';
    let quoteMessageId = '';
    let isFile = false;
    let fileBuffer: Buffer | null = null;
    let fileName = '';
    let fileExt = '';
    let fileMime = '';

    if (request.isMultipart()) {
      const part = await request.file();
      if (!part) return reply.status(400).send({ error: 'File required' });

      fileBuffer = await part.toBuffer();
      fileName = part.filename;
      fileExt = fileName.split('.').pop()?.toLowerCase() || '';
      fileMime = part.mimetype || '';
      isFile = true;

      // Extract content if present in multipart fields
      content = (part.fields.content as any)?.value || '';
      quoteMessageId = (part.fields.quoteMessageId as any)?.value || '';
    } else {
      const body = request.body as { content: string; quoteMessageId?: string };
      content = body.content || '';
      quoteMessageId = body.quoteMessageId || '';
      if (!content?.trim()) return reply.status(400).send({ error: 'Content required' });
    }

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
      include: { zaloAccount: true, contact: { select: { notes: true } } },
    });
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });

    // Shared quote/reply resolution across both WhatsApp and Zalo
    let quotedMsg: any = null;
    let quoteAttachment: any = null;
    let zaloQuote: any = undefined;

    if (quoteMessageId) {
      quotedMsg = await prisma.message.findFirst({
        where: { id: quoteMessageId, conversationId: id },
      });

      if (quotedMsg) {
        let snippet = quotedMsg.content || '';
        if (quotedMsg.contentType === 'image') {
          snippet = '[Hình ảnh]';
        } else if (quotedMsg.contentType === 'file') {
          snippet = '[Tệp đính kèm]';
        } else if (quotedMsg.contentType === 'sticker') {
          snippet = '[Nhãn dán]';
        } else if (quotedMsg.contentType === 'voice') {
          snippet = '[Tin nhắn thoại]';
        } else if (quotedMsg.contentType === 'video') {
          snippet = '[Video]';
        }
        if (snippet.startsWith('{')) {
          try {
            const p = JSON.parse(snippet);
            snippet = p.title || p.caption || p.fileName || snippet;
          } catch {}
        }

        quoteAttachment = {
          type: 'quote',
          ownerId: quotedMsg.senderUid || '',
          fromD: quotedMsg.senderName || (quotedMsg.senderType === 'self' ? 'Bạn' : 'Khách hàng'),
          msg: snippet,
          attach: quotedMsg.contentType === 'image' ? (quotedMsg.content || '') : '',
          cliMsgType: quotedMsg.contentType === 'image' ? 32 : 1,
          globalMsgId: quotedMsg.zaloMsgId || quotedMsg.id,
          quoteMessageId: quotedMsg.id,
        };

        if (quotedMsg.zaloMsgId) {
          let qContent: any = quotedMsg.content || '';
          let qMsgType = 'webchat';
          if (quotedMsg.contentType === 'image') {
            qMsgType = 'chat.photo';
            try {
              const parsed = JSON.parse(quotedMsg.content || '{}');
              qContent = {
                href: parsed.href || parsed.url || parsed.hdUrl || '',
                thumb: parsed.thumb || parsed.href || '',
                ...parsed,
              };
            } catch {
              qContent = quotedMsg.content || '';
            }
          }
          zaloQuote = {
            content: qContent,
            msgType: qMsgType,
            propertyExt: {},
            uidFrom: quotedMsg.senderUid || conversation.externalThreadId,
            msgId: quotedMsg.zaloMsgId,
            cliMsgId: quotedMsg.zaloMsgId,
            ts: quotedMsg.sentAt.getTime(),
            ttl: 0,
          };
        }
      }
    }

    const isWhatsApp = conversation.channel === 'whatsapp' || conversation.zaloAccount?.channel === 'whatsapp';

    if (isWhatsApp) {
      try {
        const threadId = conversation.externalThreadId || '';
        let sent: any;
        let sentContentType = 'text';
        let sentContent = content.trim();
        let sentAttachments: any[] = [];
        const waSendOpts = quotedMsg?.zaloMsgId ? { quotedMessageId: quotedMsg.zaloMsgId } : undefined;

        if (isFile && fileBuffer) {
          const mediaKind = detectUploadMediaKind(fileExt, fileName, fileMime);
          const isVoice = mediaKind === 'voice';
          const isImage = mediaKind === 'image';
          const isVideo = mediaKind === 'video';

          if (isImage) {
            const optimized = await optimizeImageForSend(fileBuffer, fileName, fileExt);
            fileBuffer = optimized.buffer;
            fileName = optimized.fileName;
            fileExt = optimized.fileExt;
          }

          const { localUrl, filePath } = await saveChatFileBuffer(fileBuffer, fileName);

          if (isVoice) {
            sent = await whatsappPool.sendVoice(
              conversation.zaloAccountId,
              threadId,
              fileBuffer,
              fileExt === 'mp3' ? 'audio/mpeg' : 'audio/ogg; codecs=opus'
            );
            sentContentType = 'voice';
            sentContent = JSON.stringify({
              href: localUrl,
              voiceUrl: localUrl,
              localUrl,
              action: 'voice',
              durationText: content.trim() || '0:00',
              params: {
                m4a: localUrl,
                href: localUrl,
                url: localUrl,
                fileSize: fileBuffer.length,
              },
            });
            sentAttachments = [{ type: 'voice', url: localUrl, href: localUrl, localUrl }];
          } else {
            const sendMimeMap: Record<string, string> = {
              jpg: 'image/jpeg',
              jpeg: 'image/jpeg',
              png: 'image/png',
              webp: 'image/webp',
              gif: 'image/gif',
              bmp: 'image/bmp',
              mp4: 'video/mp4',
              mov: 'video/quicktime',
              webm: 'video/webm',
              pdf: 'application/pdf',
              doc: 'application/msword',
              docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              xls: 'application/vnd.ms-excel',
              xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            };
            const sendMime = sendMimeMap[fileExt] || fileMime || (isImage ? 'image/jpeg' : (isVideo ? 'video/mp4' : 'application/octet-stream'));

            sent = await whatsappPool.sendMedia(
              conversation.zaloAccountId,
              threadId,
              filePath,
              fileName,
              sendMime,
              content.trim(),
              waSendOpts
            );

            if (isImage) {
              sentContentType = 'image';
              sentContent = JSON.stringify({
                href: localUrl,
                thumb: localUrl,
                hdUrl: localUrl,
                localUrl,
                ...(content.trim() ? { title: content.trim(), caption: content.trim() } : {}),
              });
              sentAttachments = [{ type: 'image', url: localUrl, href: localUrl, localUrl }];
            } else if (isVideo) {
              sentContentType = 'video';
              sentContent = JSON.stringify({
                videoUrl: localUrl,
                href: localUrl,
                thumb: '',
                localUrl,
                ...(content.trim() ? { title: content.trim(), caption: content.trim() } : {}),
              });
              sentAttachments = [{ type: 'video', url: localUrl, href: localUrl, localUrl, videoUrl: localUrl }];
            } else {
              sentContentType = 'file';
              sentContent = JSON.stringify({
                title: fileName,
                href: localUrl,
                localUrl,
                params: JSON.stringify({
                  fileSize: String(fileBuffer.length),
                  fileExt,
                }),
              });
              sentAttachments = [{ type: 'file', url: localUrl, href: localUrl, localUrl, name: fileName }];
            }
          }
        } else {
          sent = await whatsappPool.sendMessage(conversation.zaloAccountId, threadId, content, undefined, waSendOpts);
        }

        if (quoteAttachment) {
          sentAttachments.push(quoteAttachment);
        }

        const sentAt = new Date();

        const msgRecord = await prisma.message.create({
          data: {
            conversationId: id,
            zaloMsgId: sent.id,
            senderType: 'self',
            senderName: (user as any).fullName || 'Staff',
            content: sentContent,
            contentType: sentContentType,
            attachments: sentAttachments,
            sentAt,
            repliedByUserId: user.id,
          },
          include: {
            repliedBy: { select: { id: true, fullName: true, role: true } },
          },
        });

        await prisma.conversation.update({
          where: { id },
          data: {
            lastMessageAt: sentAt,
            isReplied: true,
            unreadCount: 0,
          },
        });

        const io = (app as any).io;
        if (io) {
          const payload = {
            ...msgRecord,
            channel: 'whatsapp',
            conversationId: id,
          };
          io.to(`org:${user.orgId}`).emit('message:new', payload);
          io.to(`conversation:${id}`).emit('message:new', payload);
          io.emit('chat:message', {
            accountId: conversation.zaloAccountId,
            message: msgRecord,
            conversationId: id,
          });
          io.to(`org:${user.orgId}`).emit('conversation:updated', {
            id,
            lastMessageAt: sentAt,
            unreadCount: 0,
            channel: 'whatsapp',
          });
        }

        return reply.status(201).send(msgRecord);
      } catch (waErr: any) {
        logger.error('[chat] WhatsApp send error:', waErr);
        return reply.status(500).send({ error: `Gửi tin nhắn WhatsApp thất bại: ${waErr.message}` });
      }
    }


    const instance = zaloPool.getInstance(conversation.zaloAccountId);
    if (!instance?.api) return reply.status(400).send({ error: 'Zalo account not connected' });

    // Rate limit check — prevent account blocking
    const limits = zaloRateLimiter.checkLimits(conversation.zaloAccountId);
    if (!limits.allowed) {
      return reply.status(429).send({ error: limits.reason });
    }

    try {
      const threadId = conversation.externalThreadId || '';
      // zca-js sendMessage(message, threadId, type) — type: 0=User, 1=Group
      const threadType = conversation.threadType === 'group' ? 1 : 0;

      zaloRateLimiter.recordSend(conversation.zaloAccountId);

      let finalContent = content ? content.trim() : '';
      let finalContentType = 'text';
      let messageAttachments: any = [];

      let res;
      if (isFile && fileBuffer) {
        const mediaKind = detectUploadMediaKind(fileExt, fileName, fileMime);
        const isVoice = mediaKind === 'voice';
        const isImage = mediaKind === 'image';
        const isVideo = mediaKind === 'video';

        let imgWidth = 800;
        let imgHeight = 600;

        if (isImage) {
          const optimized = await optimizeImageForSend(fileBuffer, fileName, fileExt);
          fileBuffer = optimized.buffer;
          fileName = optimized.fileName;
          fileExt = optimized.fileExt;
          imgWidth = optimized.width;
          imgHeight = optimized.height;
        }

        const { localUrl } = await saveChatFileBuffer(fileBuffer, fileName);

        const attachmentSource: any = {
          data: fileBuffer,
          filename: fileName,
          metadata: {
            totalSize: fileBuffer.length,
          },
        };
        if (isImage) {
          attachmentSource.metadata.width = imgWidth;
          attachmentSource.metadata.height = imgHeight;
        }

        res = await instance.api.sendMessage(
          { msg: content, attachments: [attachmentSource] },
          threadId,
          threadType
        );

        if (res?.attachment && res.attachment.length > 0) {
          const att = res.attachment[0];
          messageAttachments = [{ ...att, localUrl, fileName, fileSize: fileBuffer.length }];
          if (isImage) {
            finalContentType = 'image';
            const remoteUrl =
              att.normalUrl ||
              att.fileUrl ||
              att.url ||
              att.data?.normalUrl ||
              att.data?.fileUrl ||
              att.data?.url ||
              att.data?.hdUrl ||
              '';
            const activeUrl = remoteUrl || localUrl;
            const thumbUrl = att.thumbUrl || att.data?.thumbUrl || activeUrl;
            const hdUrl = att.hdUrl || att.data?.hdUrl || activeUrl;

            finalContent = JSON.stringify({
              href: activeUrl,
              thumb: thumbUrl,
              hdUrl: hdUrl,
              localUrl,
              ...(content?.trim() ? { title: content.trim(), caption: content.trim() } : {}),
            });
          } else if (isVideo) {
            finalContentType = 'video';
            const remoteUrl = att.fileUrl || att.url || att.data?.fileUrl || att.data?.url || localUrl;
            finalContent = JSON.stringify({
              videoUrl: remoteUrl,
              thumb: att.thumbUrl || att.data?.thumbUrl || '',
              localUrl,
              ...(content?.trim() ? { title: content.trim(), caption: content.trim() } : {}),
            });
          } else if (isVoice) {
            finalContentType = 'voice';
            const remoteUrl = att.fileUrl || att.url || att.data?.fileUrl || att.data?.url || localUrl;
            finalContent = JSON.stringify({
              href: remoteUrl,
              voiceUrl: remoteUrl,
              action: 'voice',
              params: {
                m4a: remoteUrl,
                href: remoteUrl,
                url: remoteUrl,
                fileSize: fileBuffer.length,
              },
            });
          } else {
            finalContentType = 'file';
            const activeUrl = att.fileUrl || att.data?.fileUrl || localUrl;
            finalContent = JSON.stringify({
              title: att.fileName || att.data?.fileName || fileName,
              href: activeUrl,
              localUrl,
              params: JSON.stringify({
                fileSize: String(att.totalSize || att.data?.totalSize || fileBuffer.length),
                fileExt: fileExt,
              }),
            });
          }
        } else {
          finalContentType = isVoice ? 'voice' : (isImage ? 'image' : (isVideo ? 'video' : 'file'));
          if (isVoice) {
            finalContent = JSON.stringify({
              href: localUrl,
              voiceUrl: localUrl,
              action: 'voice',
              params: {
                m4a: localUrl,
                href: localUrl,
                url: localUrl,
                fileSize: fileBuffer.length,
              },
            });
          } else if (isImage) {
            finalContent = JSON.stringify({
              href: localUrl,
              thumb: localUrl,
              hdUrl: localUrl,
              localUrl,
              ...(content?.trim() ? { title: content.trim(), caption: content.trim() } : {}),
            });
          } else if (isVideo) {
            finalContent = JSON.stringify({
              videoUrl: localUrl,
              thumb: '',
              localUrl,
              ...(content?.trim() ? { title: content.trim(), caption: content.trim() } : {}),
            });
          } else {
            finalContent = JSON.stringify({
              title: fileName,
              href: localUrl,
              localUrl,
              params: JSON.stringify({
                fileSize: String(fileBuffer.length),
                fileExt: fileExt,
              }),
            });
          }
          messageAttachments = [{ type: finalContentType, localUrl, url: localUrl, fileName, fileSize: fileBuffer.length }];
        }
      } else {
        // If content is serialized JSON containing an image/media URL, prevent sending raw JSON code!
        let textToSend = content ? content.trim() : '';
        if (textToSend.startsWith('{')) {
          try {
            const parsed = JSON.parse(textToSend);
            if (parsed.href || parsed.rawUrl || parsed.thumb) {
              const mediaUrl = parsed.hdUrl || parsed.normalUrl || parsed.href || parsed.rawUrl || parsed.thumb || '';
              if (mediaUrl.startsWith('/storage/') || mediaUrl.startsWith('/uploads/') || mediaUrl.startsWith('/api/zalo-assets/')) {
                const localMediaPath = await resolveSafeLocalFilePath(mediaUrl);
                if (localMediaPath) {
                  const buf = await fs.promises.readFile(localMediaPath);
                  const attSource = {
                    data: buf,
                    filename: path.basename(localMediaPath),
                    metadata: { totalSize: buf.length, width: 800, height: 600 },
                  };
                  res = await instance.api.sendMessage(
                    { msg: parsed.caption || parsed.title || '', attachments: [attSource] },
                    threadId,
                    threadType,
                  );
                  finalContentType = 'image';
                  finalContent = JSON.stringify({
                    href: mediaUrl,
                    thumb: mediaUrl,
                    localUrl: mediaUrl,
                    ...(parsed.caption || parsed.title ? { title: parsed.caption || parsed.title } : {}),
                  });
                }
              } else if (mediaUrl.startsWith('https://')) {
                const urlCheck = await validateZaloProxyUrl(mediaUrl);
                if (urlCheck.ok) {
                  try {
                    const imgRes = await fetch(urlCheck.url.toString(), { redirect: 'manual', signal: AbortSignal.timeout(15000) });
                    if (imgRes.ok) {
                      const buf = Buffer.from(await imgRes.arrayBuffer());
                      const attSource = {
                        data: buf,
                        filename: 'image.jpg',
                        metadata: { totalSize: buf.length, width: 800, height: 600 },
                      };
                      res = await instance.api.sendMessage(
                        { msg: parsed.caption || parsed.title || '', attachments: [attSource] },
                        threadId,
                        threadType,
                      );
                      finalContentType = 'image';
                      finalContent = JSON.stringify({
                        href: mediaUrl,
                        thumb: mediaUrl,
                        ...(parsed.caption || parsed.title ? { title: parsed.caption || parsed.title } : {}),
                      });
                    }
                  } catch {}
                }
              }
              if (!res) {
                textToSend = parsed.caption || parsed.title || mediaUrl || '[Hình ảnh]';
              }
            }
          } catch {}
        }

        // Safety fallback: NEVER send raw JSON code string to Zalo!
        if (textToSend.startsWith('{') && (textToSend.includes('"href"') || textToSend.includes('"rawUrl"') || textToSend.includes('zdn.vn') || textToSend.includes('dlfl.vn'))) {
          const matchUrl = textToSend.match(/https?:\/\/[^\s"'<>\\]+/);
          textToSend = matchUrl ? matchUrl[0] : '[Tin nhắn]';
        }

        if (!res) {
          if (zaloQuote) {
            try {
              res = await instance.api.sendMessage(
                { msg: textToSend, quote: zaloQuote },
                threadId,
                threadType
              );
            } catch (quoteErr: any) {
              logger.warn('[chat] Send with quote failed, falling back to normal send:', quoteErr?.message || quoteErr);
              res = await instance.api.sendMessage({ msg: textToSend }, threadId, threadType);
            }
          } else {
            res = await instance.api.sendMessage({ msg: textToSend }, threadId, threadType);
          }
        }
      }

      if (quoteAttachment) {
        messageAttachments.push(quoteAttachment);
      }

      const { zaloMsgId, cliMsgId } = extractZaloMsgDetails(res);
      if (cliMsgId) {
        messageAttachments.push({ type: 'zalo_meta', cliMsgId: String(cliMsgId) });
      }

      let message;
      const sixtySecondsAgo = new Date(Date.now() - 60 * 1000);
      const alreadyCreated = await prisma.message.findFirst({
        where: {
          conversationId: id,
          senderType: 'self',
          OR: [
            ...(zaloMsgId ? [{ zaloMsgId }] : []),
            ...(finalContent ? [
              { zaloMsgId: null, content: finalContent, sentAt: { gte: sixtySecondsAgo } },
              { zaloMsgId: '', content: finalContent, sentAt: { gte: sixtySecondsAgo } },
            ] : []),
          ]
        },
        orderBy: { sentAt: 'desc' },
      });

      if (alreadyCreated) {
        message = await prisma.message.update({
          where: { id: alreadyCreated.id },
          data: {
            repliedByUserId: user.id,
            senderName: 'Staff',
            ...(messageAttachments.length > 0 ? { attachments: messageAttachments } : {}),
            ...(zaloMsgId ? { zaloMsgId } : {}),
          },
          include: {
            repliedBy: { select: { id: true, fullName: true, role: true } },
          },
        });
        logger.info(`[chat-routes] Deduplicated and linked optimistic message to already received webhook message ${alreadyCreated.id}`);
      } else {
        message = await prisma.message.create({
          data: {
            id: randomUUID(),
            conversationId: id,
            zaloMsgId: zaloMsgId || null,
            senderType: 'self',
            senderUid: conversation.zaloAccount.zaloUid || '',
            senderName: 'Staff',
            content: finalContent,
            contentType: finalContentType,
            attachments: messageAttachments,
            sentAt: new Date(),
            repliedByUserId: user.id,
          },
          include: {
            repliedBy: { select: { id: true, fullName: true, role: true } },
          },
        });
      }

      await prisma.conversation.update({
        where: { id },
        data: { lastMessageAt: new Date(), isReplied: true, unreadCount: 0 },
      });

      const io = (app as any).io as Server;
      io?.emit('chat:message', { accountId: conversation.zaloAccountId, message, conversationId: id });

      return message;
    } catch (err) {
      logger.error('[chat] Send message error:', err);
      return reply.status(500).send({ error: 'Failed to send message' });
    }
  });

  // ── Send Bank Card (VietQR / Zalo Native Bank Card) ──────────────────────
  app.post('/api/v1/conversations/:id/send-bank-card', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    const { binBank, numAccBank, nameAccBank, bankName, amount, note } = request.body as {
      binBank: string;
      numAccBank: string;
      nameAccBank?: string;
      bankName?: string;
      amount?: number;
      note?: string;
    };

    if (!binBank || !numAccBank) {
      return reply.status(400).send({ error: 'Mã ngân hàng (binBank) và số tài khoản (numAccBank) là bắt buộc' });
    }

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
      include: { zaloAccount: true },
    });
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });

    const instance = zaloPool.getInstance(conversation.zaloAccountId);
    if (!instance?.api) return reply.status(400).send({ error: 'Zalo account not connected' });

    try {
      const threadId = conversation.externalThreadId || '';
      const threadType = conversation.threadType === 'group' ? 1 : 0;

      zaloRateLimiter.recordSend(conversation.zaloAccountId);

      // Call zca-js sendBankCard
      const res = await instance.api.sendBankCard(
        {
          binBank,
          numAccBank,
          nameAccBank: nameAccBank ? nameAccBank.toUpperCase() : '',
        },
        threadId,
        threadType
      );

      const bankDisplayName = bankName || `Ngân hàng (${binBank})`;
      const cleanName = (nameAccBank || '').toUpperCase();
      let textContent = `[Thông tin chuyển khoản: ${bankDisplayName} - STK: ${numAccBank}${cleanName ? ` - ${cleanName}` : ''}]`;
      if (amount && amount > 0) {
        textContent += ` - Số tiền: ${Number(amount).toLocaleString('vi-VN')} đ`;
      }
      if (note) {
        textContent += ` - Nội dung: ${note}`;
      }

      const attachments = [
        {
          type: 'bank_card',
          binBank,
          bankName: bankDisplayName,
          numAccBank,
          nameAccBank: cleanName,
          amount: amount || undefined,
          note: note || undefined,
          qrUrl: `https://img.vietqr.io/image/${binBank}-${numAccBank}-compact.png?amount=${amount || 0}&addInfo=${encodeURIComponent(note || '')}&accountName=${encodeURIComponent(cleanName)}`
        }
      ];

      const message = await prisma.message.create({
        data: {
          id: randomUUID(),
          conversationId: id,
          zaloMsgId: (res as any)?.msgId ? String((res as any).msgId) : null,
          senderType: 'self',
          senderUid: conversation.zaloAccount.zaloUid || '',
          senderName: 'Staff',
          content: textContent,
          contentType: 'bank_card',
          attachments,
          sentAt: new Date(),
          repliedByUserId: user.id,
        },
        include: {
          repliedBy: { select: { id: true, fullName: true, role: true } },
        },
      });

      await prisma.conversation.update({
        where: { id },
        data: { lastMessageAt: new Date(), isReplied: true, unreadCount: 0 },
      });

      const io = (app as any).io as Server;
      io?.emit('chat:message', { accountId: conversation.zaloAccountId, message, conversationId: id });

      return message;
    } catch (err: any) {
      logger.error('[chat] Send bank card error:', err?.message || err);
      return reply.status(500).send({ error: err?.message || 'Gửi thẻ ngân hàng thất bại' });
    }
  });

  // ── Send Contact Card ────────────────────────────────────────────────────
  app.post('/api/v1/conversations/:id/send-card', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    const { contactUserId, phoneNumber, contactName, avatar } = request.body as {
      contactUserId: string;
      phoneNumber?: string;
      contactName?: string;
      avatar?: string;
    };

    let targetUserId = contactUserId;
    let finalName = contactName || 'Danh thiếp Zalo';
    let finalAvatar = avatar || '';

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
      include: { zaloAccount: true },
    });
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });

    const instance = zaloPool.getInstance(conversation.zaloAccountId);
    if (!instance?.api) return reply.status(400).send({ error: 'Zalo account not connected' });

    if (!targetUserId && phoneNumber) {
      try {
        const found = await instance.api.findUser(phoneNumber);
        if (found?.uid) {
          targetUserId = found.uid;
          if (!contactName && found.displayName) finalName = found.displayName;
          if (!avatar && found.avatar) finalAvatar = found.avatar;
        }
      } catch (e) {
        logger.warn('[chat] Auto findUser by phone failed:', e);
      }
    }

    if (!targetUserId) {
      return reply.status(400).send({ error: 'Vui lòng cung cấp contactUserId hoặc số điện thoại Zalo hợp lệ' });
    }

    try {
      const threadId = conversation.externalThreadId || '';
      const threadType = conversation.threadType === 'group' ? 1 : 0;

      zaloRateLimiter.recordSend(conversation.zaloAccountId);

      const res = await instance.api.sendCard(
        {
          userId: targetUserId,
          phoneNumber: phoneNumber || undefined,
        },
        threadId,
        threadType
      );

      const cardPayload = {
        title: finalName,
        description: phoneNumber || 'Danh thiếp Zalo',
        thumb: finalAvatar,
        params: {
          phone: phoneNumber || '',
          name: finalName,
          avatar: finalAvatar,
          userId: targetUserId,
        }
      };

      const message = await prisma.message.create({
        data: {
          id: randomUUID(),
          conversationId: id,
          zaloMsgId: (res as any)?.msgId ? String((res as any).msgId) : null,
          senderType: 'self',
          senderUid: conversation.zaloAccount.zaloUid || '',
          senderName: 'Staff',
          content: JSON.stringify(cardPayload),
          contentType: 'contact_card',
          attachments: [cardPayload],
          sentAt: new Date(),
          repliedByUserId: user.id,
        },
        include: {
          repliedBy: { select: { id: true, fullName: true, role: true } },
        },
      });

      await prisma.conversation.update({
        where: { id },
        data: { lastMessageAt: new Date(), isReplied: true, unreadCount: 0 },
      });

      const io = (app as any).io as Server;
      io?.emit('chat:message', { accountId: conversation.zaloAccountId, message, conversationId: id });

      return message;
    } catch (err: any) {
      logger.error('[chat] Send card error:', err?.message || err);
      return reply.status(500).send({ error: err?.message || 'Gửi danh thiếp thất bại' });
    }
  });

  // ── Create Native Zalo Reminder ──────────────────────────────────────────
  app.post('/api/v1/conversations/:id/create-zalo-reminder', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    const { title, startTime, emoji, repeat } = request.body as {
      title: string;
      startTime: number;
      emoji?: string;
      repeat?: number;
    };

    if (!title || !startTime) {
      return reply.status(400).send({ error: 'Tiêu đề và thời gian nhắc hẹn là bắt buộc' });
    }

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
      include: { zaloAccount: true, contact: true },
    });
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });

    const instance = zaloPool.getInstance(conversation.zaloAccountId);
    if (!instance?.api) return reply.status(400).send({ error: 'Zalo account not connected' });

    try {
      const threadId = conversation.externalThreadId || '';
      const threadType = conversation.threadType === 'group' ? 1 : 0;

      zaloRateLimiter.recordSend(conversation.zaloAccountId);

      const res = await instance.api.createReminder(
        {
          title,
          startTime,
          emoji: emoji || '⏰',
          repeat: repeat ?? 0,
        },
        threadId,
        threadType
      );

      const formattedTime = new Date(startTime).toLocaleString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });

      const reminderData = {
        title,
        startTime,
        formattedTime,
        emoji: emoji || '⏰',
        repeat: repeat ?? 0,
        raw: res,
      };

      const message = await prisma.message.create({
        data: {
          id: randomUUID(),
          conversationId: id,
          zaloMsgId: (res as any)?.topicId || (res as any)?.id || null,
          senderType: 'self',
          senderUid: conversation.zaloAccount.zaloUid || '',
          senderName: 'Staff',
          content: `${emoji || '⏰'} [Nhắc hẹn Zalo] ${title} (${formattedTime})`,
          contentType: 'reminder',
          attachments: [reminderData],
          sentAt: new Date(),
          repliedByUserId: user.id,
        },
        include: {
          repliedBy: { select: { id: true, fullName: true, role: true } },
        },
      });

      // Synchronize appointment to local CRM database as well if contact exists
      if (conversation.contactId) {
        try {
          const dateObj = new Date(startTime);
          await prisma.appointment.create({
            data: {
              orgId: user.orgId,
              contactId: conversation.contactId,
              appointmentDate: dateObj,
              appointmentTime: dateObj.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
              type: 'zalo_reminder',
              status: 'scheduled',
              notes: `[Zalo Reminder] ${title}`,
            }
          });
        } catch (e) {
          logger.warn('[chat] Auto sync CRM appointment failed:', e);
        }
      }

      await prisma.conversation.update({
        where: { id },
        data: { lastMessageAt: new Date(), isReplied: true, unreadCount: 0 },
      });

      const io = (app as any).io as Server;
      io?.emit('chat:message', { accountId: conversation.zaloAccountId, message, conversationId: id });

      return message;
    } catch (err: any) {
      logger.error('[chat] Create Zalo reminder error:', err?.message || err);
      return reply.status(500).send({ error: err?.message || 'Tạo nhắc hẹn Zalo thất bại' });
    }
  });

  // ── Remove Zalo Reminder ──────────────────────────────────────────────────
  app.post('/api/v1/conversations/:id/reminders/:reminderId/remove', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id, reminderId } = request.params as { id: string; reminderId: string };

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
      include: { zaloAccount: true },
    });
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });

    const instance = zaloPool.getInstance(conversation.zaloAccountId);
    if (!instance?.api) return reply.status(400).send({ error: 'Zalo account not connected' });

    try {
      const threadId = conversation.externalThreadId || '';
      const threadType = conversation.threadType === 'group' ? 1 : 0;
      await instance.api.removeReminder(reminderId, threadId, threadType);
      return { success: true };
    } catch (err: any) {
      logger.error('[chat] Remove Zalo reminder error:', err?.message || err);
      return reply.status(500).send({ error: err?.message || 'Không thể xóa nhắc hẹn' });
    }
  });

  // ── Send Typing Indicator ────────────────────────────────────────────────
  app.post('/api/v1/conversations/:id/typing', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
    });
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });

    if (conversation.channel === 'whatsapp') return { success: true, skipped: true };
    const instance = zaloPool.getInstance(conversation.zaloAccountId);
    if (!instance?.api) return reply.status(400).send({ error: 'Zalo account not connected' });

    try {
      const threadId = conversation.externalThreadId || '';
      const threadType = conversation.threadType === 'group' ? 1 : 0;
      await instance.api.sendTypingEvent(threadId, threadType);
      return { success: true };
    } catch {
      return { success: false };
    }
  });

  // ── Forward message to one or more conversations ─────────────────────────
  app.post('/api/v1/conversations/forward', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { targetConversationIds, messageId, extraText } = request.body as {
      targetConversationIds: string[];
      messageId: string;
      extraText?: string;
    };

    if (!Array.isArray(targetConversationIds) || targetConversationIds.length === 0) {
      return reply.status(400).send({ error: 'targetConversationIds required' });
    }
    if (!messageId) {
      return reply.status(400).send({ error: 'messageId required' });
    }

    const sourceMessage = await prisma.message.findFirst({
      where: { id: messageId },
      include: {
        conversation: {
          include: { zaloAccount: true },
        },
      },
    });

    if (!sourceMessage) {
      return reply.status(404).send({ error: 'Source message not found' });
    }

    if (sourceMessage.conversation.orgId !== user.orgId) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const io = (app as any).io as Server;
    const results: any[] = [];

    const resolveForwardAssetBuffer = async (assetUrl: string): Promise<Buffer | null> => {
      if (!assetUrl) return null;
      if (
        assetUrl.startsWith('/storage/') ||
        assetUrl.startsWith('/uploads/') ||
        assetUrl.startsWith('/api/zalo-assets/') ||
        assetUrl.startsWith('/api/v1/files/raw/')
      ) {
        const localPath = await resolveSafeLocalFilePath(assetUrl);
        if (localPath) {
          return await fs.promises.readFile(localPath);
        }
        return null;
      }
      if (assetUrl.startsWith('https://')) {
        const check = await validateZaloProxyUrl(assetUrl, { allowAnyPublicHttps: true });
        if (!check.ok) return null;
        try {
          const sourceInstance = zaloPool.getInstance(sourceMessage.conversation.zaloAccountId);
          const headers: Record<string, string> = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          };
          if (sourceInstance?.api && /(?:^|\.)zalo\.me$/i.test(check.url.hostname)) {
            try {
              const ctx = sourceInstance.api.getContext();
              const cookie = await ctx.cookie.getCookieString(check.url.toString());
              if (cookie) headers['Cookie'] = cookie;
            } catch {}
          }
          let res = await fetch(check.url.toString(), { headers, redirect: 'manual', signal: AbortSignal.timeout(30000) });
          if (!res.ok && headers['Cookie']) {
            res = await fetch(check.url.toString(), {
              headers: { 'User-Agent': headers['User-Agent'] },
              redirect: 'manual',
              signal: AbortSignal.timeout(30000),
            });
          }
          if (res.ok) {
            const buf = Buffer.from(await res.arrayBuffer());
            if (buf.length <= MAX_REMOTE_PROXY_BYTES) return buf;
          }
        } catch (dlErr) {
          logger.error('[chat-forward] Error downloading asset:', dlErr);
        }
      }
      return null;
    };

    const emitForwardedMsg = (targetConv: any, msgObj: any) => {
      if (!io) return;
      const ch = targetConv.channel || targetConv.zaloAccount?.channel || 'zalo';
      io.to(`org:${user.orgId}`).emit('message:new', { ...msgObj, channel: ch, conversationId: targetConv.id });
      io.to(`conversation:${targetConv.id}`).emit('message:new', { ...msgObj, channel: ch, conversationId: targetConv.id });
      io.emit('chat:message', { accountId: targetConv.zaloAccountId, message: msgObj, conversationId: targetConv.id });
    };

    for (const targetId of targetConversationIds) {
      try {
        const targetConv = await prisma.conversation.findFirst({
          where: { id: targetId, orgId: user.orgId },
          include: { zaloAccount: true, contact: { select: { notes: true } } },
        });

        if (!targetConv) continue;

        // Apply accountant check for target conversation
        if (user.role === 'accountant') {
          const isGroup = targetConv.threadType === 'group';
          const notesStr = (targetConv.contact?.notes || '').toLowerCase();
          const hasTransfer = notesStr.includes('[chuyển cho kế toán]');
          if (!isGroup && !hasTransfer) {
            continue;
          }
        }

        const targetIsWhatsApp =
          targetConv.channel === 'whatsapp' || targetConv.zaloAccount?.channel === 'whatsapp';
        const instance = !targetIsWhatsApp ? zaloPool.getInstance(targetConv.zaloAccountId) : null;
        if (targetIsWhatsApp) {
          if (whatsappPool.getStatus(targetConv.zaloAccountId) !== 'connected') continue;
        } else if (!instance?.api) {
          continue;
        }

        const targetThreadId = targetConv.externalThreadId || '';
        const targetThreadType = targetConv.threadType === 'group' ? 1 : 0;

        const forwardAttachment: any = {
          type: 'forwarded',
          originalSender: sourceMessage.senderName || 'Người dùng',
          sourceConversationId: sourceMessage.conversationId,
          sourceMessageId: sourceMessage.id,
        };

        const rawContent = (sourceMessage.content || '').trim();
        let parsedJson: any = null;
        if (rawContent.startsWith('{')) {
          try {
            parsedJson = JSON.parse(rawContent);
            if (typeof parsedJson.params === 'string') {
              try { parsedJson.params = JSON.parse(parsedJson.params); } catch {}
            }
          } catch {}
        }

        // Extract possible image candidate URL early
        let detectedImageUrl = '';
        if (parsedJson) {
          detectedImageUrl =
            parsedJson.localUrl ||
            parsedJson.hdUrl ||
            parsedJson.normalUrl ||
            parsedJson.href ||
            parsedJson.thumb ||
            parsedJson.params?.hd ||
            parsedJson.params?.rawUrl ||
            parsedJson.fileUrl ||
            '';
        }
        if (!detectedImageUrl && rawContent) {
          const match = rawContent.match(/(https?:\/\/[^\s"'<>\\]+?\.(?:jpg|jpeg|png|webp|gif|bmp|heic|heif)(?:\?[^\s"'<>\\]*)?)/i) ||
                        rawContent.match(/(https?:\/\/[^\s"'<>\\]*?zdn\.vn[^\s"'<>\\]*)/i);
          if (match) detectedImageUrl = match[1];
        }

        // Intelligently detect media type from DB content or JSON payload
        const isVoiceMsg =
          sourceMessage.contentType === 'voice' ||
          Boolean(parsedJson?.voiceUrl) ||
          parsedJson?.action === 'voice';

        const isVideo =
          !isVoiceMsg &&
          (sourceMessage.contentType === 'video' ||
            Boolean(parsedJson?.videoUrl || parsedJson?.params?.videoUrl) ||
            parsedJson?.type === 'video' ||
            /\.(mp4|mov|avi|mkv|webm|m4v)(\?.*)?$/i.test(parsedJson?.localUrl || parsedJson?.href || parsedJson?.params?.rawUrl || rawContent) ||
            parsedJson?.params?.extention === 'mp4' ||
            parsedJson?.params?.fType === 2);

        const isFile =
          !isVoiceMsg &&
          !isVideo &&
          (sourceMessage.contentType === 'file' ||
            Boolean(parsedJson?.params?.fileExt) ||
            parsedJson?.params?.fType === 1 ||
            /\.(pdf|xlsx?|docx?|pptx?|zip|rar|tar|gz|7z|txt|csv|rtf)(\?.*)?$/i.test(parsedJson?.title || parsedJson?.localUrl || parsedJson?.href || ''));

        const isImage =
          !isVoiceMsg &&
          !isVideo &&
          !isFile &&
          (sourceMessage.contentType === 'image' ||
            Boolean(detectedImageUrl) ||
            parsedJson?.childnumber !== undefined ||
            parsedJson?.params?.rawUrl ||
            parsedJson?.params?.convertible === 'jxl' ||
            parsedJson?.hdUrl ||
            parsedJson?.normalUrl ||
            /\.(jpg|jpeg|png|webp|gif|bmp|heic|heif)(\?.*)?$/i.test(parsedJson?.localUrl || parsedJson?.href || parsedJson?.thumb || parsedJson?.params?.rawUrl || rawContent) ||
            (parsedJson?.href && parsedJson.href.includes('zdn.vn')) ||
            rawContent.includes('zdn.vn'));

        if (isVoiceMsg) {
          const voiceUrl =
            parsedJson?.localUrl ||
            parsedJson?.voiceUrl ||
            parsedJson?.href ||
            (rawContent.startsWith('/storage/') || rawContent.startsWith('/uploads/') || rawContent.startsWith('http') ? rawContent : '');
          const voiceBuf = await resolveForwardAssetBuffer(voiceUrl);
          if (voiceBuf && targetIsWhatsApp) {
            const sent = await whatsappPool.sendVoice(targetConv.zaloAccountId, targetThreadId, voiceBuf, 'audio/ogg; codecs=opus');
            const { localUrl } = await saveChatFileBuffer(voiceBuf, `voice_fwd_${Date.now()}.ogg`);
            const newMsg = await prisma.message.create({
              data: {
                id: randomUUID(),
                conversationId: targetId,
                zaloMsgId: sent.id,
                senderType: 'self',
                senderUid: targetConv.zaloAccount.zaloUid || '',
                senderName: 'Staff',
                content: JSON.stringify({ href: localUrl, voiceUrl: localUrl, localUrl, action: 'voice' }),
                contentType: 'voice',
                attachments: [forwardAttachment, { type: 'voice', url: localUrl, href: localUrl, localUrl }],
                sentAt: new Date(),
                repliedByUserId: user.id,
              },
              include: { repliedBy: { select: { id: true, fullName: true, role: true } } },
            });
            await prisma.conversation.update({
              where: { id: targetId },
              data: { lastMessageAt: new Date(), isReplied: true, unreadCount: 0 },
            });
            emitForwardedMsg(targetConv, newMsg);
            results.push(newMsg);
          } else if (voiceBuf && instance?.api) {
            const sendRes = await instance.api.sendMessage(
              { msg: extraText ? extraText.trim() : '', attachments: [{ data: voiceBuf, filename: 'forwarded_voice.m4a', metadata: { totalSize: voiceBuf.length } }] },
              targetThreadId,
              targetThreadType,
            );
            const { zaloMsgId, cliMsgId } = extractZaloMsgDetails(sendRes);
            const attList: any[] = [forwardAttachment];
            if (cliMsgId) attList.push({ type: 'zalo_meta', cliMsgId: String(cliMsgId) });
            const newMsg = await prisma.message.create({
              data: {
                id: randomUUID(),
                conversationId: targetId,
                zaloMsgId,
                senderType: 'self',
                senderUid: targetConv.zaloAccount.zaloUid || '',
                senderName: 'Staff',
                content: sourceMessage.content || '[Tin nhắn thoại]',
                contentType: 'voice',
                attachments: attList,
                sentAt: new Date(),
                repliedByUserId: user.id,
              },
              include: { repliedBy: { select: { id: true, fullName: true, role: true } } },
            });
            await prisma.conversation.update({
              where: { id: targetId },
              data: { lastMessageAt: new Date(), isReplied: true, unreadCount: 0 },
            });
            emitForwardedMsg(targetConv, newMsg);
            results.push(newMsg);
          }
        } else if (isVideo) {
          // ── A. FORWARD VIDEO ───────────────────────────────────────────────────
          const videoUrl =
            parsedJson?.localUrl ||
            parsedJson?.videoUrl ||
            parsedJson?.params?.videoUrl ||
            parsedJson?.params?.rawUrl ||
            parsedJson?.href ||
            (rawContent.startsWith('/storage/') || rawContent.startsWith('/uploads/') || rawContent.startsWith('http') ? rawContent : '');
          const thumbUrl = parsedJson?.thumbnailUrl || parsedJson?.thumb || parsedJson?.params?.thumbUrl || '';
          const duration = parseInt(parsedJson?.params?.duration || parsedJson?.duration || '5000', 10);
          const videoWidth = parseInt(parsedJson?.params?.videoWidth || parsedJson?.params?.width || parsedJson?.width || '1280', 10);
          const videoHeight = parseInt(parsedJson?.params?.videoHeight || parsedJson?.params?.height || parsedJson?.height || '720', 10);

          let videoSent = false;
          let videoMsgId: any = null;
          let finalVideoContent = sourceMessage.content || '';
          const videoAtts: any[] = [forwardAttachment];

          if (targetIsWhatsApp) {
            const vidBuffer = await resolveForwardAssetBuffer(videoUrl);
            if (vidBuffer) {
              const { localUrl } = await saveChatFileBuffer(vidBuffer, 'forwarded_video.mp4');
              const sent = await whatsappPool.sendMedia(
                targetConv.zaloAccountId,
                targetThreadId,
                vidBuffer,
                'forwarded_video.mp4',
                'video/mp4',
                extraText?.trim() || '',
              );
              videoMsgId = sent.id;
              videoSent = true;
              finalVideoContent = JSON.stringify({
                videoUrl: localUrl,
                href: localUrl,
                localUrl,
                thumb: '',
                ...(extraText?.trim() ? { title: extraText.trim(), caption: extraText.trim() } : {}),
              });
              videoAtts.push({ type: 'video', url: localUrl, href: localUrl, localUrl, videoUrl: localUrl });
            }
          } else if (instance?.api) {
            // 1. Try native sendVideo API in zca-js if videoUrl is remote HTTPS
            if (videoUrl && videoUrl.startsWith('https://') && typeof instance.api.sendVideo === 'function') {
              try {
                const svRes = await instance.api.sendVideo(
                  {
                    videoUrl,
                    thumbnailUrl: thumbUrl || videoUrl,
                    duration: duration || 5000,
                    width: videoWidth,
                    height: videoHeight,
                    msg: extraText ? extraText.trim() : '',
                  },
                  targetThreadId,
                  targetThreadType
                );
                videoMsgId = (svRes as any)?.msgId || (svRes as any)?.id || null;
                videoSent = true;
              } catch (svErr) {
                logger.warn('[chat-forward] sendVideo failed, trying buffer download:', svErr);
              }
            }

            // 2. Fallback: Download or read local video buffer and send via uploadAttachment
            if (!videoSent && videoUrl) {
              const vidBuffer = await resolveForwardAssetBuffer(videoUrl);
              if (vidBuffer) {
                try {
                  const attachmentSource: any = {
                    data: vidBuffer,
                    filename: 'forwarded_video.mp4',
                    metadata: {
                      totalSize: vidBuffer.length,
                    },
                  };
                  const sendRes = await instance.api.sendMessage(
                    { msg: extraText ? extraText.trim() : '', attachments: [attachmentSource] },
                    targetThreadId,
                    targetThreadType
                  );
                  const { zaloMsgId: extractedVidMsgId, cliMsgId: vidCliMsgId } = extractZaloMsgDetails(sendRes);
                  videoMsgId = extractedVidMsgId;
                  if (vidCliMsgId) {
                    forwardAttachment.cliMsgId = String(vidCliMsgId);
                  }
                  videoSent = true;
                  if (sendRes?.attachment && sendRes.attachment.length > 0) {
                    const att = sendRes.attachment[0];
                    finalVideoContent = JSON.stringify({
                      videoUrl: att.fileUrl || att.url || videoUrl,
                      thumb: thumbUrl,
                      duration,
                      width: videoWidth,
                      height: videoHeight,
                      ...(extraText?.trim() ? { title: extraText.trim(), caption: extraText.trim() } : {}),
                    });
                  }
                } catch (sendErr) {
                  logger.error('[chat-forward] Send video buffer failed:', sendErr);
                }
              }
            }
          }

          if (videoSent) {
            const newMsg = await prisma.message.create({
              data: {
                id: randomUUID(),
                conversationId: targetId,
                zaloMsgId: videoMsgId,
                senderType: 'self',
                senderUid: targetConv.zaloAccount.zaloUid || '',
                senderName: 'Staff',
                content: finalVideoContent,
                contentType: 'video',
                attachments: videoAtts,
                sentAt: new Date(),
                repliedByUserId: user.id,
              },
              include: {
                repliedBy: { select: { id: true, fullName: true, role: true } },
              },
            });

            await prisma.conversation.update({
              where: { id: targetId },
              data: { lastMessageAt: new Date(), isReplied: true, unreadCount: 0 },
            });

            emitForwardedMsg(targetConv, newMsg);
            results.push(newMsg);
          } else {
            // NEVER send raw JSON code! Send clean video link preview
            const cleanText = `${extraText ? `${extraText}\n` : ''}🎥 [Video] ${videoUrl}`;
            const sendRes = targetIsWhatsApp
              ? await whatsappPool.sendMessage(targetConv.zaloAccountId, targetThreadId, cleanText)
              : await instance!.api.sendMessage({ msg: cleanText }, targetThreadId, targetThreadType);
            const { zaloMsgId, cliMsgId } = targetIsWhatsApp
              ? { zaloMsgId: sendRes?.id || null, cliMsgId: null }
              : extractZaloMsgDetails(sendRes);
            const attList: any[] = [forwardAttachment];
            if (cliMsgId) {
              attList.push({ type: 'zalo_meta', cliMsgId: String(cliMsgId) });
            }
            const newMsg = await prisma.message.create({
              data: {
                id: randomUUID(),
                conversationId: targetId,
                zaloMsgId,
                senderType: 'self',
                senderUid: targetConv.zaloAccount.zaloUid || '',
                senderName: 'Staff',
                content: cleanText,
                contentType: 'text',
                attachments: attList,
                sentAt: new Date(),
                repliedByUserId: user.id,
              },
              include: {
                repliedBy: { select: { id: true, fullName: true, role: true } },
              },
            });
            await prisma.conversation.update({
              where: { id: targetId },
              data: { lastMessageAt: new Date(), isReplied: true, unreadCount: 0 },
            });
            emitForwardedMsg(targetConv, newMsg);
            results.push(newMsg);
          }
        } else if (isImage) {
          // ── B. FORWARD IMAGE ───────────────────────────────────────────────────
          let imageUrl = detectedImageUrl;
          if (parsedJson) {
            imageUrl =
              parsedJson.localUrl ||
              parsedJson.hdUrl ||
              parsedJson.normalUrl ||
              parsedJson.href ||
              parsedJson.thumb ||
              parsedJson.params?.hd ||
              parsedJson.params?.rawUrl ||
              parsedJson.fileUrl ||
              imageUrl;
          } else if (rawContent.startsWith('http') || rawContent.startsWith('/storage/') || rawContent.startsWith('/uploads/')) {
            imageUrl = rawContent;
          }

          const imgBuffer = await resolveForwardAssetBuffer(imageUrl);

          if (imgBuffer && targetIsWhatsApp) {
            const imgFmt = detectImageFormatFromBuffer(imgBuffer);
            const { localUrl } = await saveChatFileBuffer(imgBuffer, `forwarded_image.${imgFmt.ext}`);
            const sent = await whatsappPool.sendMedia(
              targetConv.zaloAccountId,
              targetThreadId,
              imgBuffer,
              `forwarded_image.${imgFmt.ext}`,
              imgFmt.mime,
              extraText?.trim() || '',
            );
            const finalContent = JSON.stringify({
              href: localUrl,
              thumb: localUrl,
              hdUrl: localUrl,
              localUrl,
              ...(extraText?.trim() ? { title: extraText.trim(), caption: extraText.trim() } : {}),
            });
            const newMsg = await prisma.message.create({
              data: {
                id: randomUUID(),
                conversationId: targetId,
                zaloMsgId: sent.id,
                senderType: 'self',
                senderUid: targetConv.zaloAccount.zaloUid || '',
                senderName: 'Staff',
                content: finalContent,
                contentType: 'image',
                attachments: [forwardAttachment, { type: 'image', url: localUrl, href: localUrl, localUrl }],
                sentAt: new Date(),
                repliedByUserId: user.id,
              },
              include: { repliedBy: { select: { id: true, fullName: true, role: true } } },
            });
            await prisma.conversation.update({
              where: { id: targetId },
              data: { lastMessageAt: new Date(), isReplied: true, unreadCount: 0 },
            });
            emitForwardedMsg(targetConv, newMsg);
            results.push(newMsg);
          } else if (imgBuffer && instance?.api) {
            const imgFmt = detectImageFormatFromBuffer(imgBuffer);
            const attachmentSource: any = {
              data: imgBuffer,
              filename: `forwarded_image.${imgFmt.ext}`,
              metadata: {
                totalSize: imgBuffer.length,
                width: parsedJson?.params?.width || 800,
                height: parsedJson?.params?.height || 600,
              },
            };

            const sendRes = await instance.api.sendMessage(
              { msg: extraText ? extraText.trim() : '', attachments: [attachmentSource] },
              targetThreadId,
              targetThreadType
            );

            const attList: any[] = [forwardAttachment];
            const safeImageUrl = imageUrl || detectedImageUrl || parsedJson?.href || parsedJson?.thumb || '';
            let finalContent = JSON.stringify({
              href: safeImageUrl,
              thumb: safeImageUrl,
              hdUrl: safeImageUrl,
              ...(extraText?.trim() ? { title: extraText.trim(), caption: extraText.trim() } : {}),
            });
            if (sendRes?.attachment && sendRes.attachment.length > 0) {
              const att = sendRes.attachment[0];
              attList.unshift(att);
              finalContent = JSON.stringify({
                href: att.normalUrl || att.fileUrl || safeImageUrl,
                thumb: att.thumbUrl || att.fileUrl || safeImageUrl,
                hdUrl: att.hdUrl || att.fileUrl || safeImageUrl,
                ...(extraText?.trim() ? { title: extraText.trim(), caption: extraText.trim() } : {}),
              });
            }

            const { zaloMsgId, cliMsgId } = extractZaloMsgDetails(sendRes);
            if (cliMsgId) {
              attList.push({ type: 'zalo_meta', cliMsgId: String(cliMsgId) });
            }
            const newMsg = await prisma.message.create({
              data: {
                id: randomUUID(),
                conversationId: targetId,
                zaloMsgId,
                senderType: 'self',
                senderUid: targetConv.zaloAccount.zaloUid || '',
                senderName: 'Staff',
                content: finalContent,
                contentType: 'image',
                attachments: attList,
                sentAt: new Date(),
                repliedByUserId: user.id,
              },
              include: {
                repliedBy: { select: { id: true, fullName: true, role: true } },
              },
            });

            await prisma.conversation.update({
              where: { id: targetId },
              data: { lastMessageAt: new Date(), isReplied: true, unreadCount: 0 },
            });

            emitForwardedMsg(targetConv, newMsg);
            results.push(newMsg);
          } else {
            // NEVER send raw JSON! Send clean text with image URL
            const textContent = `${extraText ? `${extraText}\n` : ''}${imageUrl || '[Hình ảnh]'}`;
            const sendRes = targetIsWhatsApp
              ? await whatsappPool.sendMessage(targetConv.zaloAccountId, targetThreadId, textContent)
              : await instance!.api.sendMessage({ msg: textContent }, targetThreadId, targetThreadType);
            const { zaloMsgId, cliMsgId } = targetIsWhatsApp
              ? { zaloMsgId: sendRes?.id || null, cliMsgId: null }
              : extractZaloMsgDetails(sendRes);
            const attList: any[] = [forwardAttachment];
            if (cliMsgId) {
              attList.push({ type: 'zalo_meta', cliMsgId: String(cliMsgId) });
            }
            const newMsg = await prisma.message.create({
              data: {
                id: randomUUID(),
                conversationId: targetId,
                zaloMsgId,
                senderType: 'self',
                senderUid: targetConv.zaloAccount.zaloUid || '',
                senderName: 'Staff',
                content: textContent,
                contentType: 'text',
                attachments: attList,
                sentAt: new Date(),
                repliedByUserId: user.id,
              },
              include: {
                repliedBy: { select: { id: true, fullName: true, role: true } },
              },
            });

            await prisma.conversation.update({
              where: { id: targetId },
              data: { lastMessageAt: new Date(), isReplied: true, unreadCount: 0 },
            });

            emitForwardedMsg(targetConv, newMsg);
            results.push(newMsg);
          }
        } else if (isFile) {
          // ── C. FORWARD FILE ────────────────────────────────────────────────────
          const fileUrl =
            parsedJson?.localUrl ||
            parsedJson?.href ||
            (rawContent.startsWith('/storage/') || rawContent.startsWith('/uploads/') || rawContent.startsWith('http') ? rawContent : '');
          const fileName = parsedJson?.title || 'forwarded_file';
          const fileBuffer = await resolveForwardAssetBuffer(fileUrl);

          if (fileBuffer && targetIsWhatsApp) {
            const { localUrl } = await saveChatFileBuffer(fileBuffer, fileName);
            const sent = await whatsappPool.sendMedia(
              targetConv.zaloAccountId,
              targetThreadId,
              fileBuffer,
              fileName,
              getSafeServeMimeType(fileName),
              extraText?.trim() || '',
            );
            const extMatch = fileName.match(/\.([a-zA-Z0-9]+)$/);
            const newMsg = await prisma.message.create({
              data: {
                id: randomUUID(),
                conversationId: targetId,
                zaloMsgId: sent.id,
                senderType: 'self',
                senderUid: targetConv.zaloAccount.zaloUid || '',
                senderName: 'Staff',
                content: JSON.stringify({
                  title: fileName,
                  href: localUrl,
                  localUrl,
                  params: JSON.stringify({
                    fileSize: String(fileBuffer.length),
                    ...(extMatch ? { fileExt: extMatch[1].toLowerCase() } : {}),
                  }),
                }),
                contentType: 'file',
                attachments: [forwardAttachment, { type: 'file', url: localUrl, href: localUrl, localUrl, name: fileName }],
                sentAt: new Date(),
                repliedByUserId: user.id,
              },
              include: { repliedBy: { select: { id: true, fullName: true, role: true } } },
            });
            await prisma.conversation.update({
              where: { id: targetId },
              data: { lastMessageAt: new Date(), isReplied: true, unreadCount: 0 },
            });
            emitForwardedMsg(targetConv, newMsg);
            results.push(newMsg);
          } else if (fileBuffer && instance?.api) {
            const attachmentSource: any = {
              data: fileBuffer,
              filename: fileName,
              metadata: { totalSize: fileBuffer.length },
            };
            const sendRes = await instance.api.sendMessage(
              { msg: extraText ? extraText.trim() : '', attachments: [attachmentSource] },
              targetThreadId,
              targetThreadType
            );
            const { zaloMsgId, cliMsgId } = extractZaloMsgDetails(sendRes);
            const fileAttList: any[] = [forwardAttachment];
            if (cliMsgId) {
              fileAttList.push({ type: 'zalo_meta', cliMsgId: String(cliMsgId) });
            }
            const newMsg = await prisma.message.create({
              data: {
                id: randomUUID(),
                conversationId: targetId,
                zaloMsgId,
                senderType: 'self',
                senderUid: targetConv.zaloAccount.zaloUid || '',
                senderName: 'Staff',
                content: sourceMessage.content || `[Tệp: ${fileName}]`,
                contentType: 'file',
                attachments: fileAttList,
                sentAt: new Date(),
                repliedByUserId: user.id,
              },
              include: {
                repliedBy: { select: { id: true, fullName: true, role: true } },
              },
            });
            await prisma.conversation.update({
              where: { id: targetId },
              data: { lastMessageAt: new Date(), isReplied: true, unreadCount: 0 },
            });
            emitForwardedMsg(targetConv, newMsg);
            results.push(newMsg);
          } else {
            const cleanText = `${extraText ? `${extraText}\n` : ''}📎 [Tệp: ${fileName}] ${fileUrl}`;
            const sendRes = targetIsWhatsApp
              ? await whatsappPool.sendMessage(targetConv.zaloAccountId, targetThreadId, cleanText)
              : await instance!.api.sendMessage({ msg: cleanText }, targetThreadId, targetThreadType);
            const { zaloMsgId, cliMsgId } = targetIsWhatsApp
              ? { zaloMsgId: sendRes?.id || null, cliMsgId: null }
              : extractZaloMsgDetails(sendRes);
            const fallbackFileAttList: any[] = [forwardAttachment];
            if (cliMsgId) {
              fallbackFileAttList.push({ type: 'zalo_meta', cliMsgId: String(cliMsgId) });
            }
            const newMsg = await prisma.message.create({
              data: {
                id: randomUUID(),
                conversationId: targetId,
                zaloMsgId,
                senderType: 'self',
                senderUid: targetConv.zaloAccount.zaloUid || '',
                senderName: 'Staff',
                content: cleanText,
                contentType: 'text',
                attachments: fallbackFileAttList,
                sentAt: new Date(),
                repliedByUserId: user.id,
              },
              include: {
                repliedBy: { select: { id: true, fullName: true, role: true } },
              },
            });
            await prisma.conversation.update({
              where: { id: targetId },
              data: { lastMessageAt: new Date(), isReplied: true, unreadCount: 0 },
            });
            emitForwardedMsg(targetConv, newMsg);
            results.push(newMsg);
          }
        } else {
          // ── D. FORWARD TEXT MESSAGE ────────────────────────────────────────────
          let textToForward = rawContent;
          if (parsedJson) {
            textToForward = parsedJson.title || parsedJson.description || parsedJson.msg || parsedJson.caption || '';
          }
          // NEVER EVER send raw JSON code as a text message!
          if (!textToForward || textToForward.trim().startsWith('{')) {
            const urlMatch = rawContent.match(/https?:\/\/[^\s"'<>\\]+/);
            textToForward = urlMatch ? urlMatch[0] : (parsedJson?.caption || parsedJson?.title || '[Tin nhắn]');
          }
          const sendRes = targetIsWhatsApp
            ? await whatsappPool.sendMessage(targetConv.zaloAccountId, targetThreadId, textToForward)
            : await instance!.api.sendMessage({ msg: textToForward }, targetThreadId, targetThreadType);
          const { zaloMsgId, cliMsgId } = targetIsWhatsApp
            ? { zaloMsgId: sendRes?.id || null, cliMsgId: null }
            : extractZaloMsgDetails(sendRes);
          const textAttList: any[] = [forwardAttachment];
          if (cliMsgId) {
            textAttList.push({ type: 'zalo_meta', cliMsgId: String(cliMsgId) });
          }

          const newMsg = await prisma.message.create({
            data: {
              id: randomUUID(),
              conversationId: targetId,
              zaloMsgId,
              senderType: 'self',
              senderUid: targetConv.zaloAccount.zaloUid || '',
              senderName: 'Staff',
              content: textToForward,
              contentType: 'text',
              attachments: textAttList,
              sentAt: new Date(),
              repliedByUserId: user.id,
            },
            include: {
              repliedBy: { select: { id: true, fullName: true, role: true } },
            },
          });

          await prisma.conversation.update({
            where: { id: targetId },
            data: { lastMessageAt: new Date(), isReplied: true, unreadCount: 0 },
          });

          emitForwardedMsg(targetConv, newMsg);
          results.push(newMsg);

          if (extraText?.trim()) {
            const extraRes = targetIsWhatsApp
              ? await whatsappPool.sendMessage(targetConv.zaloAccountId, targetThreadId, extraText.trim())
              : await instance!.api.sendMessage({ msg: extraText.trim() }, targetThreadId, targetThreadType);
            const { zaloMsgId: extraZaloMsgId, cliMsgId: extraCliMsgId } = targetIsWhatsApp
              ? { zaloMsgId: extraRes?.id || null, cliMsgId: null }
              : extractZaloMsgDetails(extraRes);
            const extraAttList: any[] = [];
            if (extraCliMsgId) {
              extraAttList.push({ type: 'zalo_meta', cliMsgId: String(extraCliMsgId) });
            }
            const extraMsg = await prisma.message.create({
              data: {
                id: randomUUID(),
                conversationId: targetId,
                zaloMsgId: extraZaloMsgId,
                senderType: 'self',
                senderUid: targetConv.zaloAccount.zaloUid || '',
                senderName: 'Staff',
                content: extraText.trim(),
                contentType: 'text',
                attachments: extraAttList,
                sentAt: new Date(),
                repliedByUserId: user.id,
              },
              include: {
                repliedBy: { select: { id: true, fullName: true, role: true } },
              },
            });
            emitForwardedMsg(targetConv, extraMsg);
            results.push(extraMsg);
          }
        }
      } catch (err: any) {
        logger.error(`[chat-forward] Error forwarding to conversation ${targetId}:`, err);
      }
    }

    return { success: true, forwardedCount: results.length };
  });

  // ── Update Customer Status & Pinned Note (Lưu ý khách hàng / đơn hàng) ───
  app.patch('/api/v1/conversations/:id/customer-note', { preHandler: requireZaloAccess('read') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const { status, note, pinnedNote } = request.body as { status?: string; note?: string; pinnedNote?: string };

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
      include: { contact: true, zaloAccount: true },
    });
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });

    let contactId = conversation.contactId;

    if (!contactId) {
      const newContact = await prisma.contact.create({
        data: {
          orgId: user.orgId,
          fullName: conversation.threadType === 'group' ? 'Nhóm chat' : 'Khách hàng Zalo',
          zaloUid: conversation.externalThreadId,
          status: status || 'new',
          notes: note !== undefined ? note : (pinnedNote || null),
          metadata: {
            pinnedNote: pinnedNote !== undefined ? pinnedNote : (note || null),
            pinnedNoteUpdatedAt: new Date().toISOString(),
            pinnedNoteUpdatedBy: (user as any).fullName || user.email,
          },
        },
      });
      contactId = newContact.id;
      await prisma.conversation.update({
        where: { id },
        data: { contactId: newContact.id },
      });
    } else {
      const currentContact = conversation.contact!;
      const existingMeta = (typeof currentContact.metadata === 'object' && currentContact.metadata !== null)
        ? (currentContact.metadata as Record<string, any>)
        : {};

      const newMeta = { ...existingMeta };

      const finalPinnedNote = pinnedNote !== undefined ? pinnedNote : note;
      if (finalPinnedNote !== undefined) {
        newMeta.pinnedNote = finalPinnedNote;
        newMeta.pinnedNoteUpdatedAt = new Date().toISOString();
        newMeta.pinnedNoteUpdatedBy = (user as any).fullName || user.email;
      }

      const updateData: any = {
        metadata: newMeta,
      };
      if (status !== undefined) {
        updateData.status = status;
      }
      if (note !== undefined) {
        updateData.notes = note;
      }

      await prisma.contact.update({
        where: { id: contactId },
        data: updateData,
      });
    }

    const updated = await prisma.conversation.findUnique({
      where: { id },
      include: {
        contact: true,
        zaloAccount: { select: { id: true, displayName: true, zaloUid: true, status: true } },
      },
    });

    const io = (app as any).io as Server;
    io?.emit('conversation:updated', {
      conversationId: id,
      contact: updated?.contact,
    });

    return { success: true, conversation: updated, contact: updated?.contact };
  });

  // ── Undo / Recall message for everyone (Thu hồi tin nhắn cả 2 phía) ─────
  app.post('/api/v1/conversations/:id/messages/:messageId/undo', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id, messageId } = request.params as { id: string; messageId: string };
    const { force } = (request.body as { force?: boolean } | undefined) || {};

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
      include: { zaloAccount: true },
    });
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });

    let message = await prisma.message.findFirst({
      where: { id: messageId, conversationId: id },
    });
    if (!message) return reply.status(404).send({ error: 'Message not found' });

    if (message.isDeleted) {
      return { success: true, message, zaloSynced: true };
    }

    let isSynced = false;
    let syncWarning: string | undefined = undefined;
    const sisterIds: string[] = [];

    if (conversation.channel === 'whatsapp' || conversation.zaloAccount?.channel === 'whatsapp') {
      if (message.zaloMsgId) {
        try {
          const waRevoked = await whatsappPool.revokeMessage(
            conversation.zaloAccountId,
            conversation.externalThreadId || '',
            message.zaloMsgId
          );
          if (waRevoked) {
            isSynced = true;
          } else {
            syncWarning = 'Không thể thu hồi tin nhắn trên WhatsApp (tin nhắn có thể đã quá hạn)';
          }
        } catch (waErr: any) {
          syncWarning = waErr?.message || String(waErr);
        }
      } else {
        syncWarning = 'Tin nhắn WhatsApp chưa có mã định danh để thu hồi';
      }
    } else {
      // Zalo channel
      const instance = zaloPool.getInstance(conversation.zaloAccountId);
      if (!instance?.api) {
        syncWarning = 'Tài khoản Zalo chưa kết nối trên hệ thống';
      } else {
        // Fallback: If message.zaloMsgId is missing, check if listener updated it or match recent message
        if (!message.zaloMsgId) {
          const fresh = await prisma.message.findUnique({ where: { id: messageId } });
          if (fresh?.zaloMsgId) {
            message = fresh;
          } else if (message.sentAt) {
            const sixtySecs = new Date(message.sentAt.getTime() - 60000);
            const matching = await prisma.message.findFirst({
              where: {
                conversationId: id,
                zaloMsgId: { not: null },
                sentAt: { gte: sixtySecs },
                ...(message.content ? { content: message.content } : {}),
              },
              orderBy: { sentAt: 'desc' },
            });
            if (matching?.zaloMsgId) {
              message.zaloMsgId = matching.zaloMsgId;
              if (matching.attachments) {
                message.attachments = matching.attachments;
              }
              await prisma.message.update({
                where: { id: messageId },
                data: { zaloMsgId: matching.zaloMsgId },
              });
            }
          }
        }

        // Find stored cliMsgId from message attachments if present
        let storedCliMsgId: string | undefined;
        if (Array.isArray(message.attachments)) {
          const meta = (message.attachments as any[]).find(
            (a: any) => a?.type === 'zalo_meta' || a?.cliMsgId
          );
          if (meta?.cliMsgId) {
            storedCliMsgId = String(meta.cliMsgId);
          }
        }

        // Collect candidate msgIds and cliMsgIds (from message itself and any duplicate sister messages)
        const candidateMsgIds: string[] = [];
        if (message.zaloMsgId) candidateMsgIds.push(String(message.zaloMsgId));

        const candidateCliMsgIds: string[] = [];
        if (storedCliMsgId) candidateCliMsgIds.push(storedCliMsgId);
        // Primary fallback: Zalo API reliably accepts '0' when client message ID is unknown
        candidateCliMsgIds.push('0');
        if (message.sentAt) candidateCliMsgIds.push(String(new Date(message.sentAt).getTime()));

        // Find any sister messages in the same conversation within 120s with matching content or sentAt
        if (message.sentAt) {
          const windowStart = new Date(message.sentAt.getTime() - 120000);
          const windowEnd = new Date(message.sentAt.getTime() + 120000);
          try {
            const sisterMsgs = await prisma.message.findMany({
              where: {
                conversationId: id,
                id: { not: message.id },
                senderType: 'self',
                sentAt: { gte: windowStart, lte: windowEnd },
                ...(message.content ? { content: message.content } : {}),
              },
              select: { id: true, zaloMsgId: true, attachments: true },
            });
            for (const s of sisterMsgs) {
              sisterIds.push(s.id);
              if (s.zaloMsgId && !candidateMsgIds.includes(String(s.zaloMsgId))) {
                candidateMsgIds.push(String(s.zaloMsgId));
              }
              if (Array.isArray(s.attachments)) {
                for (const a of s.attachments as any[]) {
                  if (a?.cliMsgId && !candidateCliMsgIds.includes(String(a.cliMsgId))) {
                    candidateCliMsgIds.push(String(a.cliMsgId));
                  }
                }
              }
            }
          } catch (sisterErr) {
            logger.warn('[chat-routes] Failed to find sister messages for undo:', sisterErr);
          }
        }

        if (candidateMsgIds.length === 0) {
          syncWarning = 'Không tìm thấy ID Zalo của tin nhắn (tin nhắn có thể chưa đồng bộ hoặc gửi không thành công)';
        } else {
          const threadId = conversation.externalThreadId || '';
          const threadType = conversation.threadType === 'group' ? 1 : 0;

          for (const mid of candidateMsgIds) {
            if (!candidateCliMsgIds.includes(mid)) candidateCliMsgIds.push(mid);
          }
          candidateCliMsgIds.push('0');

          const uniqueMsgIds = Array.from(new Set(candidateMsgIds));
          const uniqueCliMsgIds = Array.from(new Set(candidateCliMsgIds));
          let undoSuccess = false;
          let lastZaloErr: any = null;

          for (const mid of uniqueMsgIds) {
            if (undoSuccess) break;
            for (const cand of uniqueCliMsgIds) {
              try {
                logger.info(`[chat-routes] Invoking instance.api.undo for msgId=${mid}, cliMsgId=${cand}, threadId=${threadId}, type=${threadType}`);
                const zRes = await instance.api.undo(
                  { msgId: mid, cliMsgId: cand },
                  threadId,
                  threadType
                );
                logger.info(`[chat-routes] Undone message ${mid} on Zalo successfully:`, zRes);
                undoSuccess = true;
                isSynced = true;
                break;
              } catch (err: any) {
                lastZaloErr = err;
                logger.warn(`[chat-routes] Undo attempt with msgId=${mid}, cliMsgId=${cand} failed: ${err?.message || err}`);
              }
            }
          }

          if (!undoSuccess) {
            isSynced = false;
            const errMsg = lastZaloErr?.message || '';
            if (errMsg.includes('Lỗi không xác định') || errMsg.includes('ZaloApiError') || errMsg.includes('110') || errMsg.includes('100')) {
              syncWarning = 'Zalo từ chối thu hồi (tin nhắn có thể đã quá 24h hoặc đã được thu hồi trước đó trên Zalo).';
            } else {
              syncWarning = errMsg || 'Zalo từ chối thu hồi tin nhắn.';
            }
          }
        }
      }
    }

    // If not synced and not forced, return error so the UI does NOT falsely report success!
    if (!isSynced && !force) {
      return reply.status(400).send({
        success: false,
        error: syncWarning || 'Thu hồi tin nhắn trên Zalo không thành công',
        zaloSynced: false,
        zaloWarning: syncWarning,
      });
    }

    const updated = await prisma.message.update({
      where: { id: messageId },
      data: { isDeleted: true, deletedAt: new Date() },
      include: { repliedBy: { select: { id: true, fullName: true, role: true } } },
    });

    if (sisterIds.length > 0) {
      await prisma.message.updateMany({
        where: { id: { in: sisterIds } },
        data: { isDeleted: true, deletedAt: new Date() },
      }).catch(() => {});
    }

    const io = (app as any).io as Server;
    io?.emit('chat:message-undo', {
      accountId: conversation.zaloAccountId,
      conversationId: id,
      messageId: message.id,
      zaloMsgId: message.zaloMsgId,
    });
    for (const sid of sisterIds) {
      io?.emit('chat:message-undo', {
        accountId: conversation.zaloAccountId,
        conversationId: id,
        messageId: sid,
      });
    }

    return { success: true, message: updated, zaloSynced: isSynced, zaloWarning: syncWarning };
  });

  // ── Delete message for me only (Xóa chỉ ở phía tôi) ──────────────────────
  app.post('/api/v1/conversations/:id/messages/:messageId/delete-for-me', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id, messageId } = request.params as { id: string; messageId: string };

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
      include: { zaloAccount: true },
    });
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });

    const message = await prisma.message.findFirst({
      where: { id: messageId, conversationId: id },
    });
    if (!message) return reply.status(404).send({ error: 'Message not found' });

    const isWhatsAppConv = conversation.channel === 'whatsapp' || conversation.zaloAccount?.channel === 'whatsapp';
    const instance = !isWhatsAppConv ? zaloPool.getInstance(conversation.zaloAccountId) : null;
    if (instance?.api && message.zaloMsgId) {
      const threadId = conversation.externalThreadId || '';
      const threadType = conversation.threadType === 'group' ? 1 : 0;
      try {
        await instance.api.deleteMessage(
          {
            data: {
              cliMsgId: message.zaloMsgId,
              msgId: message.zaloMsgId,
              uidFrom: message.senderUid || '',
            },
            threadId,
            type: threadType,
          },
          true
        );
        logger.info(`[chat-routes] Deleted message ${message.zaloMsgId} for me on Zalo`);
      } catch (zaloErr: any) {
        logger.warn(`[chat-routes] Delete for me on Zalo warning: ${zaloErr?.message || zaloErr}`);
      }
    }

    await prisma.message.delete({
      where: { id: messageId },
    });

    const io = (app as any).io as Server;
    io?.emit('chat:message-deleted', {
      accountId: conversation.zaloAccountId,
      conversationId: id,
      messageId,
    });

    return { success: true, messageId };
  });

  // ── Mark conversation as read ────────────────────────────────────────────
  app.post('/api/v1/conversations/:id/mark-read', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    await prisma.conversation.updateMany({
      where: { id, orgId: user.orgId },
      data: { unreadCount: 0 },
    });

    return { success: true };
  });

  // ── Mark conversation as unread ──────────────────────────────────────────
  app.post('/api/v1/conversations/:id/mark-unread', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    await prisma.conversation.updateMany({
      where: { id, orgId: user.orgId },
      data: { unreadCount: 1 },
    });

    return { success: true };
  });

  // ── Delete conversation ───────────────────────────────────────────────────
  app.delete('/api/v1/conversations/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const conv = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
    });
    if (!conv) {
      return reply.status(404).send({ error: 'Conversation not found' });
    }

    // Unlink orders if any
    await prisma.order.updateMany({
      where: { conversationId: id },
      data: { conversationId: null },
    });

    // Delete messages and conversation
    await prisma.message.deleteMany({
      where: { conversationId: id },
    });

    await prisma.conversation.delete({
      where: { id },
    });

    const io = (app as any).io as Server;
    io?.emit('conversation:deleted', { conversationId: id });

    return { success: true };
  });

  // ── Toggle AI auto-reply for conversation ─────────────────────────────────
  app.post('/api/v1/conversations/:id/toggle-ai', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const { aiMuted } = request.body as { aiMuted: boolean };

    await prisma.conversation.updateMany({
      where: { id, orgId: user.orgId },
      data: { aiMuted },
    });

    // Fetch conversation to broadcast change
    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
      select: { id: true, zaloAccountId: true, aiMuted: true }
    });

    if (conversation) {
      const io = (app as any).io as Server;
      io?.emit('conversation:ai-update', { 
        conversationId: conversation.id, 
        accountId: conversation.zaloAccountId,
        aiMuted: conversation.aiMuted 
      });
    }

    return { success: true, aiMuted };
  });



  // ── Summarize conversation history using Gemini API ───────────────────────
  app.post('/api/v1/conversations/:id/summarize', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const { days = 0 } = (request.body as { days?: number }) || {};

    let rawApiKey = '';
    const geminiSetting = await prisma.appSetting.findFirst({
      where: { orgId: user.orgId, settingKey: 'gemini_api_key' }
    });
    if (geminiSetting?.valuePlain) {
      rawApiKey = geminiSetting.valuePlain;
    } else {
      rawApiKey = process.env.GEMINI_API_KEY || '';
    }

    const apiKeys = rawApiKey
      .split(/[,;]+/)
      .map((k) => k.trim())
      .filter((k) => k && !k.includes('*'));

    if (apiKeys.length === 0) {
      return reply.status(400).send({
        error: 'Chưa cấu hình Google Gemini API Key. Vui lòng vào Cài đặt -> API & Webhook để điền API Key hoặc cấu hình GEMINI_API_KEY trong file .env'
      });
    }

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
      select: { id: true }
    });
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });

    try {
      const whereCondition: any = { conversationId: id };
      if (days > 0) {
        const thresholdDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        whereCondition.sentAt = { gte: thresholdDate };
      }

      const messages = await prisma.message.findMany({
        where: whereCondition,
        orderBy: { sentAt: 'asc' },
        select: { senderType: true, senderName: true, content: true, sentAt: true }
      });

      if (messages.length === 0) {
        return { summary: 'Chưa có tin nhắn nào trong khoảng thời gian đã chọn để tóm tắt.' };
      }

      const chatHistory = messages.map(m => {
        const sender = m.senderType === 'self' ? 'Nhân viên (CRM)' : 'Khách hàng (Zalo)';
        let text = m.content || '';
        if (text.startsWith('{')) {
          try {
            const p = JSON.parse(text);
            text = p.title || p.href || text;
          } catch {}
        }
        return `[${m.sentAt.toLocaleTimeString('vi-VN')}] ${sender}: ${text}`;
      }).join('\n');

      const timeRangeText = days > 0 ? `${days} ngày qua` : 'toàn bộ lịch sử';
      const prompt = `Bạn là một chuyên gia CRM AI phân tích cuộc trò chuyện Zalo giữa Nhân viên và Khách hàng trong ${timeRangeText}.
Dữ liệu cuộc hội thoại:
${chatHistory}

Hãy phân tích và trả về DUY NHẤT một chuỗi JSON hợp lệ với cấu trúc sau:
{
  "summary": "Tóm tắt 3-4 gạch đầu dòng ngắn gọn, súc tích bằng tiếng Việt về: nhu cầu chính của khách, thỏa thuận mua/bán/dịch vụ, và các lưu ý quan trọng.",
  "sentiment": "positive" hoặc "neutral" hoặc "hesitant" hoặc "urgent" hoặc "negative",
  "sentimentLabel": "Chuỗi tiếng Việt mô tả cảm xúc ngắn gọn (ví dụ: 'Tích cực / Hài lòng', 'Đang phân vân', 'Cần hỗ trợ gấp', 'Khiếu nại')",
  "suggestedStatus": "Một trong các mã trạng thái CRM: 'new' (Mới tiếp cận), 'contacted' (Đang tư vấn), 'processing' (Đang xử lý / Đơn), 'quoted' (Chờ báo giá / Cọc), 'converted' (Đã chốt đơn), 'lost' (Tạm ngưng), 'warning' (Cần lưu ý), 'completed' (Hoàn thành)",
  "suggestedStatusLabel": "Tên tiếng Việt tương ứng của mã trạng thái gợi ý",
  "appointment": {
    "detected": true hoặc false,
    "title": "Nội dung cuộc hẹn nếu khách hoặc nhân viên có nhắc tới ngày/giờ hẹn cụ thể (hoặc chuỗi rỗng)",
    "suggestedTime": "Thời gian hẹn được nhắc tới (ví dụ: 'Chiều mai 15:00', 'Thứ 7 ngày 25/10') hoặc chuỗi rỗng",
    "notes": "Ghi chú thêm về cuộc hẹn nếu có"
  }
}
Lưu ý quan trọng: Chỉ trả về JSON thuần tuý, không thêm lời chào hay giải thích nào bên ngoài.`;

      let response;
      let lastError: Error | null = null;

      const aiModels = ['gemini-3.1-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.5-flash-lite', 'gemini-3.8-flash'];
      for (let i = 0; i < apiKeys.length; i++) {
        const currentKey = apiKeys[i];
        for (const m of aiModels) {
          try {
            response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${currentKey}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 2000 } })
            });

            if (response.ok) {
              lastError = null;
              break;
            } else {
              const err = await response.json().catch(() => ({}));
              lastError = new Error(err.error?.message || `API error code ${response.status}`);
            }
          } catch (err: any) {
            lastError = err;
          }
        }
        if (response && response.ok) break;
      }

      if (lastError || !response || !response.ok) {
        throw lastError || new Error('Không có phản hồi từ Gemini API');
      }

      const resJson: any = await response.json();
      let rawText = resJson.candidates?.[0]?.content?.parts?.[0]?.text || '';
      rawText = rawText.trim();

      let result: any = null;
      try {
        let cleanJson = rawText;
        if (cleanJson.startsWith('```json')) {
          cleanJson = cleanJson.replace(/^```json\s*/, '').replace(/\s*```$/, '');
        } else if (cleanJson.startsWith('```')) {
          cleanJson = cleanJson.replace(/^```\s*/, '').replace(/\s*```$/, '');
        }
        result = JSON.parse(cleanJson);
      } catch {
        result = {
          summary: rawText || 'Không thể tạo tóm tắt cuộc hội thoại.',
          sentiment: 'neutral',
          sentimentLabel: 'Bình thường',
          suggestedStatus: null,
          suggestedStatusLabel: null,
          appointment: { detected: false }
        };
      }

      if (!result.summary) {
        result.summary = rawText || 'Không có tóm tắt.';
      }

      return result;
    } catch (err: any) {
      logger.error('[chat] Summarize error:', err);
      return reply.status(500).send({ error: `Lỗi kết nối Gemini API: ${err.message}` });
    }
  });

  // ── Chat AI: Soạn phản hồi đa ngữ theo phong cách & ngữ cảnh (Draft) ─────────
  const handleChatAiDraft = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const {
      chat = '',
      chat_context = '',
      selected_text = '',
      notes_vi = '',
      tone = 'professional',
      target_language = 'en',
      redact_pii = false,
      model = 'gemini-3.1-flash-lite',
      custom_api_key = ''
    } = (request.body as any) || {};

    if (!notes_vi || !String(notes_vi).trim()) {
      return reply.status(400).send({ error: 'Vui lòng nhập ý chính bạn muốn trả lời bằng tiếng Việt.' });
    }

    const normalizedTone = normalizeTone(tone);
    const normalizedLang = normalizeTargetLanguage(target_language);

    // 1. Resolve Gemini API keys
    let rawApiKey = custom_api_key && typeof custom_api_key === 'string' && custom_api_key.trim() ? custom_api_key.trim() : '';
    if (!rawApiKey) {
      const geminiSetting = await prisma.appSetting.findFirst({
        where: { orgId: user.orgId, settingKey: 'gemini_api_key' }
      });
      rawApiKey = geminiSetting?.valuePlain || process.env.GEMINI_API_KEY || '';
    }

    const apiKeys = rawApiKey
      .split(/[,;]+/)
      .map((k) => k.trim())
      .filter((k) => k && !k.includes('*'));

    // 2. Resolve conversation metadata & excerpt cleanly (never lose contact/channel context)
    let conversationChat = String(chat || chat_context || '').trim();
    let contactName: string | null = null;
    let channelName: string | null = null;

    if (id && id !== 'general') {
      const conv = await prisma.conversation.findFirst({
        where: { id, orgId: user.orgId },
        select: {
          id: true,
          channel: true,
          threadType: true,
          contact: { select: { fullName: true, phone: true } },
          zaloAccount: { select: { channel: true, displayName: true } }
        }
      });
      if (conv) {
        contactName = conv.contact?.fullName || null;
        channelName = conv.zaloAccount?.channel || conv.channel || 'zalo';
        if (!conversationChat) {
          const recentMessages = await prisma.message.findMany({
            where: { conversationId: conv.id, isDeleted: false },
            orderBy: { sentAt: 'desc' },
            take: 15,
            select: { senderType: true, senderName: true, content: true, contentType: true, sentAt: true }
          });
          if (recentMessages.length > 0) {
            recentMessages.reverse();
            conversationChat = extractChatContextFromMessages(recentMessages, {
              contactName,
              channel: channelName,
              threadType: conv.threadType,
              maxMessages: 15
            });
          }
        }
      }
    }

    // 3. PII masking if enabled
    const maskText = (text: string) => {
      if (!text || !redact_pii) return text;
      return text
        .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]')
        .replace(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g, '[PHONE]');
    };

    const finalChat = maskText(conversationChat);
    const finalSelected = maskText(String(selected_text || '').trim());
    const finalNotes = maskText(String(notes_vi).trim());

    // 4. Build context-aware, strongly tone-differentiated prompts
    const { systemPrompt, userPrompt, effectiveLanguage, temperature } = buildChatAiDraftPrompts({
      finalChat,
      finalSelected,
      finalNotes,
      tone: normalizedTone,
      targetLanguage: normalizedLang,
      contactName,
      channel: channelName,
    });

    // 5. Call Gemini API with fast and reliable model fallback chain
    const targetModel = model || 'gemini-3.1-flash-lite';
    const modelsToTry = Array.from(new Set([
      targetModel,
      'gemini-3.1-flash-lite',
      'gemini-flash-lite-latest',
      'gemini-2.5-flash-lite',
      'gemini-2.5-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.8-flash'
    ]));

    let rawOutput = '';
    let apiSuccess = false;

    if (apiKeys.length > 0) {
      for (const k of apiKeys) {
        if (apiSuccess) break;
        for (const m of modelsToTry) {
          try {
            const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${k}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              signal: AbortSignal.timeout(15000),
              body: JSON.stringify({
                systemInstruction: { parts: [{ text: systemPrompt }] },
                contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
                generationConfig: {
                  temperature,
                  maxOutputTokens: 2500,
                  responseMimeType: 'application/json',
                  thinkingConfig: { thinkingBudget: 0 }
                }
              })
            });

            if (resp.ok) {
              const data: any = await resp.json();
              const text = data.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join('') || '';
              if (text.trim()) {
                rawOutput = text.trim();
                apiSuccess = true;
                break;
              }
            } else {
              const errBody = await resp.text().catch(() => '');
              console.warn(`[chat-routes] Gemini model ${m} returned ${resp.status}: ${errBody.slice(0, 150)}`);
            }
          } catch (e: any) {
            console.warn(`[chat-routes] Gemini model ${m} error: ${e?.message || e}`);
          }
        }
      }
    }

    // 6. Parse JSON or fall back to genuinely tone/language-differentiated template
    let parsedResult: any = apiSuccess && rawOutput ? extractJsonObject(rawOutput) : null;
    if (!parsedResult || !parsedResult.draft) {
      parsedResult = buildFallbackDraft({
        tone: normalizedTone,
        targetLanguage: effectiveLanguage,
        finalNotes,
        finalChat,
        contactName,
        apiSuccess: false
      });
    }

    const replyLanguage = parsedResult.reply_language || effectiveLanguage;
    const backTrans = replyLanguage === 'vi' ? '' : (parsedResult.back_translation_vi || '');

    return {
      ok: true,
      data: {
        customer_summary_vi: parsedResult.customer_summary_vi || '',
        reply_language: replyLanguage,
        tone: normalizedTone,
        draft: String(parsedResult.draft || '').trim(),
        back_translation_vi: backTrans,
        warnings_vi: Array.isArray(parsedResult.warnings_vi) ? parsedResult.warnings_vi : [],
        mock: Boolean(parsedResult.mock)
      }
    };
  };

  app.post('/api/v1/conversations/:id/chaten/draft', handleChatAiDraft);
  app.post('/api/v1/conversations/:id/chat-ai/draft', handleChatAiDraft);

  // ── Chat AI: Gợi ý kịch bản phản hồi theo ngữ cảnh & phong cách (Suggest) ─────
  const handleChatAiSuggest = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const {
      chat = '',
      chat_context = '',
      tone = 'professional',
      target_language = 'en',
      model = 'gemini-3.1-flash-lite',
      custom_api_key = ''
    } = (request.body as any) || {};

    const normalizedTone = normalizeTone(tone);
    const normalizedLang = normalizeTargetLanguage(target_language);

    let rawApiKey = custom_api_key && typeof custom_api_key === 'string' && custom_api_key.trim() ? custom_api_key.trim() : '';
    if (!rawApiKey) {
      const geminiSetting = await prisma.appSetting.findFirst({
        where: { orgId: user.orgId, settingKey: 'gemini_api_key' }
      });
      rawApiKey = geminiSetting?.valuePlain || process.env.GEMINI_API_KEY || '';
    }

    const apiKeys = rawApiKey
      .split(/[,;]+/)
      .map((k) => k.trim())
      .filter((k) => k && !k.includes('*'));

    let conversationChat = String(chat || chat_context || '').trim();
    let contactName: string | null = null;
    let channelName: string | null = null;

    if (id && id !== 'general') {
      const conv = await prisma.conversation.findFirst({
        where: { id, orgId: user.orgId },
        select: {
          id: true,
          channel: true,
          threadType: true,
          contact: { select: { fullName: true } },
          zaloAccount: { select: { channel: true } }
        }
      });
      if (conv) {
        contactName = conv.contact?.fullName || null;
        channelName = conv.zaloAccount?.channel || conv.channel || 'zalo';
        if (!conversationChat) {
          const recentMessages = await prisma.message.findMany({
            where: { conversationId: conv.id, isDeleted: false },
            orderBy: { sentAt: 'desc' },
            take: 15,
            select: { senderType: true, senderName: true, content: true, contentType: true, sentAt: true }
          });
          if (recentMessages.length > 0) {
            recentMessages.reverse();
            conversationChat = extractChatContextFromMessages(recentMessages, {
              contactName,
              channel: channelName,
              threadType: conv.threadType,
              maxMessages: 15
            });
          }
        }
      }
    }

    const { systemPrompt, userPrompt, effectiveLanguage, temperature } = buildChatAiSuggestPrompts({
      conversationChat,
      tone: normalizedTone,
      targetLanguage: normalizedLang,
      contactName,
      channel: channelName
    });

    const targetModel = model || 'gemini-3.1-flash-lite';
    const modelsToTry = Array.from(new Set([
      targetModel,
      'gemini-3.1-flash-lite',
      'gemini-flash-lite-latest',
      'gemini-2.5-flash-lite',
      'gemini-2.5-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.8-flash'
    ]));

    let rawOutput = '';
    let apiSuccess = false;

    if (apiKeys.length > 0) {
      for (const k of apiKeys) {
        if (apiSuccess) break;
        for (const m of modelsToTry) {
          try {
            const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${k}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              signal: AbortSignal.timeout(15000),
              body: JSON.stringify({
                systemInstruction: { parts: [{ text: systemPrompt }] },
                contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
                generationConfig: {
                  temperature,
                  maxOutputTokens: 2500,
                  responseMimeType: 'application/json',
                  thinkingConfig: { thinkingBudget: 0 }
                }
              })
            });

            if (resp.ok) {
              const data: any = await resp.json();
              const text = data.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join('') || '';
              if (text.trim()) {
                rawOutput = text.trim();
                apiSuccess = true;
                break;
              }
            } else {
              const errBody = await resp.text().catch(() => '');
              console.warn(`[chat-routes] Gemini model ${m} returned ${resp.status}: ${errBody.slice(0, 150)}`);
            }
          } catch (e: any) {
            console.warn(`[chat-routes] Gemini model ${m} error: ${e?.message || e}`);
          }
        }
      }
    }

    let parsedResult: any = apiSuccess && rawOutput ? extractJsonObject(rawOutput) : null;
    if (!parsedResult || !Array.isArray(parsedResult.suggestions) || parsedResult.suggestions.length === 0) {
      const fallback = buildFallbackSuggestions({
        tone: normalizedTone,
        targetLanguage: effectiveLanguage,
        conversationChat,
        contactName
      });
      parsedResult = {
        ...fallback,
        reply_language: effectiveLanguage,
        tone: normalizedTone,
      };
    } else {
      const stageVal = parsedResult.stage || parsedResult.context_stage || '';
      parsedResult = {
        stage: stageVal,
        context_stage: stageVal,
        reply_language: effectiveLanguage,
        tone: normalizedTone,
        suggestions: parsedResult.suggestions.map((s: any, idx: number) => ({
          id: s.id || `s${idx + 1}`,
          strategy_type: s.strategy_type || 'clarification',
          title: s.title || `Kịch bản ${idx + 1}`,
          intent_vi: s.intent_vi || '',
          draft: String(s.draft || '').trim(),
          back_translation_vi: effectiveLanguage === 'vi' ? '' : (s.back_translation_vi || '')
        }))
      };
    }

    return {
      ok: true,
      data: parsedResult
    };
  };

  app.post('/api/v1/conversations/:id/chaten/suggest', handleChatAiSuggest);
  app.post('/api/v1/conversations/:id/chat-ai/suggest', handleChatAiSuggest);

  // ── Get uncompleted customer conversations ("Việc cần xử lý") ───────────────
  app.get('/api/v1/conversations/uncompleted', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const where: any = {
      orgId: user.orgId,
      quoteCompleted: false,
      OR: [
        { threadType: 'user' },
        { isCustomer: true }
      ],
      AND: [
        {
          OR: [
            {
              isReplied: false,
              lastMessageAt: { lte: fiveMinutesAgo }
            },
            {
              isReplied: true,
              lastMessageAt: { lte: twentyFourHoursAgo }
            }
          ]
        },
        {
          OR: [
            { contact: null },
            {
              contact: {
                OR: [
                  {
                    AND: [
                      {
                        OR: [
                          { notes: null },
                          { NOT: { notes: { contains: '[Chuyển cho Kế toán]' } } }
                        ]
                      },
                      {
                        metadata: {
                          path: ['customerCode'],
                          equals: Prisma.DbNull
                        }
                      }
                    ]
                  },
                  {
                    metadata: {
                      path: ['accountantStatus'],
                      equals: 'completed'
                    }
                  }
                ]
              }
            }
          ]
        }
      ]
    };

    // Members can only see conversations from Zalo accounts they have access to
    if (user.role === 'member') {
      const accessibleAccounts = await prisma.zaloAccountAccess.findMany({
        where: { userId: user.id },
        select: { zaloAccountId: true },
      });
      where.zaloAccountId = { in: accessibleAccounts.map((a) => a.zaloAccountId) };
    }

    // Build the trackedWhere condition for counting tracked orders with alarms
    const trackedWhere: any = {
      orgId: user.orgId,
      OR: [
        { threadType: 'user' },
        { isCustomer: true }
      ],
      AND: [
        {
          OR: [
            {
              isReplied: false,
              lastMessageAt: { lte: fiveMinutesAgo }
            },
            {
              isReplied: true,
              lastMessageAt: { lte: twentyFourHoursAgo }
            }
          ]
        }
      ]
    };
    if (where.zaloAccountId) {
      trackedWhere.zaloAccountId = where.zaloAccountId;
    }

    trackedWhere.contact = {
      OR: [
        { notes: { contains: '[Chuyển cho Kế toán]' } },
        {
          metadata: {
            path: ['customerCode'],
            not: null
          }
        }
      ],
      NOT: {
        metadata: {
          path: ['accountantStatus'],
          equals: 'completed'
        }
      }
    };

    const [conversations, trackedCount] = await Promise.all([
      prisma.conversation.findMany({
        where,
        include: {
          contact: { select: { id: true, fullName: true, phone: true, avatarUrl: true, zaloUid: true, status: true, notes: true, metadata: true } },
          zaloAccount: { select: { id: true, displayName: true, zaloUid: true } },
          messages: {
            take: 1,
            orderBy: { sentAt: 'desc' },
            select: { content: true, contentType: true, senderType: true, sentAt: true },
          },
        },
        orderBy: { lastMessageAt: 'asc' }, // Oldest first to prioritize urgent uncompleted tasks!
      }),
      prisma.conversation.count({ where: trackedWhere })
    ]);

    return { conversations, trackedCount };
  });

  // ── Update conversation quote tracking settings ───────────────────────────
  app.patch('/api/v1/conversations/:id/quote-settings', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const { isCustomer, quoteCompleted } = request.body as { isCustomer?: boolean; quoteCompleted?: boolean };

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
    });
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });

    const updateData: any = {};
    if (isCustomer !== undefined) {
      updateData.isCustomer = isCustomer;
      if (isCustomer && conversation.quoteCompleted) {
        // If enabling quote tracking and it was completed, reset to false
        updateData.quoteCompleted = false;
        updateData.quoteCompletedByName = null;
      } else if (!isCustomer) {
        // If disabling tracking, set to true so it doesn't alarm
        updateData.quoteCompleted = true;
        updateData.quoteCompletedByName = null;
      }
    }
    if (quoteCompleted !== undefined) {
      updateData.quoteCompleted = quoteCompleted;
      if (quoteCompleted) {
        const dbUser = await prisma.user.findUnique({
          where: { id: user.id },
          select: { fullName: true }
        });
        updateData.quoteCompletedByName = dbUser?.fullName || 'Nhân viên';
      } else {
        updateData.quoteCompletedByName = null;
      }
    }

    const updated = await prisma.conversation.update({
      where: { id },
      data: updateData,
    });

    // Broadcast update via Socket.IO
    const io = (app as any).io as Server;
    io?.emit('conversation:quote-update', {
      conversationId: id,
      isCustomer: updated.isCustomer,
      quoteCompleted: updated.quoteCompleted,
      quoteCompletedByName: updated.quoteCompletedByName,
    });

    return updated;
  });

  // ── Mute / Unmute conversation notifications ─────────────────────────────
  app.patch('/api/v1/conversations/:id/mute', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const { isMuted } = request.body as { isMuted: boolean };

    if (isMuted === undefined) {
      return reply.status(400).send({ error: 'isMuted field is required' });
    }

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
    });
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });

    const updated = await prisma.conversation.update({
      where: { id },
      data: { isMuted: Boolean(isMuted) },
    });

    // Broadcast update via Socket.IO
    const io = (app as any).io as Server;
    io?.emit('conversation:mute-update', {
      conversationId: id,
      isMuted: updated.isMuted,
    });

    return {
      success: true,
      conversationId: id,
      isMuted: updated.isMuted,
    };
  });
}

export {
  extractConversationAssets,
  type ExtractedMedia,
  type ExtractedFile,
  type ExtractedLink,
};
