import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { zaloPool } from '../zalo/zalo-pool.js';
import { randomUUID } from 'node:crypto';

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

function isWithinSchedule(schedule: any): boolean {
  if (!schedule || schedule.type === '24_7') return true;

  const now = new Date();
  const day = now.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  const hour = now.getHours();
  const minute = now.getMinutes();
  const timeVal = hour * 60 + minute; // current time in minutes from midnight

  if (schedule.type === 'off_hours') {
    // Standard working hours: Monday (1) to Friday (5), 08:00 (480 mins) to 17:30 (1050 mins)
    const isWorkDay = day >= 1 && day <= 5;
    const isWorkHour = timeVal >= 8 * 60 && timeVal <= (17 * 60 + 30);

    if (isWorkDay && isWorkHour) {
      return false; // AI auto-reply is ACTIVE only OUTSIDE working hours!
    }
    return true;
  }

  return true;
}

export async function triggerAiAutoReply(
  _conversationId: string,
  _orgId: string,
  _accountId: string,
): Promise<void> {
  // AI auto-reply feature has been permanently disabled per user request
  return;
}
