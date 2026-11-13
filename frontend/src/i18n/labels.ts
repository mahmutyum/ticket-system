import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../api/client';

/**
 * Sözlük (v1.3) — DB'den yönetilen durum/öncelik/şirket türü etiketleri.
 *
 * `useEnumLabels` artık ÖNCE `/lookups`'tan okur (TanStack Query, uzun
 * staleTime — sözlük nadiren değişir); DB'de bulunmayan anahtar (ör. rol —
 * bilinçli olarak kodda kalır) çeviri dosyasına düşer. Böylece panelden
 * eklenen yeni bir durum deploy'suz tüm arayüzde doğru etiketle görünür.
 *
 * /lookups public ucu dilBağımsız TR+EN etiketi döner; seçim burada yapılır.
 */

type Entry = { key: string; labelTr: string; labelEn: string; color: string | null };

type LookupsData = Record<string, Entry[]>;

const EMPTY: LookupsData = {};

function useLookups(enabled: boolean): LookupsData {
  const { data } = useQuery({
    queryKey: ['lookups'],
    staleTime: 5 * 60 * 1000,
    enabled,
    queryFn: async () => {
      try {
        // Personel oturumu varsa tam sözlük; 401 ise public uç yeterli.
        try {
          return (await api.get('/lookups')).data.data as LookupsData;
        } catch (err) {
          const status = (err as { response?: { status?: number } }).response?.status;
          if (status === 401) {
            return (await api.get('/lookups/public')).data.data as LookupsData;
          }
          throw err;
        }
      } catch {
        return EMPTY; // sözlük alınamazsa çeviri fallback'i devralır
      }
    },
  });
  return data ?? EMPTY;
}

function labelFor(kind: string, entries: LookupsData, value: string, i18nFallback: string, i18nLang: string): string {
  const found = entries[kind]?.find((entry) => entry.key === value);
  if (found) return i18nLang.startsWith('en') ? found.labelEn : found.labelTr;
  return i18nFallback;
}

export function useEnumLabels() {
  const { t, i18n } = useTranslation();
  const lookups = useLookups(true);
  return {
    status: (v: string) => labelFor('ticketStatuses', lookups, v, t(`enums.status.${v}`, { defaultValue: v }), i18n.language),
    priority: (v: string) => labelFor('priorities', lookups, v, t(`enums.priority.${v}`, { defaultValue: v }), i18n.language),
    role: (v: string) => t(`enums.role.${v}`, { defaultValue: v }),
    groupType: (v: string) => labelFor('companyTypes', lookups, v, t(`enums.groupType.${v}`, { defaultValue: v }), i18n.language),
    onsiteStatus: (v: string) => labelFor('onsiteStatuses', lookups, v, t(`enums.onsiteStatus.${v}`, { defaultValue: v }), i18n.language),
    taskStatus: (v: string) => labelFor('taskStatuses', lookups, v, t(`enums.taskStatus.${v}`, { defaultValue: v }), i18n.language),
    /**
     * DB color tokenı (blue/green/red/…) — panelden eklenen yeni durumlar da
     * renk alır; bilinmeyen token 'gray' tokenına düşer.
     */
    statusColor: (v: string) => colorTokenFor('ticketStatuses', lookups, v),
    priorityColor: (v: string) => colorTokenFor('priorities', lookups, v),
    taskStatusColor: (v: string) => colorTokenFor('taskStatuses', lookups, v),
    onsiteStatusColor: (v: string) => colorTokenFor('onsiteStatuses', lookups, v),
  };
}

function colorTokenFor(kind: string, entries: LookupsData, value: string): string {
  return entries[kind]?.find((entry) => entry.key === value)?.color ?? 'gray';
}

/** Public sayfalar için (oturumsuz): yalnızca aktif girdiler. */
export function usePublicEnumLabels() {
  const { t, i18n } = useTranslation();
  const lookups = useLookups(true);
  return {
    status: (v: string) => labelFor('ticketStatuses', lookups, v, t(`enums.status.${v}`, { defaultValue: v }), i18n.language),
    priority: (v: string) => labelFor('priorities', lookups, v, t(`enums.priority.${v}`, { defaultValue: v }), i18n.language),
    groupType: (v: string) => labelFor('companyTypes', lookups, v, t(`enums.groupType.${v}`, { defaultValue: v }), i18n.language),
  };
}
