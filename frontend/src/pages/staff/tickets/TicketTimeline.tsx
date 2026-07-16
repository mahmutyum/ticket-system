import { Lock, MessageSquare } from 'lucide-react';
import { STATUS_LABELS } from '../../../types';
import type { TicketHistory, TicketNote } from '../../../types';

type TimelineItem =
  | (TicketHistory & { type: 'history'; time: string })
  | (TicketNote & { type: 'note'; time: string });

interface Props {
  history?: TicketHistory[];
  notes?: TicketNote[];
}

function historyText(item: TicketHistory): string {
  switch (item.action) {
    case 'ticket_created': return 'Talep oluşturuldu';
    case 'status_changed': return `Durum: ${STATUS_LABELS[item.oldValue ?? ''] || item.oldValue} → ${STATUS_LABELS[item.newValue ?? ''] || item.newValue}`;
    case 'priority_changed': return `Öncelik: ${item.oldValue} → ${item.newValue}`;
    case 'assigned': return 'Talep atandı';
    case 'user_reply': return `Kullanıcı yanıtı: ${item.newValue}`;
    case 'onsite_scheduled': return 'Yerinde destek planlandı';
    default: return item.action;
  }
}

export default function TicketTimeline({ history = [], notes = [] }: Props) {
  const timeline: TimelineItem[] = [
    ...history.map(item => ({ ...item, type: 'history' as const, time: item.createdAt })),
    ...notes.map(item => ({ ...item, type: 'note' as const, time: item.createdAt })),
  ].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

  return (
    <div className="space-y-4">
      {timeline.map(item => {
        if (item.type === 'note') {
          return (
            <div key={`note-${item.id}`} className={`rounded-lg p-4 ${item.isInternal ? 'bg-yellow-50 border border-yellow-200' : 'bg-primary-50 border border-primary-200'}`}>
              <div className="flex items-center gap-2 mb-2">
                {item.isInternal ? <Lock className="w-4 h-4 text-yellow-600" /> : <MessageSquare className="w-4 h-4 text-primary-600" />}
                <span className="font-medium text-sm">{item.createdBy?.fullName}</span>
                {item.isInternal && <span className="text-xs bg-yellow-200 text-yellow-700 px-1.5 py-0.5 rounded">Dahili Not</span>}
                <span className="text-xs text-gray-400 ml-auto">{new Date(item.createdAt).toLocaleString('tr-TR')}</span>
              </div>
              <p className="text-sm text-gray-700 dark:text-slate-300">{item.content}</p>
            </div>
          );
        }

        return (
          <div key={`hist-${item.id}`} className="flex gap-3 text-sm text-gray-500">
            <div className="w-2 h-2 rounded-full bg-gray-300 mt-1.5 flex-shrink-0" />
            <div className="flex-1">
              <span className="text-xs text-gray-400">{new Date(item.createdAt).toLocaleString('tr-TR')}</span>
              {item.createdBy && <span className="text-xs ml-2">({item.createdBy.fullName})</span>}
              <span className="ml-2">{historyText(item)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
