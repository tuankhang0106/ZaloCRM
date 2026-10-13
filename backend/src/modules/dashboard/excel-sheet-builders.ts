/**
 * excel-sheet-builders.ts — ExcelJS worksheet builders for each report type.
 * Each function adds a worksheet to the provided workbook and populates it with data.
 */
import ExcelJS from 'exceljs';
import { prisma } from '../../shared/database/prisma-client.js';

export async function buildMessagesSheet(
  workbook: ExcelJS.Workbook,
  orgId: string,
  from: string,
  to: string,
): Promise<void> {
  const sheet = workbook.addWorksheet('Tin nhắn');
  sheet.columns = [
    { header: 'Ngày', key: 'date', width: 15 },
    { header: 'Đã gửi', key: 'sent', width: 12 },
    { header: 'Đã nhận', key: 'received', width: 12 },
    { header: 'Tổng', key: 'total', width: 12 },
  ];

  const rows = await prisma.$queryRaw<
    Array<{ date: Date; sent: bigint; received: bigint; total: bigint }>
  >`
    SELECT
      DATE(m.sent_at) AS date,
      COUNT(*) FILTER (WHERE m.sender_type = 'self') AS sent,
      COUNT(*) FILTER (WHERE m.sender_type = 'contact') AS received,
      COUNT(*) AS total
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE c.org_id = ${orgId}
      AND m.sent_at >= ${from}::date
      AND m.sent_at < (${to}::date + interval '1 day')
    GROUP BY DATE(m.sent_at)
    ORDER BY date DESC
  `;

  for (const r of rows) {
    sheet.addRow({
      date: r.date instanceof Date ? r.date.toISOString().split('T')[0] : String(r.date),
      sent: Number(r.sent),
      received: Number(r.received),
      total: Number(r.total),
    });
  }
}

export async function buildContactsSheet(
  workbook: ExcelJS.Workbook,
  orgId: string,
  from: string,
  to: string,
): Promise<void> {
  const sheet = workbook.addWorksheet('Liên hệ');
  sheet.columns = [
    { header: 'Ngày', key: 'date', width: 15 },
    { header: 'Tài khoản Zalo', key: 'zaloName', width: 25 },
    { header: 'Liên hệ mới', key: 'count', width: 15 },
  ];

  const rows = await prisma.$queryRaw<
    Array<{ date: Date; zaloName: string; count: bigint }>
  >`
    SELECT 
      DATE(c.created_at) AS date,
      za.display_name AS "zaloName",
      COUNT(DISTINCT c.id) AS count
    FROM contacts c
    JOIN conversations conv ON conv.contact_id = c.id
    JOIN zalo_accounts za ON za.id = conv.zalo_account_id
    WHERE c.org_id = ${orgId}
      AND c.zalo_uid IS NOT NULL
      AND conv."threadType" = 'user'
      AND c.created_at >= ${from}::date
      AND c.created_at < (${to}::date + interval '1 day')
    GROUP BY DATE(c.created_at), za.display_name
    ORDER BY date DESC, za.display_name ASC
  `;

  for (const r of rows) {
    sheet.addRow({
      date: r.date instanceof Date ? r.date.toISOString().split('T')[0] : String(r.date),
      zaloName: r.zaloName,
      count: Number(r.count),
    });
  }
}

export async function buildAppointmentsSheet(
  workbook: ExcelJS.Workbook,
  orgId: string,
  from: string,
  to: string,
): Promise<void> {
  const sheet = workbook.addWorksheet('Lịch hẹn');
  sheet.columns = [
    { header: 'Trạng thái', key: 'status', width: 20 },
    { header: 'Số lượng', key: 'count', width: 12 },
  ];

  const dateFilter = { gte: new Date(from), lte: new Date(to) };
  const stats = await prisma.appointment.groupBy({
    by: ['status'],
    where: { orgId, appointmentDate: dateFilter },
    _count: true,
  });

  for (const s of stats) {
    sheet.addRow({ status: s.status, count: s._count });
  }
}
