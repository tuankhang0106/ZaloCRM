export interface CustomerStatus {
  id: string;
  value: string;
  label: string;
  text: string;
  icon: string;
  color: string;
  aliases: string[];
}

export const CUSTOMER_STATUS_LIST: CustomerStatus[] = [
  {
    id: 'new',
    value: 'new',
    label: 'Mới tiếp cận',
    text: 'Mới tiếp cận',
    icon: 'mdi-account-plus',
    color: '#0284c7',
    aliases: ['new'],
  },
  {
    id: 'contacted',
    value: 'contacted',
    label: 'Đang tư vấn',
    text: 'Đang tư vấn',
    icon: 'mdi-chat-processing-outline',
    color: '#d97706',
    aliases: ['contacted', 'consulting'],
  },
  {
    id: 'processing',
    value: 'processing',
    label: 'Đang xử lý / Đơn',
    text: 'Đang xử lý / Đơn',
    icon: 'mdi-progress-clock',
    color: '#0d9488',
    aliases: ['processing'],
  },
  {
    id: 'quoted',
    value: 'quoted',
    label: 'Chờ báo giá / Cọc',
    text: 'Chờ báo giá / Cọc',
    icon: 'mdi-cash-clock',
    color: '#9333ea',
    aliases: ['quoted', 'quote'],
  },
  {
    id: 'converted',
    value: 'converted',
    label: 'Đã chốt đơn',
    text: 'Đã chốt đơn',
    icon: 'mdi-check-decagram',
    color: '#16a34a',
    aliases: ['converted', 'done'],
  },
  {
    id: 'lost',
    value: 'lost',
    label: 'Tạm ngưng',
    text: 'Tạm ngưng',
    icon: 'mdi-pause-circle-outline',
    color: '#4b5563',
    aliases: ['lost', 'paused'],
  },
  {
    id: 'warning',
    value: 'warning',
    label: 'Cần lưu ý',
    text: 'Cần lưu ý',
    icon: 'mdi-alert-circle-outline',
    color: '#dc2626',
    aliases: ['warning', 'alert'],
  },
  {
    id: 'completed',
    value: 'completed',
    label: 'Hoàn thành',
    text: 'Hoàn thành',
    icon: 'mdi-check-circle-outline',
    color: '#059669',
    aliases: ['completed', 'vip', 'finished', 'hoanthanh'],
  },
];

export function normalizeCustomerStatus(statusKey: string | null | undefined): CustomerStatus {
  if (!statusKey) return CUSTOMER_STATUS_LIST[0];
  const normalized = statusKey.toLowerCase().trim();
  const found = CUSTOMER_STATUS_LIST.find(
    s => s.id === normalized || s.value === normalized || s.aliases.includes(normalized)
  );
  return found || {
    id: statusKey,
    value: statusKey,
    label: statusKey,
    text: statusKey,
    icon: 'mdi-account-outline',
    color: '#0284c7',
    aliases: [],
  };
}
