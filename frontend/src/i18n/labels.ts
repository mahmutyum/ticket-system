import { useTranslation } from 'react-i18next';

/**
 * Enum (durum/öncelik/rol/…) etiketleri için çeviri yardımcısı.
 *
 * Sayfalar eskiden `types/index.ts`'teki sabit `STATUS_LABELS[x]` sözlüklerini
 * kullanıyordu; artık bunun yerine `const labels = useEnumLabels()` alıp
 * `labels.status(x)` çağırır. Böylece dil değiştiğinde etiketler de değişir.
 *
 * Renk sözlükleri (STATUS_COLORS vb.) dile bağlı değildir, `types/index.ts`'te
 * kalır.
 *
 * Bilinmeyen bir anahtar gelirse ham değer döner (defaultValue), böylece yeni bir
 * enum değeri çeviri eklenene kadar en azından okunur kalır.
 */
export function useEnumLabels() {
  const { t } = useTranslation();
  return {
    status: (v: string) => t(`enums.status.${v}`, { defaultValue: v }),
    priority: (v: string) => t(`enums.priority.${v}`, { defaultValue: v }),
    role: (v: string) => t(`enums.role.${v}`, { defaultValue: v }),
    groupType: (v: string) => t(`enums.groupType.${v}`, { defaultValue: v }),
    onsiteStatus: (v: string) => t(`enums.onsiteStatus.${v}`, { defaultValue: v }),
    taskStatus: (v: string) => t(`enums.taskStatus.${v}`, { defaultValue: v }),
  };
}
