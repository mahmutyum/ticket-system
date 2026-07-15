export interface Company {
  id: string;
  name: string;
  groupType: string;
  logo?: string;
  allowedDomains?: string[];
  portalDomains?: string[];
  notificationEmail?: string;
  isActive?: boolean;
  settings?: Record<string, unknown>;
  locations?: Location[];
  categories?: Category[];
  customFields?: CustomField[];
  smtpConfig?: SmtpConfig;
  _count?: { locations: number; tickets: number };
}

export interface Location {
  id: string;
  companyId: string;
  name: string;
  address?: string;
  phone?: string;
  floor?: string;
  itRoom?: string;
  isActive?: boolean;
}

export interface Category {
  id: string;
  companyId?: string;
  name: string;
  description?: string;
  parentId?: string;
  sortOrder: number;
  slaResponseMinutes?: number;
  slaResolutionMinutes?: number;
  autoAssignTo?: string;
  isActive?: boolean;
  children?: Category[];
}

export interface CustomField {
  id: string;
  companyId?: string;
  fieldName: string;
  fieldLabel: string;
  fieldType: string;
  options?: string[];
  required: boolean;
  placeholder?: string;
  isActive?: boolean;
  sortOrder: number;
}

export interface Staff {
  id: string;
  email: string;
  fullName: string;
  role: string;
  department?: string;
  phone?: string;
  isActive: boolean;
  avatarUrl?: string;
  assignedCompanies?: { companyId: string; company: Company }[];
  _count?: { assignedTickets: number };
}

export interface Ticket {
  id: string;
  ticketNumber: string;
  companyId: string;
  locationId: string;
  categoryId: string;
  createdByEmail: string;
  createdByUserId?: string;
  assignedToId?: string;
  subject: string;
  description: string;
  status: string;
  priority: string;
  accessToken: string;
  slaResponseDue?: string;
  slaResolveDue?: string;
  slaResponseMet?: boolean | null;
  slaResolveMet?: boolean | null;
  firstRespondedAt?: string;
  resolvedAt?: string;
  closedAt?: string;
  createdAt: string;
  updatedAt: string;
  company: { id?: string; name: string };
  location: { name: string };
  category: { name: string };
  assignedTo?: { id: string; fullName: string; email?: string; role?: string };
  createdBy?: { fullName: string; phone?: string };
  customValues?: TicketCustomValue[];
  notes?: TicketNote[];
  history?: TicketHistory[];
  attachments?: Attachment[];
  onsiteSupport?: OnsiteSupport[];
}

export interface TicketCustomValue {
  id: string;
  ticketId: string;
  customFieldId: string;
  value: string;
  customField?: CustomField;
}

export interface TicketNote {
  id: string;
  ticketId: string;
  content: string;
  isInternal: boolean;
  createdAt: string;
  createdBy: { fullName: string; role: string };
}

export interface TicketHistory {
  id: string;
  ticketId?: string;
  action: string;
  field?: string;
  oldValue?: string;
  newValue?: string;
  createdAt: string;
  createdBy?: { fullName: string };
  createdByEmail?: string;
}

export interface Attachment {
  id: string;
  ticketId: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  uploadedBy: string;
  createdAt: string;
}

export interface OnsiteSupport {
  id: string;
  ticketId: string;
  locationId: string;
  type: string;
  scheduledAt: string;
  scheduledEnd?: string;
  roomInfo?: string;
  floorInfo?: string;
  notes?: string;
  status: string;
  completedAt?: string;
  createdAt: string;
  location?: Location;
  ticket?: { ticketNumber: string; subject: string; createdBy?: { fullName: string; phone?: string }; createdByEmail?: string };
}

export interface SmtpConfig {
  id: string;
  companyId: string;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  fromName: string;
  fromEmail: string;
  isActive: boolean;
  updatedAt?: string;
}

export interface EmailTemplate {
  id: string;
  slug: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  variables: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SmsTemplate {
  id: string;
  slug: string;
  body: string;
  variables: string[];
  createdAt: string;
}

export interface CannedResponse {
  id: string;
  title: string;
  content: string;
  category?: string;
  sortOrder: number;
  createdAt: string;
}

export interface Notification {
  id: string;
  ticketId?: string;
  type: string;
  channel: string;
  recipient: string;
  subject?: string;
  body: string;
  status: string;
  errorMsg?: string;
  sentAt?: string;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  changes: Record<string, unknown>;
  performedBy: string;
  ipAddress?: string;
  createdAt: string;
}

export interface DashboardStats {
  summary: {
    totalOpen: number;
    totalInProgress: number;
    todayCreated: number;
    slaViolations: number;
    myOpen: number;
  };
  byStatus: { status: string; count: number }[];
  byPriority: { priority: string; count: number }[];
  byCompany: { companyId: string; companyName: string; count: number }[];
  recentTickets: Ticket[];
  accessibleCompanies: { id: string; name: string }[];
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export const VALID_STATUSES = [
  'open', 'in_progress', 'waiting_user_response', 'waiting_other_department',
  'topic_transferred', 'process_outside_it', 'on_hold', 'resolved', 'closed',
] as const;

export const STATUS_LABELS: Record<string, string> = {
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

export const PRIORITY_LABELS: Record<string, string> = {
  low: 'Düşük',
  medium: 'Orta',
  high: 'Yüksek',
  critical: 'Kritik',
};

export const ROLE_LABELS: Record<string, string> = {
  admin: 'Sistem Yöneticisi',
  it_manager: 'IT Yöneticisi',
  it_staff: 'IT Personeli',
};

export const GROUP_TYPE_LABELS: Record<string, string> = {
  call_center: 'Çağrı Merkezi',
  corporate: 'Kurumsal',
  warehouse: 'Depo',
  retail: 'Perakende',
};

export const STATUS_COLORS: Record<string, string> = {
  open: 'bg-blue-100 text-blue-800',
  in_progress: 'bg-yellow-100 text-yellow-800',
  waiting_user_response: 'bg-purple-100 text-purple-800',
  waiting_other_department: 'bg-orange-100 text-orange-800',
  topic_transferred: 'bg-indigo-100 text-indigo-800',
  process_outside_it: 'bg-gray-100 text-gray-800',
  on_hold: 'bg-gray-100 text-gray-600',
  resolved: 'bg-green-100 text-green-800',
  closed: 'bg-gray-200 text-gray-600',
};

// Öncelik sözlüğü ticket ve görevler için ORTAKTIR. Görevler eskiden 'urgent'
// kullanıyordu; aynı kavramın iki sözcüğü olmasın diye 'critical'a hizalandı.
// Yeni bir öncelik rozeti gerekiyorsa buraya ekle — sayfalarda kopyalama.
export const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-gray-100 text-gray-700 dark:bg-slate-700/60 dark:text-slate-300',
  medium: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
  critical: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
};

/** Öncelik sıralama ağırlığı (yüksek = önce). */
export const PRIORITY_WEIGHT: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export const ONSITE_STATUS_LABELS: Record<string, string> = {
  scheduled: 'Planlanmış',
  in_progress: 'Devam Ediyor',
  completed: 'Tamamlandı',
  cancelled: 'İptal',
};

export const ONSITE_STATUS_COLORS: Record<string, string> = {
  scheduled: 'bg-blue-100 text-blue-800',
  in_progress: 'bg-yellow-100 text-yellow-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
};
