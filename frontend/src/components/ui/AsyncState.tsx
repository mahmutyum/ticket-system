import type { LucideIcon } from 'lucide-react';
import { Inbox } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  const { t } = useTranslation();
  return (
    <div className="animate-pulse divide-y divide-gray-100 dark:divide-slate-800" aria-label={t('common.loading')}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-4 px-5 py-4">
          <div className="h-9 w-9 rounded-xl surface-2" />
          <div className="flex-1 space-y-2"><div className="h-3 w-2/3 rounded surface-2" /><div className="h-2.5 w-1/3 rounded surface-2" /></div>
          <div className="h-6 w-20 rounded-full surface-2" />
        </div>
      ))}
    </div>
  );
}

type EmptyStateProps = { title: string; description?: string; icon?: LucideIcon };

export function EmptyState({ title, description, icon: Icon = Inbox }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <span className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-50 text-primary-600 dark:bg-primary-500/10 dark:text-primary-300"><Icon className="h-6 w-6" /></span>
      <h3 className="font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
    </div>
  );
}
