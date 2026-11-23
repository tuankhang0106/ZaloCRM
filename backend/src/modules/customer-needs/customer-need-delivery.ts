import { config } from '../../config/index.js';

export type PortalReceipt = { id: number; sourceId: string; sourceOrgId: string; status: string; depositStatus: string };

export async function deliverCustomerNeed(need: any): Promise<{ receipt: PortalReceipt; url: string }> {
  const base = process.env.PORTAL_HANDOFF_URL?.trim();
  const token = process.env.PORTAL_HANDOFF_TOKEN?.trim();
  if (!base || !token) throw new Error('Chưa cấu hình kết nối portal. Phiếu đã lưu, có thể gửi lại sau.');
  const endpoint = new URL('/integrations/zalocrm/customer-needs', base);
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && !config.isProduction)) {
    throw new Error('Kết nối portal phải dùng HTTPS trong môi trường production.');
  }
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(need),
    });
  } catch {
    throw new Error('Chưa xác nhận được portal đã nhận phiếu. Bấm gửi lại để kiểm tra; hệ thống không tạo phiếu trùng.');
  }
  const result = await response.json().catch(() => null) as any;
  if (!response.ok) {
    const detail = response.status === 422 ? String(result?.message || 'Kiểm tra ánh xạ doanh nghiệp và dữ liệu phiếu.').slice(0, 350) :
      response.status === 401 ? 'Khóa kết nối portal không hợp lệ.' : 'Portal chưa sẵn sàng tiếp nhận.';
    throw new Error(`${detail} Phiếu đã lưu; có thể gửi lại sau.`);
  }
  const receipt = result?.need as PortalReceipt;
  if (!receipt || !Number.isSafeInteger(receipt.id) || receipt.id <= 0 || receipt.sourceId !== need.id || receipt.sourceOrgId !== need.orgId) {
    throw new Error('Phản hồi portal không hợp lệ. Phiếu đã lưu để gửi lại.');
  }
  const url = new URL('/crm/accounting/needs', endpoint);
  url.searchParams.set('need', String(receipt.id));
  return { receipt, url: url.toString() };
}
