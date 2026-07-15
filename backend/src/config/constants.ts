import {
  StaffRole,
  TicketStatus,
  Priority,
  TaskStatus,
  OnsiteType,
  OnsiteStatus,
  NotificationType,
  NotificationStatus,
  CustomFieldType,
  CompanyGroupType,
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
