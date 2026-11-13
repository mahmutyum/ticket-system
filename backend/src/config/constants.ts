import {
  StaffRole,
  NotificationType,
  NotificationStatus,
  CustomFieldType,
} from '@prisma/client';

/**
 * Durum / öncelik / rol sözlükleri.
 *
 * Geçerli DEĞERLER Prisma şemasındaki enum'lardan gelir — burada elle liste
 * tutulmaz. Şemaya bir değer eklenip `prisma generate` çalıştırıldığında
 * `Object.values(...)` onu otomatik görür ve Zod şemaları (`z.nativeEnum`)
 * otomatik uyar. Eksik kalan tek şey ETİKETTİR: aşağıdaki `Record<Enum, string>`
 * tipleri enum'un tüm üyelerini zorunlu kılar, yani etiket eklemeyi unutursan
 * `tsc` hata verir.
 *
 * Bu dosya daha önce elle yazılmış string listeleri içeriyordu ve büyük kısmını
 * hiçbir yer import etmiyordu; her kontrol ham string literal'di. Değerler artık
 * tek kaynaktan geldiği için o durum tekrarlanamaz.
 */

// ==================== SÖZLÜK ANAHTAR SHIM'LERİ (v1.3 geçişi) ====================
//
// Bu değerler artık DB'deki dict_* tablolarında yaşar (bkz. prisma migrations
// v1_3_dictionaries). Buradaki nesneler:
//   1) Tür düzeyinde geriye uyumluluk sağlar (Record<TicketStatus, string> vb.),
//   2) Yalnızca ŞEMA-KAYNAKLI davranışlara (seed, geçiş) hizmet eder.
// Davranış kodunda anahtar literal kullanımı yasaktır — services/lookups.ts
// sınıf tabanlı sorguları kullanılır (bkz. ESLint no-restricted-syntax).

export const TicketStatus = {
  open: 'open',
  in_progress: 'in_progress',
  waiting_user_response: 'waiting_user_response',
  waiting_other_department: 'waiting_other_department',
  topic_transferred: 'topic_transferred',
  process_outside_it: 'process_outside_it',
  on_hold: 'on_hold',
  resolved: 'resolved',
  closed: 'closed',
} as const;
export type TicketStatus = (typeof TicketStatus)[keyof typeof TicketStatus];

/** Sistem sözlük anahtar haritası — davranışta kapalılık/çözümlülük SINIFINA bakar; bu harita yalnızca isSystem karşılıklar içindir. */
export const TICKET_STATUS_KEYS = TicketStatus;

export const Priority = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  critical: 'critical',
} as const;
export type Priority = (typeof Priority)[keyof typeof Priority];

export const TaskStatus = {
  open: 'open',
  in_progress: 'in_progress',
  done: 'done',
  cancelled: 'cancelled',
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

export const OnsiteType = {
  come_to_it_room: 'come_to_it_room',
  meeting_room: 'meeting_room',
  visit_employee: 'visit_employee',
} as const;
export type OnsiteType = (typeof OnsiteType)[keyof typeof OnsiteType];

export const OnsiteStatus = {
  scheduled: 'scheduled',
  in_progress: 'in_progress',
  completed: 'completed',
  cancelled: 'cancelled',
} as const;
export type OnsiteStatus = (typeof OnsiteStatus)[keyof typeof OnsiteStatus];

export const CompanyGroupType = {
  call_center: 'call_center',
  corporate: 'corporate',
  warehouse: 'warehouse',
  retail: 'retail',
} as const;
export type CompanyGroupType = (typeof CompanyGroupType)[keyof typeof CompanyGroupType];

/** Davranış sınıfları — KODDA kalır (panelden eklenemez, davranış sözleşmesidir). */
export const STATUS_CLASSES = ['new', 'active', 'waiting', 'resolved', 'closed'] as const;
export type StatusClass = (typeof STATUS_CLASSES)[number];

// ==================== ROLLER ====================

export const STAFF_ROLES = StaffRole;
export const STAFF_ROLE_VALUES = Object.values(StaffRole);

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  admin: 'Sistem Yöneticisi',
  it_manager: 'IT Yöneticisi',
  it_staff: 'IT Personeli',
};

// ==================== TICKET ====================

export const TICKET_STATUSES = TicketStatus;
export const TICKET_STATUS_VALUES = Object.values(TicketStatus);

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
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

