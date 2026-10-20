export const CONVERSATION_CATEGORIES = [
  { title: 'KH quan trọng', icon: 'mdi-star-outline', color: '#B18A48' },
  { title: 'Đang báo giá', icon: 'mdi-file-document-edit-outline', color: '#6D9DA5' },
  { title: 'Cần xử lý gấp', icon: 'mdi-alert-circle-outline', color: '#BF7068' },
  { title: 'Đã chốt đơn', icon: 'mdi-check-circle-outline', color: '#5C9377' },
  { title: 'Bảo hành/KT', icon: 'mdi-tools', color: '#8B80AD' },
  { title: 'Nội bộ công ty', icon: 'mdi-domain', color: '#7F9187' },
] as const;

export const CONVERSATION_CATEGORY_LABELS = CONVERSATION_CATEGORIES.map(item => item.title);
