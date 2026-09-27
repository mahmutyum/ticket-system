// Şirket SLA ayarları — backend `utils/sla-settings.ts` biçimiyle aynı.

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const PRIORITY_VALUES = ['low', 'medium', 'high', 'critical'] as const;
export type PriorityValue = (typeof PRIORITY_VALUES)[number];

export type TimeWindow = { start: string; end: string };

export type SlaSettings = {
  businessHours: {
    enabled: boolean;
    timezone: string;
    week: Partial<Record<Weekday, TimeWindow[]>>;
  } | null;
  alwaysOnPriorities: PriorityValue[];
  warningPercent: number;
  escalation: { notifyManagers: boolean; bumpPriority: boolean };
  satisfactionSurvey: boolean;
  autoClose: { resolvedAfterDays: number; waitingReminderAfterDays: number; waitingCloseAfterDays: number };
};
