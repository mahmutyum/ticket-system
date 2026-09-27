import { useCallback } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import type { SlaAlert } from './useSSE';

/** SSE `sla_alert` olayını kısa bir bildirim olarak gösterir. */
export function useSlaAlertToast() {
  const { t } = useTranslation();
  return useCallback((alert: SlaAlert) => {
    const kind = t(`ticketList.timeline.slaKind.${alert.kind}`);
    const message = alert.level === 'breached'
      ? t('common.slaAlertBreached', { ticketNumber: alert.ticketNumber, kind })
      : t('common.slaAlertApproaching', { ticketNumber: alert.ticketNumber, kind });
    // Aynı ticket/tür için tekrarlayan olaylar tek bildirimde birleşir.
    const id = `sla-${alert.ticketId}-${alert.kind}-${alert.level}`;
    if (alert.level === 'breached') toast.error(message, { id, duration: 8000 });
    else toast(message, { id, icon: '⏳', duration: 6000 });
  }, [t]);
}
