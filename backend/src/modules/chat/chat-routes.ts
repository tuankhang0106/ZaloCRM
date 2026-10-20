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
import { zaloRateLimiter } from '../zalo/zalo-rate-limiter.js';
import { logger } from '../../shared/utils/logger.js';
import { randomUUID } from 'node:crypto';
import type { Server } from 'socket.io';

type QueryParams = Record<string, string>;

export async function chatRoutes(app: FastifyInstance) {
  // ── Proxy file downloads from Zalo file servers ───────────────────────────
  // Registered BEFORE authMiddleware hook to allow direct browser GET requests (via window.open)
  // We secure it manually by verifying the token from the query string
  app.get('/api/v1/files/download', async (request: FastifyRequest, reply: FastifyReply) => {
    const { url, accountId, token } = request.query as { url?: string; accountId?: string; token?: string };

    if (!url || !accountId || !token) {
      return reply.status(400).send({ error: 'URL, accountId, and token required' });
    }

    // Verify JWT token manually since we bypassed the global hook
    try {
      await app.jwt.verify(token);
    } catch (err: any) {
      logger.error('[chat] JWT verification error:', err?.message || err);
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const instance = zaloPool.getInstance(accountId);
    if (!instance?.api) {
      return reply.status(400).send({ error: 'Zalo account not connected' });
    }

    try {
      const context = instance.api.getContext();
      const cookieString = await context.cookie.getCookieString(url);

      const response = await fetch(url, {
        headers: {
          'Cookie': cookieString,
          'User-Agent': context.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': '*/*',
          'Accept-Encoding': 'gzip, deflate, br',
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch file from Zalo, status: ${response.status}`);
      }

      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      const contentDisposition = response.headers.get('content-disposition') || '';

      reply.header('Content-Type', contentType);
      if (contentDisposition) {
        reply.header('Content-Disposition', contentDisposition);
      }

      const buffer = await response.arrayBuffer();
      return Buffer.from(buffer);
    } catch (err: any) {
      logger.error('[chat] File download proxy error:', err);
      return reply.status(500).send({ error: `Không thể tải file: ${err.message}` });
    }
  });

  app.addHook('preHandler', authMiddleware);

  // ── List conversations (paginated) ──────────────────────────────────────
  app.get('/api/v1/conversations', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { page = '1', limit = '50', search = '', accountId = '', uncompletedOnly = '', unreadOnly = '', category = '', threadType = '', status = '' } = request.query as QueryParams;

    const where: any = { orgId: user.orgId };
    if (accountId) where.zaloAccountId = accountId;
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
    const accountantKeywords = [
      'kế toán',
      'ketoan',
      user.email.toLowerCase(),
      user.id
    ];

    if (search) {
      contactConditions.push({
        OR: [
          { fullName: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } },
        ],
      });
    }

    if (user.role === 'accountant') {
      contactConditions.push({
        notes: { contains: '[Chuyển cho Kế toán]' }
      });
      contactConditions.push({
        OR: accountantKeywords.map(keyword => ({
          notes: { contains: keyword, mode: 'insensitive' as const }
        }))
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
          contact: { select: { id: true, fullName: true, phone: true, avatarUrl: true, zaloUid: true, status: true, notes: true, tags: true, metadata: true } },
          zaloAccount: { select: { id: true, displayName: true, zaloUid: true, status: true } },
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

    return { conversations, total, page: parseInt(page), limit: parseInt(limit) };
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

    // Apply accountant check
    if (user.role === 'accountant') {
      const notesStr = (conversation.contact?.notes || '').toLowerCase();
      const hasTransfer = notesStr.includes('[chuyển cho kế toán]');
      const accountantKeywords = [
        'kế toán',
        'ketoan',
        user.email.toLowerCase(),
        user.id
      ];
      const hasAccess = hasTransfer && accountantKeywords.some(keyword => 
        notesStr.includes(keyword)
      );
      if (!hasAccess) {
        return reply.status(403).send({ error: 'Không có quyền truy cập cuộc hội thoại này' });
      }
    }

    return conversation;
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

    // Apply accountant check
    if (user.role === 'accountant') {
      const notesStr = (conversation.contact?.notes || '').toLowerCase();
      const hasTransfer = notesStr.includes('[chuyển cho kế toán]');
      const accountantKeywords = [
        'kế toán',
        'ketoan',
        user.email.toLowerCase(),
        user.id
      ];
      const hasAccess = hasTransfer && accountantKeywords.some(keyword => 
        notesStr.includes(keyword)
      );
      if (!hasAccess) {
        return reply.status(403).send({ error: 'Không có quyền xem tin nhắn của cuộc hội thoại này' });
      }
    }

    const [messages, total] = await Promise.all([
      prisma.message.findMany({
        where: { conversationId: id },
        include: { repliedBy: { select: { id: true, fullName: true, role: true } } },
        orderBy: { sentAt: 'desc' },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
      }),
      prisma.message.count({ where: { conversationId: id } }),
    ]);

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

    // Apply accountant check
    if (user.role === 'accountant') {
      const notesStr = (conversation.contact?.notes || '').toLowerCase();
      const hasTransfer = notesStr.includes('[chuyển cho kế toán]');
      const accountantKeywords = [
        'kế toán',
        'ketoan',
        user.email.toLowerCase(),
        user.id
      ];
      const hasAccess = hasTransfer && accountantKeywords.some(keyword => 
        notesStr.includes(keyword)
      );
      if (!hasAccess) {
        return reply.status(403).send({ error: 'Không có quyền xem tệp của cuộc hội thoại này' });
      }
    }

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

    if (request.isMultipart()) {
      const part = await request.file();
      if (!part) return reply.status(400).send({ error: 'File required' });

      fileBuffer = await part.toBuffer();
      fileName = part.filename;
      fileExt = fileName.split('.').pop()?.toLowerCase() || '';
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

    // Apply accountant check for chat capability
    if (user.role === 'accountant') {
      const notesStr = (conversation.contact?.notes || '').toLowerCase();
      const hasTransfer = notesStr.includes('[chuyển cho kế toán]');
      const accountantKeywords = [
        'kế toán',
        'ketoan',
        user.email.toLowerCase(),
        user.id
      ];
      const hasGeneralAccess = hasTransfer && accountantKeywords.some(keyword => 
        notesStr.includes(keyword)
      );
      if (!hasGeneralAccess || !notesStr.includes('[kế toán được chat]')) {
        return reply.status(403).send({ error: 'Bạn không có quyền chat với khách hàng này. Vui lòng liên hệ Admin/Sale để cấp quyền.' });
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

      // Process quote if replying to a message
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

      let res;
      if (isFile && fileBuffer) {
        const isImage = ['jpg', 'jpeg', 'png', 'webp'].includes(fileExt);
        const attachmentSource: any = {
          data: fileBuffer,
          filename: fileName,
          metadata: {
            totalSize: fileBuffer.length,
          },
        };
        if (isImage) {
          attachmentSource.metadata.width = 800;
          attachmentSource.metadata.height = 600;
        }

        res = await instance.api.sendMessage(
          { msg: content, attachments: [attachmentSource] },
          threadId,
          threadType
        );

        if (res?.attachment && res.attachment.length > 0) {
          const att = res.attachment[0];
          messageAttachments = [att];
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
            const thumbUrl = att.thumbUrl || att.data?.thumbUrl || remoteUrl;
            const hdUrl = att.hdUrl || att.data?.hdUrl || remoteUrl;

            // Fallback to data URL so optimistic preview displays the image, never empty {"href":"","thumb":"","hdUrl":""}
            const fallbackDataUrl = `data:image/${fileExt === 'png' ? 'png' : 'jpeg'};base64,${fileBuffer.toString('base64')}`;
            const activeUrl = remoteUrl || fallbackDataUrl;

            finalContent = JSON.stringify({
              href: activeUrl,
              thumb: thumbUrl || activeUrl,
              hdUrl: hdUrl || activeUrl,
              ...(content?.trim() ? { title: content.trim(), caption: content.trim() } : {}),
            });
          } else {
            finalContentType = 'file';
            finalContent = JSON.stringify({
              title: att.fileName || att.data?.fileName || fileName,
              href: att.fileUrl || att.data?.fileUrl || '',
              params: JSON.stringify({
                fileSize: String(att.totalSize || att.data?.totalSize || fileBuffer.length),
                fileExt: fileExt,
              }),
            });
          }
        } else {
          finalContentType = isImage ? 'image' : 'file';
          if (isImage) {
            const fallbackDataUrl = `data:image/${fileExt === 'png' ? 'png' : 'jpeg'};base64,${fileBuffer.toString('base64')}`;
            finalContent = JSON.stringify({
              href: fallbackDataUrl,
              thumb: fallbackDataUrl,
              hdUrl: fallbackDataUrl,
              ...(content?.trim() ? { title: content.trim(), caption: content.trim() } : {}),
            });
          } else {
            finalContent = `[Gửi file: ${fileName}]`;
          }
        }
      } else {
        if (zaloQuote) {
          try {
            res = await instance.api.sendMessage(
              { msg: content ? content.trim() : '', quote: zaloQuote },
              threadId,
              threadType
            );
          } catch (quoteErr: any) {
            logger.warn('[chat] Send with quote failed, falling back to normal send:', quoteErr?.message || quoteErr);
            res = await instance.api.sendMessage({ msg: content ? content.trim() : '' }, threadId, threadType);
          }
        } else {
          res = await instance.api.sendMessage({ msg: content ? content.trim() : '' }, threadId, threadType);
        }
      }

      if (quoteAttachment) {
        messageAttachments.push(quoteAttachment);
      }

      const zaloMsgId =
        res?.messageId ||
        res?.msgId ||
        res?.id ||
        res?.attachment?.[0]?.msgId ||
        res?.attachment?.[0]?.messageId ||
        res?.attachment?.[0]?.data?.msgId ||
        res?.attachment?.[0]?.data?.messageId ||
        null;

      let message;
      const sixtySecondsAgo = new Date(Date.now() - 60 * 1000);
      const alreadyCreated = await prisma.message.findFirst({
        where: {
          conversationId: id,
          senderType: 'self',
          OR: [
            ...(zaloMsgId ? [{ zaloMsgId }] : []),
            ...(isFile ? [{ contentType: finalContentType, sentAt: { gte: sixtySecondsAgo } }] : []),
            { content: finalContent, sentAt: { gte: sixtySecondsAgo } }
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

    for (const targetId of targetConversationIds) {
      try {
        const targetConv = await prisma.conversation.findFirst({
          where: { id: targetId, orgId: user.orgId },
          include: { zaloAccount: true, contact: { select: { notes: true } } },
        });

        if (!targetConv) continue;

        // Apply accountant check for target conversation
        if (user.role === 'accountant') {
          const notesStr = (targetConv.contact?.notes || '').toLowerCase();
          const hasTransfer = notesStr.includes('[chuyển cho kế toán]');
          const accountantKeywords = ['kế toán', 'ketoan', user.email.toLowerCase(), user.id];
          const hasGeneralAccess = hasTransfer && accountantKeywords.some(keyword => notesStr.includes(keyword));
          if (!hasGeneralAccess || !notesStr.includes('[kế toán được chat]')) {
            continue;
          }
        }

        const instance = zaloPool.getInstance(targetConv.zaloAccountId);
        if (!instance?.api) continue;

        const targetThreadId = targetConv.externalThreadId || '';
        const targetThreadType = targetConv.threadType === 'group' ? 1 : 0;

        const isImage = sourceMessage.contentType === 'image';
        const forwardAttachment = {
          type: 'forwarded',
          originalSender: sourceMessage.senderName || 'Người dùng',
          sourceConversationId: sourceMessage.conversationId,
          sourceMessageId: sourceMessage.id,
        };

        if (isImage) {
          let imageUrl = '';
          if (sourceMessage.content?.startsWith('http')) {
            imageUrl = sourceMessage.content;
          } else if (sourceMessage.content?.startsWith('{')) {
            try {
              const p = JSON.parse(sourceMessage.content);
              imageUrl = p.hdUrl || p.normalUrl || p.href || p.thumb || p.fileUrl || '';
            } catch {}
          }

          let imgBuffer: Buffer | null = null;
          if (imageUrl) {
            try {
              const sourceInstance = zaloPool.getInstance(sourceMessage.conversation.zaloAccountId);
              const headers: Record<string, string> = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              };
              if (sourceInstance?.api) {
                try {
                  const ctx = sourceInstance.api.getContext();
                  const cookie = await ctx.cookie.getCookieString(imageUrl);
                  if (cookie) headers['Cookie'] = cookie;
                } catch {}
              }
              const imgRes = await fetch(imageUrl, { headers });
              if (imgRes.ok) {
                imgBuffer = Buffer.from(await imgRes.arrayBuffer());
              }
            } catch (dlErr) {
              logger.error('[chat-forward] Error downloading image:', dlErr);
            }
          }

          if (imgBuffer) {
            const attachmentSource: any = {
              data: imgBuffer,
              filename: 'forwarded_image.jpg',
              metadata: {
                totalSize: imgBuffer.length,
                width: 800,
                height: 600,
              },
            };

            const sendRes = await instance.api.sendMessage(
              { msg: extraText ? extraText.trim() : '', attachments: [attachmentSource] },
              targetThreadId,
              targetThreadType
            );

            const attList: any[] = [forwardAttachment];
            let finalContent = sourceMessage.content || '';
            if (sendRes?.attachment && sendRes.attachment.length > 0) {
              const att = sendRes.attachment[0];
              attList.unshift(att);
              finalContent = JSON.stringify({
                href: att.normalUrl || att.fileUrl || imageUrl,
                thumb: att.thumbUrl || att.fileUrl || imageUrl,
                hdUrl: att.hdUrl || att.fileUrl || imageUrl,
                ...(extraText?.trim() ? { title: extraText.trim(), caption: extraText.trim() } : {}),
              });
            }

            const zaloMsgId = sendRes?.messageId || sendRes?.msgId || sendRes?.id || null;
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

            io?.emit('chat:message', { accountId: targetConv.zaloAccountId, message: newMsg, conversationId: targetId });
            results.push(newMsg);
          } else {
            const textContent = `${imageUrl || '[Hình ảnh]'}${extraText ? `\n${extraText}` : ''}`;
            const sendRes = await instance.api.sendMessage({ msg: textContent }, targetThreadId, targetThreadType);
            const zaloMsgId = sendRes?.messageId || sendRes?.msgId || sendRes?.id || null;
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
                attachments: [forwardAttachment],
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

            io?.emit('chat:message', { accountId: targetConv.zaloAccountId, message: newMsg, conversationId: targetId });
            results.push(newMsg);
          }
        } else {
          // Forwarding text message
          const textToForward = sourceMessage.content || '';
          const sendRes = await instance.api.sendMessage({ msg: textToForward }, targetThreadId, targetThreadType);
          const zaloMsgId = sendRes?.messageId || sendRes?.msgId || sendRes?.id || null;

          const newMsg = await prisma.message.create({
            data: {
              id: randomUUID(),
              conversationId: targetId,
              zaloMsgId,
              senderType: 'self',
              senderUid: targetConv.zaloAccount.zaloUid || '',
              senderName: 'Staff',
              content: textToForward,
              contentType: sourceMessage.contentType || 'text',
              attachments: [forwardAttachment],
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

          io?.emit('chat:message', { accountId: targetConv.zaloAccountId, message: newMsg, conversationId: targetId });
          results.push(newMsg);

          if (extraText?.trim()) {
            const extraRes = await instance.api.sendMessage({ msg: extraText.trim() }, targetThreadId, targetThreadType);
            const extraZaloMsgId = extraRes?.messageId || extraRes?.msgId || extraRes?.id || null;
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
                attachments: [],
                sentAt: new Date(),
                repliedByUserId: user.id,
              },
              include: {
                repliedBy: { select: { id: true, fullName: true, role: true } },
              },
            });
            io?.emit('chat:message', { accountId: targetConv.zaloAccountId, message: extraMsg, conversationId: targetId });
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
  app.patch('/api/v1/conversations/:id/customer-note', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
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

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
      include: { zaloAccount: true },
    });
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });

    const message = await prisma.message.findFirst({
      where: { id: messageId, conversationId: id },
    });
    if (!message) return reply.status(404).send({ error: 'Message not found' });

    const instance = zaloPool.getInstance(conversation.zaloAccountId);
    let zaloSynced = false;
    let zaloWarning: string | undefined = undefined;

    if (instance?.api && message.zaloMsgId) {
      const threadId = conversation.externalThreadId || '';
      const threadType = conversation.threadType === 'group' ? 1 : 0;
      try {
        await instance.api.undo(
          { msgId: message.zaloMsgId, cliMsgId: message.zaloMsgId },
          threadId,
          threadType
        );
        zaloSynced = true;
        logger.info(`[chat-routes] Undone message ${message.zaloMsgId} on Zalo`);
      } catch (zaloErr: any) {
        zaloSynced = false;
        zaloWarning = zaloErr?.message || String(zaloErr);
        logger.warn(`[chat-routes] Undo on Zalo failed or message expired: ${zaloWarning}`);
      }
    } else {
      zaloWarning = 'Tài khoản Zalo chưa kết nối hoặc tin nhắn không có ID Zalo';
    }

    const updated = await prisma.message.update({
      where: { id: messageId },
      data: { isDeleted: true, deletedAt: new Date() },
      include: { repliedBy: { select: { id: true, fullName: true, role: true } } },
    });

    const io = (app as any).io as Server;
    io?.emit('chat:message-undo', {
      accountId: conversation.zaloAccountId,
      conversationId: id,
      messageId: message.id,
      zaloMsgId: message.zaloMsgId,
    });

    return { success: true, message: updated, zaloSynced, zaloWarning };
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

    const instance = zaloPool.getInstance(conversation.zaloAccountId);
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

      for (let i = 0; i < apiKeys.length; i++) {
        const currentKey = apiKeys[i];
        try {
          response = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${currentKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
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

    // Members and accountants can only see conversations from Zalo accounts they have access to
    if (user.role === 'member') {
      const accessibleAccounts = await prisma.zaloAccountAccess.findMany({
        where: { userId: user.id },
        select: { zaloAccountId: true },
      });
      where.zaloAccountId = { in: accessibleAccounts.map((a) => a.zaloAccountId) };
    } else if (user.role === 'accountant') {
      const accountantKeywords = [
        'kế toán',
        'ketoan',
        user.email.toLowerCase(),
        user.id
      ];
      where.contact = {
        notes: { contains: '[Chuyển cho Kế toán]' },
        OR: accountantKeywords.map(keyword => ({
          notes: { contains: keyword, mode: 'insensitive' as const }
        }))
      };
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

    if (user.role === 'accountant') {
      const accountantKeywords = [
        'kế toán',
        'ketoan',
        user.email.toLowerCase(),
        user.id
      ];
      trackedWhere.contact = {
        AND: [
          { notes: { contains: '[Chuyển cho Kế toán]' } },
          {
            NOT: {
              metadata: {
                path: ['accountantStatus'],
                equals: 'completed'
              }
            }
          },
          {
            OR: accountantKeywords.map(keyword => ({
              notes: { contains: keyword, mode: 'insensitive' as const }
            }))
          }
        ]
      };
    } else {
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
    }

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
    if (!msg.content && (!msg.attachments || !Array.isArray(msg.attachments) || msg.attachments.length === 0)) {
      continue;
    }

    const contentStr = msg.content || '';
    let parsedJson: any = null;
    if (contentStr.startsWith('{')) {
      try { parsedJson = JSON.parse(contentStr); } catch {}
    }

    // 1. Process as Image / Media
    if (msg.contentType === 'image' || msg.contentType === 'video') {
      let imgUrl = '';
      let thumbUrl = '';
      let caption: string | null = null;

      if (parsedJson) {
        imgUrl = parsedJson.hdUrl || parsedJson.href || parsedJson.thumb || '';
        thumbUrl = parsedJson.thumb || parsedJson.href || '';
        caption = parsedJson.title || parsedJson.caption || parsedJson.description || null;
      } else if (contentStr.startsWith('http') || contentStr.startsWith('data:')) {
        imgUrl = contentStr;
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
    if (parsedJson && !seenImageUrls.has(parsedJson.href || '')) {
      const href = parsedJson.href || parsedJson.thumb || parsedJson.hdUrl || '';
      const isVoiceOrAudio = msg.contentType === 'voice' || msg.contentType === 'call' || href.includes('voice') || href.includes('.aac') || href.includes('.mp3') || href.includes('.m4a') || parsedJson.action?.includes('voice') || parsedJson.params?.includes?.('waveformSamples');
      const isImg = !isVoiceOrAudio && (/\.(jpg|jpeg|png|webp|gif)/i.test(href) || (href.includes('zdn.vn') && !parsedJson.params?.includes('fileExt')));
      if (isImg && href) {
        seenImageUrls.add(href);
        images.push({
          id: msg.id,
          url: href,
          thumbUrl: parsedJson.thumb || href,
          caption: parsedJson.title || parsedJson.caption || null,
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
      const hasFileExt = params?.fileExt || /\.(pdf|xlsx?|docx?|pptx?|zip|rar|tar|gz|7z|txt|csv)$/i.test(parsedJson.title || parsedJson.href || '');
      if (isFile || params?.fType === 1 || hasFileExt) {
        const bytes = parseInt(params?.fileSize || '0');
        const sizeStr = bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : (bytes > 0 ? `${Math.round(bytes / 1024)} KB` : '');
        const ext = params?.fileExt || (parsedJson.title ? parsedJson.title.split('.').pop() : 'file');
        fileInfo = {
          name: parsedJson.title || `Tài liệu.${ext}`,
          size: sizeStr,
          href: parsedJson.href || '',
          extension: (ext || 'file').toLowerCase(),
        };
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

    // 4. Process as Link
    if (msg.contentType === 'link' || parsedJson?.href?.startsWith('http')) {
      const linkHref = parsedJson?.href || (contentStr.startsWith('http') ? contentStr : '');
      if (linkHref && !seenLinkUrls.has(linkHref)) {
        // Exclude image CDNs
        if (!linkHref.includes('/gr/jpg/') && !linkHref.includes('/no/jpg/') && !/\.(jpg|jpeg|png|webp|gif)$/i.test(linkHref)) {
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

    // 5. Extract raw URLs from text message content
    if (!parsedJson && contentStr) {
      const urlRegex = /(https?:\/\/[^\s<]+)/g;
      const matches = contentStr.match(urlRegex);
      if (matches) {
        for (const rawUrl of matches) {
          if (!seenLinkUrls.has(rawUrl) && !seenImageUrls.has(rawUrl) && !seenFileHrefs.has(rawUrl)) {
            seenLinkUrls.add(rawUrl);
            let domain = '';
            try { domain = new URL(rawUrl).hostname; } catch {}
            links.push({
              id: msg.id,
              url: rawUrl,
              title: rawUrl,
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
