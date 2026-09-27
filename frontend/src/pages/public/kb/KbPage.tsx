import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, BookOpen, Search } from 'lucide-react';
import { useBranding } from '../../../components/branding-context';
import { getKbArticle, searchKb } from './kb-api';
import KbArticleView from './KbArticleView';

/** Public bilgi bankası: arama listesi (`/kb`) ve makale (`/kb/:id`). */
export default function KbPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { branding } = useBranding();
  const [searchParams] = useSearchParams();
  // Şirket: markalı portal alanından ya da bağlantıdaki `c` parametresinden (personelin
  // nota eklediği bağlantılar). Yalnızca o şirketin YAYINDAKİ makalelerini açar.
  const companyId = branding?.id ?? searchParams.get('c') ?? undefined;
  const suffix = companyId && !branding?.id ? `?c=${companyId}` : '';
  const [q, setQ] = useState('');

  const { data: results = [], isLoading } = useQuery({
    queryKey: ['public-kb', companyId, q, i18n.language],
    queryFn: () => searchKb({ q: q.trim() || undefined, companyId }),
    enabled: !id,
  });
  const { data: article, isError } = useQuery({
    queryKey: ['public-kb-article', id, companyId, i18n.language],
    queryFn: () => getKbArticle(id!, companyId),
    enabled: !!id,
  });

  if (id) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Link to={`/kb${suffix}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-primary-600"><ArrowLeft className="h-4 w-4" /> {t('kb.back')}</Link>
        <div className="card">
          {isError ? <p className="text-sm text-muted">{t('kb.notFound')}</p> : article ? <KbArticleView article={article} /> : null}
        </div>
        <div className="card text-sm">
          {t('kb.stillNeedHelp')} <Link to="/create" className="font-medium text-primary-600 hover:underline">{t('kb.createTicket')}</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="card space-y-3">
        <h1 className="flex items-center gap-2 text-2xl font-bold"><BookOpen className="h-6 w-6 text-primary-600" /> {t('kb.title')}</h1>
        <p className="text-sm text-muted">{t('kb.description')}</p>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input className="input-field pl-9" value={q} onChange={e => setQ(e.target.value)} placeholder={t('kb.searchPlaceholder')} aria-label={t('kb.searchPlaceholder')} />
        </div>
      </div>
      <div className="card divide-y divide-gray-100 !p-0 dark:divide-slate-800">
        {!isLoading && results.length === 0 && <p className="p-4 text-sm text-muted">{t('kb.empty')}</p>}
        {results.map(r => (
          <Link key={r.id} to={`/kb/${r.id}${suffix}`} className="block p-4 hover:bg-gray-50 dark:hover:bg-slate-800/50">
            <p className="font-medium">{r.title}</p>
            <p className="mt-1 text-sm text-muted">{r.excerpt}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
