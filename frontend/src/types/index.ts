export interface Company {
  id: string;
  name: string;
  groupType: string;
  logo?: string;
}

export interface Location {
  id: string;
  companyId: string;
  name: string;
  address?: string;
  phone?: string;
  floor?: string;
  itRoom?: string;
}

export interface Category {
  id: string;
  companyId?: string;
  name: string;
  description?: string;
  parentId?: string;
  sortOrder: number;
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
}

export interface Ticket {
  id: string;
  ticketNumber: string;
  subject: string;
  description: string;
  status: string;
  priority: string;
  accessToken: string;
  createdAt: string;
  updatedAt: string;
  company: { name: string };
  location: { name: string };
  category: { name: string };
  assignedTo?: { id: string; fullName: string };
  createdBy?: { fullName: string; phone?: string };
  createdByEmail: string;
}

export interface TicketNote {
  id: string;
  content: string;
  isInternal: boolean;
  createdAt: string;
  createdBy: { fullName: string; role: string };
}

export interface TicketHistory {
  id: string;
  action: string;
  field?: string;
  oldValue?: string;
  newValue?: string;
  createdAt: string;
  createdBy?: { fullName: string };
  createdByEmail?: string;
}

export interface DashboardStats {
  summary: {
    totalOpen: number;
    totalInProgress: number;
    todayCreated: number;
    slaViolations: number;
  };
  byStatus: { status: string; count: number }[];
  byPriority: { priority: string; count: number }[];
  byCompany: { companyId: string; companyName: string; count: number }[];
  recentTickets: Ticket[];
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

export const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-gray-100 text-gray-700',
  medium: 'bg-blue-100 text-blue-700',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
};
