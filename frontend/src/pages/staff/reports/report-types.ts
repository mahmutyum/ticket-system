export type Period = 'daily' | 'weekly' | 'monthly';
export type SlaPeriod = 'weekly' | 'monthly';
export type TabKey = 'overview' | 'staff' | 'category' | 'sla';

export interface ReportFilters {
  dateFrom: string;
  dateTo: string;
  companyId: string;
  categoryId: string;
  assignedToId: string;
  priority: string;
}

export const EMPTY_REPORT_FILTERS: ReportFilters = {
  dateFrom: '', dateTo: '', companyId: '', categoryId: '', assignedToId: '', priority: '',
};

export interface OverviewBucket {
  bucket: string;
  created: number;
  resolved: number;
  inProgress: number;
  overdue: number;
}

export interface StaffPerformance {
  id: string;
  fullName: string;
  role: string;
  totalAssigned: number;
  resolved: number;
  open: number;
  slaResponseRate: number | null;
  slaResolveRate: number | null;
  avgResolutionHours: number | null;
}

export interface CategoryBreakdown {
  categoryId: string;
  categoryName: string;
  count: number;
}

export interface SlaTrendBucket {
  bucket: string;
  total: number;
  responseRate: number | null;
  resolveRate: number | null;
}

export interface SlaSummary {
  totalWithSla: number;
  response: { met: number; violated: number; complianceRate: number };
  resolution: { met: number; violated: number; complianceRate: number };
}

export function buildReportQuery(filters: ReportFilters, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams();
  Object.entries({ ...filters, ...extra }).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return params.toString();
}
