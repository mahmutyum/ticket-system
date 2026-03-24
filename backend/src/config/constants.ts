export const TICKET_STATUSES = {
  OPEN: 'open',
  IN_PROGRESS: 'in_progress',
  WAITING_USER_RESPONSE: 'waiting_user_response',
  WAITING_OTHER_DEPARTMENT: 'waiting_other_department',
  TOPIC_TRANSFERRED: 'topic_transferred',
  PROCESS_OUTSIDE_IT: 'process_outside_it',
  ON_HOLD: 'on_hold',
  RESOLVED: 'resolved',
  CLOSED: 'closed',
} as const;

export const TICKET_STATUS_LABELS: Record<string, string> = {
  open: 'Açık',
  in_progress: 'İşlemde',
  waiting_user_response: 'Kullanıcı Yanıtı Bekleniyor',
  waiting_other_department: 'Diğer Birimden Destek Bekleniyor',
  topic_transferred: 'Konu Aktarıldı',
  process_outside_it: 'Süreç IT Dışında İlerliyor',
  on_hold: 'Beklemede',
  resolved: 'Çözüldü',
  closed: 'Kapatıldı',
};

export const PRIORITIES = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
} as const;

export const PRIORITY_LABELS: Record<string, string> = {
  low: 'Düşük',
  medium: 'Orta',
  high: 'Yüksek',
  critical: 'Kritik',
};

export const STAFF_ROLES = {
  ADMIN: 'admin',
  IT_MANAGER: 'it_manager',
  IT_STAFF: 'it_staff',
} as const;

export const STAFF_ROLE_LABELS: Record<string, string> = {
  admin: 'Sistem Yöneticisi',
  it_manager: 'IT Yöneticisi',
  it_staff: 'IT Personeli',
};

export const COMPANY_GROUP_TYPES = {
  CALL_CENTER: 'call_center',
  CORPORATE: 'corporate',
  WAREHOUSE: 'warehouse',
  RETAIL: 'retail',
} as const;

export const ONSITE_TYPES = {
  VISIT_EMPLOYEE: 'visit_employee',
  COME_TO_IT_ROOM: 'come_to_it_room',
} as const;

export const ONSITE_TYPE_LABELS: Record<string, string> = {
  visit_employee: 'Yerinde Müdahale',
  come_to_it_room: 'IT Odasına Gelin',
};

export const NOTIFICATION_CHANNELS = {
  TICKET_CREATED: 'ticket_created',
  STATUS_CHANGED: 'status_changed',
  ASSIGNED: 'assigned',
  NOTE_ADDED: 'note_added',
  ONSITE_SCHEDULED: 'onsite_scheduled',
  SLA_WARNING: 'sla_warning',
} as const;

export const FIELD_TYPES = ['text', 'number', 'select', 'phone', 'url', 'email', 'textarea'] as const;