/**
 * SLA saatini DURDURAN durumlar — ticket dış bir tarafa (kullanıcı, başka birim,
 * IT dışı süreç) bağlıyken geçen süre personelin SLA'sına yazılmaz. Bu durumlara
 * girildiğinde `slaPausedAt` işaretlenir; çıkıldığında son tarihler duraklatılan
 * süre kadar ileri kaydırılır. (v1.3'te bu liste durum sınıfına taşınacak.)
 */
export const SLA_PAUSING_STATUSES: readonly string[] = [
  TicketStatus.waiting_user_response,
  TicketStatus.waiting_other_department,
  TicketStatus.process_outside_it,
  TicketStatus.on_hold,
];

/** SLA'nın artık ölçülmediği son durumlar. */
export const SLA_FINAL_STATUSES: readonly string[] = [TicketStatus.resolved, TicketStatus.closed];

/**
 * Public takip linkinin çözüm/kapanıştan sonra geçerli kaldığı gün sayısı.
 * Süresi dolan link `/public/track` (numara + e-posta) ile yenilenebilir.
 */
export const PUBLIC_ACCESS_RETENTION_DAYS = 90;

/** Öncelik yükseltme sırası (SLA ihlali eskalasyonunda kullanılır). */
export const PRIORITY_ORDER: readonly string[] = [Priority.low, Priority.medium, Priority.high, Priority.critical];

/** Ticket ve görevler için ORTAK öncelik sözlüğü. */
export const PRIORITIES = Priority;
export const PRIORITY_VALUES = Object.values(Priority);

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: 'Düşük',
  medium: 'Orta',
  high: 'Yüksek',
  critical: 'Kritik',
};

// ==================== GÖREVLER ====================

export const TASK_STATUSES = TaskStatus;
export const TASK_STATUS_VALUES = Object.values(TaskStatus);

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  open: 'Açık',
  in_progress: 'Devam Ediyor',
  done: 'Tamamlandı',
  cancelled: 'İptal',
};

// ==================== YERİNDE DESTEK ====================

export const ONSITE_TYPES = OnsiteType;
export const ONSITE_TYPE_VALUES = Object.values(OnsiteType);

export const ONSITE_TYPE_LABELS: Record<OnsiteType, string> = {
  come_to_it_room: 'IT Odasına Gelin',
  meeting_room: 'Toplantı Odası',
  visit_employee: 'Yerinde Müdahale',
};

export const ONSITE_STATUSES = OnsiteStatus;
export const ONSITE_STATUS_VALUES = Object.values(OnsiteStatus);

export const ONSITE_STATUS_LABELS: Record<OnsiteStatus, string> = {
  scheduled: 'Planlanmış',
  in_progress: 'Devam Ediyor',
  completed: 'Tamamlandı',
  cancelled: 'İptal',
};

// ==================== BİLDİRİMLER ====================

export const NOTIFICATION_TYPES = NotificationType;
export const NOTIFICATION_TYPE_VALUES = Object.values(NotificationType);

export const NOTIFICATION_STATUSES = NotificationStatus;
export const NOTIFICATION_STATUS_VALUES = Object.values(NotificationStatus);

/**
 * Bildirim kanalları — bilinçli olarak enum DEĞİL.
 *
 * Kanal, e-posta/SMS şablonlarının `slug` alanıyla eşleşir ve şablonlar
 * veritabanından yönetilir; yeni bir şablon eklemek migration gerektirmemeli.
 */
export const NOTIFICATION_CHANNELS = {
  TICKET_CREATED: 'ticket_created',
  STATUS_CHANGED: 'status_changed',
  ASSIGNED: 'assigned',
  NOTE_ADDED: 'note_added',
  ONSITE_SCHEDULED: 'onsite_scheduled',
  SLA_WARNING: 'sla_warning',
} as const;

// ==================== ÖZEL ALANLAR ====================

export const FIELD_TYPES = CustomFieldType;
export const FIELD_TYPE_VALUES = Object.values(CustomFieldType);

// ==================== ŞİRKET ====================

export const COMPANY_GROUP_TYPES = CompanyGroupType;
export const COMPANY_GROUP_TYPE_VALUES = Object.values(CompanyGroupType);

export const COMPANY_GROUP_TYPE_LABELS: Record<CompanyGroupType, string> = {
  call_center: 'Çağrı Merkezi',
  corporate: 'Kurumsal',
  warehouse: 'Depo',
  retail: 'Perakende',
};
