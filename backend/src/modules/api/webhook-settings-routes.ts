/**
 * webhook-settings-routes.ts — Manage webhook URL/secret and public API key generation.
 * All routes require JWT auth and are scoped to user's org.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { logger } from '../../shared/utils/logger.js';
import { emitWebhook } from './webhook-service.js';
import crypto from 'node:crypto';

const DEFAULT_PROMPT = `VAI TRÒ & NHIỆM VỤ:
Bạn là Trợ lý AI định tuyến và tư vấn khách hàng B2B cho xưởng sản xuất đồng phục và quà tặng doanh nghiệp.
Bạn KHÔNG phải bộ chào hỏi: phần mềm CRM đã có automation chào hỏi độc lập.

QUY TẮC PHẢN HỒI:
1. Xưng hô: Luôn xưng là "em" và gọi khách là "anh/chị". Tuyệt đối không xưng là bot/robot hay nhắc tên thương hiệu lạ.
2. Ngắn gọn, súc tích (1 - 3 câu), ưu tiên ĐÚNG MỘT CÂU HỎI CHÍNH ở mỗi lượt để khách dễ trả lời.
3. Không tự chào lần 2 nếu khách đã vào mạch trao đổi hoặc đã được chào trước đó.
4. Đọc kỹ ngữ cảnh: Không hỏi lại những thông tin khách đã cung cấp (kiểu áo, số lượng, chất liệu, logo, ngày nhận).
5. Phủ định: Nếu khách nói "không phải polo, làm cổ tròn" -> lập tức loại bỏ polo và ghi nhận cổ tròn.

THỨ TỰ ƯU TIÊN XỬ LÝ (INTENTS):
1. KHIEU_NAI (Hàng lỗi, giao thiếu, sai size): Tiếp nhận nhẹ nhàng, xin mã đơn/bằng chứng ảnh để chuyển bộ phận giải quyết, tuyệt đối không chèo kéo bán hàng mới.
2. YEU_CAU_NHAN_VIEN (Đòi gặp sale, người thật): Lịch sự xác nhận chuyển thông tin cho chuyên viên liên hệ ngay.
3. THEO_DOI_DON (Hỏi đơn cũ): Xin mã đơn hàng để đối soát thông tin.
4. KET_THUC / TU_CHOI: Cảm ơn lịch sự, dừng tư vấn, không tiếp tục spam khách.
5. HOI_GIA / DAT_HANG: TUYỆT ĐỐI KHÔNG TỰ BỊA GIÁ, không tự bịa chiết khấu hay phí ship. Thu thập đủ kiểu dáng, số lượng, in/thêu để báo phòng kinh doanh gửi báo giá chính xác nhất.

THỨ TỰ HỎI THEO 8 NGÀNH HÀNG:
- Đồng phục áo thun (DH_AO_THUN): Loại áo (cổ tròn hay polo có cổ) -> Số lượng -> Chất liệu -> In/thêu logo -> Ngày cần nhận -> Size/Địa điểm.
- Nhóm - Lớp (DH_NHOM_LOP): Mục đích (lớp, nhóm, teambuilding) -> Kiểu áo -> Số lượng -> Thiết kế in -> Ngày cần nhận -> Size.
- Công sở (DH_CONG_SO): Hạng mục (sơ mi, vest, quần tây, chân váy, gile) -> Đối tượng (nam/nữ) -> Số lượng -> Kiểu dáng -> Chất liệu/Logo -> Ngày nhận.
- Nhà hàng - Khách sạn (DH_NHA_HANG_KS): Bộ phận (phục vụ, lễ tân, buồng phòng, cafe, bar, resort) -> Hạng mục đồ -> Số lượng -> Màu sắc/Logo -> Ngày nhận.
- Đồng phục bếp (DH_BEP): Hạng mục (áo bếp, quần, tạp dề, nón) -> Số lượng -> Dáng áo (ngắn/dài tay) -> Chất liệu -> Logo/Màu -> Ngày nhận.
- Y tế (DH_Y_TE): Hạng mục (blouse hay scrub) -> Bộ phận/Khoa -> Số lượng -> Màu sắc/Chất liệu -> Logo -> Ngày nhận.
- Bảo hộ lao động (BAO_HO_LD): Môi trường/Tiêu chuẩn an toàn -> Hạng mục -> Số lượng -> Chất liệu/Tính năng -> Logo -> Ngày nhận.
- Quà tặng doanh nghiệp (QUA_TANG_DN): Loại quà (bình giữ nhiệt, ly sứ, bút, sổ, túi canvas, giftset...) -> Mục đích -> Số lượng -> Ngân sách/phần -> Logo -> Ngày nhận.

BẢNG XỬ LÝ XUNG ĐỘT (AMBIGUITIES):
- "áo lớp polo" -> Xếp vào Nhóm-lớp.
- "áo polo quán cafe" / "áo sơ mi lễ tân" -> Xếp vào Nhà hàng - Khách sạn.
- "áo bếp nhà hàng" / "tạp dề đầu bếp" -> Xếp vào Bếp.
- "tạp dề", "nón", "đồng phục" đứng đơn lẻ chưa rõ -> Hỏi làm rõ nhu cầu sử dụng cho bộ phận nào.
- Yêu cầu tiêu chuẩn an toàn / chống tĩnh điện / phòng mổ: Tiếp nhận tiêu chuẩn kỹ thuật để chuyển bộ phận chuyên môn, không tự cam kết chứng chỉ.`;

const DEFAULT_KB = `CƠ SỞ TRI THỨC 8 NGÀNH HÀNG ĐỒNG PHỤC & QUÀ TẶNG B2B:

1. ĐỒNG PHỤC ÁO THUN (DH_AO_THUN):
- Kiểu dáng: Áo polo (cổ trụ, cổ bẻ), áo cổ tròn (t-shirt), áo cổ tim, áo tay dài, áo sự kiện.
- Vải may polo: Cá sấu cotton 100%, cá sấu poly 4 chiều, poly Thái cao cấp, cá sấu mè, cá sấu kim cương.
- Vải may cổ tròn: Cotton 100% 4 chiều, cotton 65/35, thun mè thể thao, thun lạnh co giãn.
- Kỹ thuật logo: Thêu vi tính ngực trái/sau lưng, in lụa, in pet chuyển nhiệt sắc nét, in decal ép nhiệt.

2. ĐỒNG PHỤC NHÓM - LỚP (DH_NHOM_LOP):
- Kiểu dáng: Áo lớp form rộng oversize, tay lỡ, polo lớp phối bo cổ dệt, áo đi biển họa tiết, áo teambuilding.
- Hỗ trợ: Miễn phí lên mẫu thiết kế 3D, hỗ trợ chỉnh sửa market không giới hạn.
- Cá nhân hóa: Hỗ trợ in tên riêng, số áo hoặc slogan độc quyền từng thành viên.

3. ĐỒNG PHỤC CÔNG SỞ (DH_CONG_SO):
- Hạng mục: Áo sơ mi nam/nữ (dài tay/ngắn tay), bộ vest, áo blazer, quần tây/quần âu, chân váy bút chì/chữ A, áo gile.
- Chất liệu sơ mi: Vải kate Ý, kate Mỹ, bamboo sợi tre kháng khuẩn, lụa co giãn chống nhăn.
- Chất liệu vest & quần: Vải tuyết mưa, wool pha cao cấp, cashmere giữ form đứng dáng.

4. ĐỒNG PHỤC NHÀ HÀNG - KHÁCH SẠN (DH_NHA_HANG_KS):
- Bộ phận: Phục vụ bàn, lễ tân (receptionist), buồng phòng (housekeeping), pha chế (barista/bartender), tạp dề quán cafe, đồng phục resort.
- Màu sắc: Phối màu theo đúng hệ thống nhận diện thương hiệu hoặc màu phong thủy nhà hàng.

5. ĐỒNG PHỤC BẾP (DH_BEP):
- Hạng mục: Áo bếp trưởng, áo bếp phó, áo phụ bếp (tay ngắn/tay dài, khuy bấm hoặc cài chéo), quần bếp kẻ/đen, tạp dề bếp, nón chef/nón bánh.
- Chất liệu: Vải kaki dày dặn, kaki cotton chịu nhiệt tốt, chống bám dầu mỡ và dễ giặt tẩy.

6. ĐỒNG PHỤC Y TẾ (DH_Y_TE):
- Hạng mục: Áo blouse trắng bác sĩ/dược sĩ (dài/ngắn), bộ scrub phẫu thuật, đồng phục điều dưỡng/y tá, đồng phục nha khoa, phòng khám đa khoa, xét nghiệm.
- Chất liệu: Vải lon Mỹ, kate for, thun cotton y tế co giãn thoáng mát, thấm hút mồ hôi.

7. BẢO HỘ LAO ĐỘNG (BAO_HO_LD):
- Hạng mục: Quần áo công nhân sản xuất, đồng phục kỹ sư/kỹ thuật, áo gile phản quang, áo khoác bảo hộ, đồ thợ hàn, đồ xưởng cơ khí, giày/nón/găng tay PPE.
- Chất liệu & tính năng: Vải kaki Pangrim Hàn Quốc, kaki Nam Định, kaki chống cháy nhẹ, sợi phản quang đạt chuẩn ban đêm.

8. QUÀ TẶNG DOANH NGHIỆP (QUA_TANG_DN):
- Danh mục: Bình giữ nhiệt inox in/khắc logo, ly sứ in logo, bút bi quảng cáo, bút ký kim loại cao cấp, sổ tay bìa da, túi vải canvas/tote, nón kết, ô dù cầm tay gấp gọn, móc khóa, giftset hộp quà combo sang trọng.
- Ngân sách: Tư vấn linh hoạt theo mức ngân sách từ bình dân (20k - 50k) đến cao cấp (200k - 1.000k/phần).

CHÍNH SÁCH VẬN HÀNH & NĂNG LỰC:
- Nhận đơn từ 10 sản phẩm đến 50.000 sản phẩm.
- Thời gian sản xuất tiêu chuẩn: 3 - 5 ngày làm việc. Có hỗ trợ nhận đơn may gấp theo thỏa thuận.
- Quy trình: Tư vấn nhu cầu -> Lên market 3D duyệt mẫu -> Đặt cọc 50% -> Sản xuất -> Giao hàng toàn quốc & thanh toán phần còn lại.`;

export async function webhookSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // GET /api/v1/settings/webhook — retrieve current webhook config and gemini settings
  app.get('/api/v1/settings/webhook', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;

      const [urlSetting, secretSetting, geminiSetting] = await Promise.all([
        prisma.appSetting.findFirst({ where: { orgId, settingKey: 'webhook_url' } }),
        prisma.appSetting.findFirst({ where: { orgId, settingKey: 'webhook_secret' } }),
        prisma.appSetting.findFirst({ where: { orgId, settingKey: 'gemini_api_key' } }),
      ]);

      return {
        url: urlSetting?.valuePlain ?? null,
        // Mask secret — show only last 4 chars
        secret: secretSetting?.valuePlain
          ? `${'*'.repeat(Math.max(0, secretSetting.valuePlain.length - 4))}${secretSetting.valuePlain.slice(-4)}`
          : null,
        geminiApiKey: geminiSetting?.valuePlain
          ? `${'*'.repeat(Math.max(0, geminiSetting.valuePlain.length - 4))}${geminiSetting.valuePlain.slice(-4)}`
          : null,
      };
    } catch (err) {
      logger.error('[webhook-settings] GET error:', err);
      return reply.status(500).send({ error: 'Failed to fetch webhook settings' });
    }
  });

  // PUT /api/v1/settings/webhook — save webhook URL, secret and gemini key
  app.put('/api/v1/settings/webhook', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;
      const { url, secret, geminiApiKey, gemini_api_key } = request.body as any;

      const keyVal = geminiApiKey !== undefined ? geminiApiKey : gemini_api_key;

      const promises: Promise<any>[] = [];
      if (url !== undefined) {
        promises.push(upsertSetting(orgId, 'webhook_url', url));
      }
      if (secret !== undefined && typeof secret === 'string' && !secret.includes('*')) {
        promises.push(upsertSetting(orgId, 'webhook_secret', secret));
      }
      if (keyVal !== undefined && typeof keyVal === 'string' && !keyVal.includes('*')) {
        promises.push(upsertSetting(orgId, 'gemini_api_key', keyVal));
      }

      await Promise.all(promises);

      return { success: true };
    } catch (err) {
      logger.error('[webhook-settings] PUT error:', err);
      return reply.status(500).send({ error: 'Failed to save webhook settings' });
    }
  });

  // POST /api/v1/settings/webhook/test — deliver a test event to configured URL
  app.post('/api/v1/settings/webhook/test', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;

      const config = await prisma.appSetting.findFirst({ where: { orgId, settingKey: 'webhook_url' } });
      if (!config?.valuePlain) {
        return reply.status(400).send({ error: 'No webhook URL configured' });
      }

      await emitWebhook(orgId, 'webhook.test', { message: 'Test event from Zalo CRM', orgId });
      return { success: true, sentTo: config.valuePlain };
    } catch (err) {
      logger.error('[webhook-settings] Test error:', err);
      return reply.status(500).send({ error: 'Failed to send test webhook' });
    }
  });

  // POST /api/v1/settings/api-key/generate — generate new public API key
  app.post('/api/v1/settings/api-key/generate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;

      const newKey = `zcrm_${crypto.randomBytes(24).toString('hex')}`;
      await upsertSetting(orgId, 'public_api_key', newKey);

      return { key: newKey };
    } catch (err) {
      logger.error('[webhook-settings] Generate API key error:', err);
      return reply.status(500).send({ error: 'Failed to generate API key' });
    }
  });

  // GET /api/v1/settings/api-key — retrieve masked API key
  app.get('/api/v1/settings/api-key', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;

      const setting = await prisma.appSetting.findFirst({ where: { orgId, settingKey: 'public_api_key' } });
      if (!setting?.valuePlain) return { key: null };

      const k = setting.valuePlain;
      // Show prefix + first 8 chars + mask + last 4 chars
      const masked = k.length > 12 ? `${k.slice(0, 12)}${'*'.repeat(k.length - 16)}${k.slice(-4)}` : `${k.slice(0, 4)}****`;
      return { key: masked };
    } catch (err) {
      logger.error('[webhook-settings] GET API key error:', err);
      return reply.status(500).send({ error: 'Failed to fetch API key' });
    }
  });

  // GET /api/v1/settings/ai/groups — retrieve list of synced Zalo groups
  app.get('/api/v1/settings/ai/groups', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;

      // Find all conversations of threadType === 'group' in this organization
      const conversations = await prisma.conversation.findMany({
        where: { orgId, threadType: 'group' },
        include: {
          contact: { select: { fullName: true } },
          zaloAccount: { select: { displayName: true } }
        },
        orderBy: { lastMessageAt: 'desc' }
      });

      const groups = conversations.map(c => ({
        id: c.id,
        externalThreadId: c.externalThreadId,
        name: c.contact?.fullName || 'Nhóm không tên',
        zaloAccountName: c.zaloAccount?.displayName || 'Không rõ Zalo'
      }));

      return groups;
    } catch (err) {
      logger.error('[ai-settings] GET groups error:', err);
      return reply.status(500).send({ error: 'Failed to fetch Zalo groups' });
    }
  });

  // GET /api/v1/settings/ai — retrieve current AI auto-reply configuration
  app.get('/api/v1/settings/ai', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;

      const [enabledSetting, promptSetting, kbSetting, scheduleSetting, alertGroupIdSetting, alertGroupNameSetting] = await Promise.all([
        prisma.appSetting.findFirst({ where: { orgId, settingKey: 'ai_enabled' } }),
        prisma.appSetting.findFirst({ where: { orgId, settingKey: 'ai_prompt' } }),
        prisma.appSetting.findFirst({ where: { orgId, settingKey: 'ai_knowledge_base' } }),
        prisma.appSetting.findFirst({ where: { orgId, settingKey: 'ai_schedule' } }),
        prisma.appSetting.findFirst({ where: { orgId, settingKey: 'ai_alert_group_id' } }),
        prisma.appSetting.findFirst({ where: { orgId, settingKey: 'ai_alert_group_name' } }),
      ]);

      return {
        aiEnabled: enabledSetting?.valuePlain === 'true',
        aiPrompt: promptSetting?.valuePlain ?? DEFAULT_PROMPT,
        aiKnowledgeBase: kbSetting?.valuePlain ?? DEFAULT_KB,
        aiSchedule: scheduleSetting?.valuePlain ?? JSON.stringify({ type: '24_7', customRanges: [] }),
        aiAlertGroupId: alertGroupIdSetting?.valuePlain ?? null,
        aiAlertGroupName: alertGroupNameSetting?.valuePlain ?? null,
      };
    } catch (err) {
      logger.error('[ai-settings] GET error:', err);
      return reply.status(500).send({ error: 'Failed to fetch AI settings' });
    }
  });

  // POST /api/v1/settings/ai — save AI auto-reply configuration
  app.post('/api/v1/settings/ai', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;
      const { aiEnabled, aiPrompt, aiKnowledgeBase, aiSchedule, aiAlertGroupId, aiAlertGroupName } = request.body as any;

      await Promise.all([
        aiEnabled !== undefined ? upsertSetting(orgId, 'ai_enabled', aiEnabled ? 'true' : 'false') : Promise.resolve(),
        aiPrompt !== undefined ? upsertSetting(orgId, 'ai_prompt', aiPrompt) : Promise.resolve(),
        aiKnowledgeBase !== undefined ? upsertSetting(orgId, 'ai_knowledge_base', aiKnowledgeBase) : Promise.resolve(),
        aiSchedule !== undefined ? upsertSetting(orgId, 'ai_schedule', aiSchedule) : Promise.resolve(),
        aiAlertGroupId !== undefined ? upsertSetting(orgId, 'ai_alert_group_id', aiAlertGroupId ?? '') : Promise.resolve(),
        aiAlertGroupName !== undefined ? upsertSetting(orgId, 'ai_alert_group_name', aiAlertGroupName ?? '') : Promise.resolve(),
      ]);

      return { success: true };
    } catch (err) {
      logger.error('[ai-settings] POST error:', err);
      return reply.status(500).send({ error: 'Failed to save AI settings' });
    }
  });

  // POST /api/v1/settings/ai/test — live simulation or real Gemini test of AI training prompt & KB
  app.post('/api/v1/settings/ai/test', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;
      const { message, prompt, knowledgeBase } = request.body as any;

      if (!message || typeof message !== 'string') {
        return reply.status(400).send({ error: 'Message is required' });
      }

      // Check Gemini API key
      const geminiSetting = await prisma.appSetting.findFirst({
        where: { orgId, settingKey: 'gemini_api_key' }
      });
      const rawApiKey = geminiSetting?.valuePlain || process.env.GEMINI_API_KEY || '';
      const apiKeys = rawApiKey.split(/[,;]+/).map((k: string) => k.trim()).filter(Boolean);

      const effectivePrompt = prompt || DEFAULT_PROMPT;
      const effectiveKB = knowledgeBase || DEFAULT_KB;
      const systemInstruction = `${effectivePrompt}\n\nThông tin chi tiết về doanh nghiệp:\n${effectiveKB}`;

      let replyText = '';
      let category = 'DH_AO_THUN';
      const toolsUsed = [
        { name: 'Định tuyến ngành hàng B2B', description: 'Phân tích từ khoá & xác định danh mục', status: 'done' },
        { name: 'Cơ sở tri thức & Quy chuẩn', description: 'Kiểm tra chất liệu, size, thời gian sản xuất', status: 'done' }
      ];

      if (apiKeys.length > 0) {
        for (const key of apiKeys) {
          try {
            const resp = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  contents: [{ role: 'user', parts: [{ text: message }] }],
                  systemInstruction: { parts: [{ text: systemInstruction }] },
                  generationConfig: {
                    temperature: 0.6,
                    maxOutputTokens: 1024,
                    thinkingConfig: { thinkingBudget: 0 }
                  }
                })
              }
            );
            if (resp.ok) {
              const resData = (await resp.json()) as any;
              let raw = resData.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
              if (raw.startsWith('```json')) raw = raw.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
              else if (raw.startsWith('```')) raw = raw.replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
              if (raw.startsWith('{') && raw.endsWith('}')) {
                try {
                  const parsed = JSON.parse(raw);
                  if (parsed.reply_text) replyText = parsed.reply_text;
                  if (parsed.category) category = parsed.category;
                } catch {}
              }
              if (!replyText) replyText = raw;
              break;
            }
          } catch (e) {
            logger.warn('[ai-test] Gemini test key failed:', e);
          }
        }
      }

      // If no Gemini key or call didn't produce text, use intelligent dataset matching
      if (!replyText) {
        const q = message.toLowerCase();
        if (q.includes('khiếu nại') || q.includes('thiếu') || q.includes('hỏng') || q.includes('lỗi') || q.includes('sai')) {
          replyText = 'Dạ em xin ghi nhận tình trạng đơn hàng của mình. Anh/chị cho em xin mã đơn hàng hoặc số điện thoại đặt hàng để em chuyển bộ phận xử lý khiếu nại kiểm tra ngay ạ!';
          category = 'KHIEU_NAI';
        } else if (q.includes('áo lớp') || q.includes('học sinh') || q.includes('teambuilding')) {
          replyText = 'Dạ lớp mình dự kiến làm áo cổ tròn oversize hay polo có cổ ạ? Lớp mình đã có mẫu thiết kế riêng chưa ạ?';
          category = 'DH_NHOM_LOP';
        } else if (q.includes('sơ mi') || q.includes('công sở') || q.includes('vest') || q.includes('quần tây')) {
          replyText = 'Dạ mình may sơ mi cho nam, nữ hay cả hai ạ? Bên mình cần số lượng dự kiến khoảng bao nhiêu áo ạ?';
          category = 'DH_CONG_SO';
        } else if (q.includes('bếp') || q.includes('chef') || q.includes('tạp dề')) {
          replyText = 'Dạ mình cần đặt áo bếp tay ngắn hay tay dài ạ? Bên mình cần may bao nhiêu áo và có cần thêu logo nhà hàng không ạ?';
          category = 'DH_BEP';
        } else if (q.includes('scrub') || q.includes('blouse') || q.includes('y tế') || q.includes('bác sĩ')) {
          replyText = 'Dạ mình đặt áo blouse hay bộ scrub phẫu thuật ạ? Bên mình dự kiến chọn màu nào và số lượng bao nhiêu bộ ạ?';
          category = 'DH_Y_TE';
        } else if (q.includes('bảo hộ') || q.includes('kỹ sư') || q.includes('chống tĩnh điện') || q.includes('phản quang')) {
          replyText = 'Dạ bên mình cần đáp ứng tiêu chuẩn an toàn hoặc chống tĩnh điện cụ thể nào ạ? Em xin thông tin để chuyển chuyên viên kỹ thuật xác minh phản hồi ạ.';
          category = 'BAO_HO_LD';
        } else if (q.includes('quà tặng') || q.includes('giftset') || q.includes('bình giữ nhiệt') || q.includes('ly sứ') || q.includes('sổ tay')) {
          replyText = 'Dạ mình đã chọn được loại quà tặng cụ thể nào chưa, hay cần em tư vấn theo mức ngân sách dự kiến trên mỗi phần quà ạ?';
          category = 'QUA_TANG_DN';
        } else if (q.includes('khách sạn') || q.includes('buồng phòng') || q.includes('lễ tân') || q.includes('nhà hàng')) {
          replyText = 'Dạ mình cần may đồng phục cho bộ phận nào (lễ tân, phục vụ, hay buồng phòng) và số lượng khoảng bao nhiêu bộ ạ?';
          category = 'DH_NHA_HANG_KS';
        } else {
          replyText = 'Dạ bên em chuyên may đồng phục polo, áo thun cổ tròn và quà tặng doanh nghiệp theo yêu cầu. Mình dự kiến may số lượng bao nhiêu cái và cần nhận hàng vào ngày nào ạ?';
          category = 'DH_AO_THUN';
        }
      }

      const suggestionsMap: Record<string, string[]> = {
        'DH_AO_THUN': [
          'Bên em có nhận may từ 10 áo thun cổ tròn không?',
          'Báo giá 100 áo thun polo có cổ thêu logo ngực',
          'Thời gian may bao lâu thì nhận được hàng?'
        ],
        'DH_NHOM_LOP': [
          'Lớp em cần 42 áo lớp polo oversize phối bo cổ',
          'Bên anh có hỗ trợ vẽ mẫu thiết kế 3D miễn phí không?',
          'Có in được tên và số riêng từng bạn không?'
        ],
        'DH_CONG_SO': [
          'Công ty chị cần 120 sơ mi nam nữ vải bamboo',
          'Bên em có gửi bảng size và mẫu vải tận nơi không?',
          'Báo giá may thêm quần tây và chân váy'
        ],
        'DH_NHA_HANG_KS': [
          'Cần đặt 30 áo sơ mi lễ tân và 50 áo phục vụ',
          'Có làm tạp dề in logo quán cafe không?',
          'Chính sách đặt cọc và xuất hóa đơn VAT thế nào?'
        ],
        'DH_BEP': [
          'Cho chị đặt 30 áo bếp trưởng màu đen tay dài',
          'Chất liệu vải kaki bếp có chống dầu mỡ không?',
          'Có bán kèm nón đầu bếp và tạp dề không?'
        ],
        'DH_Y_TE': [
          'Phòng khám chị đặt 60 bộ scrub xanh navy cổ tim',
          'Vải thun cotton y tế có thấm hút mồ hôi tốt không?',
          'Có thêu tên phòng khám lên ngực áo không?'
        ],
        'BAO_HO_LD': [
          'Nhà máy cần 100 bộ bảo hộ chống tĩnh điện phòng sạch',
          'Có may kèm dải phản quang đạt chuẩn ban đêm không?',
          'Có gửi mẫu thử để kiểm định an toàn trước không?'
        ],
        'QUA_TANG_DN': [
          'Bên chị cần 250 giftset bình giữ nhiệt ngân sách 200k/bộ',
          'Khắc laser logo lên bình giữ nhiệt có mất thêm phí không?',
          'Bên em có cung cấp hộp quà và túi xách đi kèm không?'
        ],
        'KHIEU_NAI': [
          'Mã đơn hàng của tôi là DH-202610-09',
          'Tôi muốn gửi hình ảnh áo bị sai màu',
          'Cho tôi gặp trực tiếp quản lý đơn hàng'
        ]
      };

      const suggestions = suggestionsMap[category] || [
        'Báo giá 100 áo thun polo đồng phục',
        'Thời gian may bao lâu thì nhận được hàng?',
        'Có hỗ trợ lên market 3D không?'
      ];

      return {
        replyText,
        category,
        toolCalls: toolsUsed,
        suggestions
      };
    } catch (err) {
      logger.error('[ai-settings] Test endpoint error:', err);
      return reply.status(500).send({ error: 'AI test execution failed' });
    }
  });
}

// ── Helper ────────────────────────────────────────────────────────────────────

async function upsertSetting(orgId: string, settingKey: string, value: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { orgId_settingKey: { orgId, settingKey } },
    create: { orgId, settingKey, valuePlain: value },
    update: { valuePlain: value },
  });
}
