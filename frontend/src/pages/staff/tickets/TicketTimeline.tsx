import { Lock, MessageSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { dateLocale } from '../../../i18n/format';
import type { TFunction } from 'i18next';
import { useEnumLabels } from '../../../i18n/labels';
import type { TicketHistory, TicketNote } from '../../../types';

type TimelineItem =
  | (TicketHistory & { type: 'history'; time: string })
  | (TicketNote & { type: 'note'; time: string });

interface Props {
  history?: TicketHistory[];
  notes?: TicketNote[];
}

function historyText(
  item: TicketHistory,
  t: TFunction,
  labels: ReturnType<typeof useEnumLabels>,
): string {
  switch (item.action) {
    case 'ticket_created': return t('ticketList.timeline.ticketCreated');
    case 'status_changed': return t('ticketList.timeline.statusChanged', {
      from: item.oldValue ? labels.status(item.oldValue) : item.oldValue,
      to: item.newValue ? labels.status(item.newValue) : item.newValue,
    });
    case 'priority_changed': return t('ticketList.timeline.priorityChanged', {
      from: item.oldValue ? labels.priority(item.oldValue) : item.oldValue,
      to: item.newValue ? labels.priority(item.newValue) : item.newValue,
    });
    case 'assigned': return t('ticketList.timeline.assigned');
    case 'user_reply': return t('ticketList.timeline.userReply', { value: item.newValue });
    case 'onsite_scheduled': return t('ticketList.timeline.onsiteScheduled');
    default: return item.action;
  }
}

export default function TicketTimeline({ history = [], notes = [] }: Props) {
  const { t } = useTranslation();
  const labels = useEnumLabels();
  const timeline: TimelineItem[] = [
    ...history.map(item => ({ ...item, type: 'history' as const, time: item.createdAt })),
    ...notes.map(item => ({ ...item, type: 'note' as const, time: item.createdAt })),
  ].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

  return (
    <div className="space-y-4">
      {timeline.map(item => {
        if (item.type === 'note') {
          return (
            <div key={`note-${item.id}`} className={`rounded-lg border p-4 ${item.isInternal ? 'border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10' : 'border-primary-200 bg-primary-50 dark:border-primary-500/30 dark:bg-primary-500/10'}`}>
              <div className="flex items-center gap-2 mb-2">
                {item.isInternal ? <Lock className="w-4 h-4 text-amber-600 dark:text-amber-300" /> : <MessageSquare className="w-4 h-4 text-primary-600 dark:text-primary-300" />}
                <span className="font-medium text-sm">{item.createdBy?.fullName}</span>
                {item.isInternal && <span className="rounded bg-amber-200 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-500/20 dark:text-amber-200">{t('ticketList.timeline.internalNote')}</span>}
                <span className="ml-auto text-xs text-muted">{new Date(item.createdAt).toLocaleString(dateLocale())}</span>
              </div>
              <p className="text-sm text-gray-700 dark:text-slate-100">{item.content}</p>
            </div>
          );
        }

        return (
          <div key={`hist-${item.id}`} className="flex gap-3 text-sm text-muted">
            <div className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-gray-300 dark:bg-slate-500" />
            <div className="flex-1">
              <span className="text-xs text-muted">{new Date(item.createdAt).toLocaleString(dateLocale())}</span>
              {item.createdBy && <span className="text-xs ml-2">({item.createdBy.fullName})</span>}
              <span className="ml-2">{historyText(item, t, labels)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
