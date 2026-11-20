export const CONVERSATION_CATEGORIES = [
  { title: 'Khách hàng', icon: 'mdi-account-check', color: '#007A3D' },
  { title: 'Nhà cung cấp', icon: 'mdi-truck-outline', color: '#EA580C' },
  { title: 'Nội bộ công ty', icon: 'mdi-domain', color: '#475569' },
] as const;

export const CONVERSATION_CATEGORY_LABELS = CONVERSATION_CATEGORIES.map(item => item.title);
