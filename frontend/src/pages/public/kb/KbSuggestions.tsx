import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Lightbulb } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/ui/Modal';
import { getKbArticle, searchKb, type KbArticle } from './kb-api';
import KbArticleView from './KbArticleView';

/**
 * Talep sihirbazında seçilen kategoriye ait yayındaki makaleler. Kullanıcı "sorunum
 * çözüldü" derse talep açılmadan çıkılır ve makalenin `deflections` sayacı artar.
 */
export default function KbSuggestions({ companyId, categoryId }: { companyId: string; categoryId: string }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState<KbArticle | null>(null);
  const { data: suggestions = [] } = useQuery({
    queryKey: ['kb-suggest', companyId, categoryId, i18n.language],
    queryFn: () => searchKb({ companyId, categoryId }),
  });
  if (suggestions.length === 0) return null;

  return (
    <div className="rounded-inset border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-500/30 dark:bg-amber-500/10">
      <p className="flex items-center gap-2 font-semibold"><Lightbulb className="h-4 w-4 text-amber-600" /> {t('kb.suggestTitle')}</p>
      <p className="mt-1 text-xs text-muted">{t('kb.suggestHint')}</p>
      <ul className="mt-3 space-y-2">
        {suggestions.map(s => (
          <li key={s.id}>
            <button type="button" className="w-full rounded-control bg-white p-2 text-left hover:shadow-surface dark:bg-slate-900"
              onClick={() => void getKbArticle(s.id, companyId).then(setOpen).catch(() => undefined)}>
              <span className="font-medium">{s.title}</span>
              <span className="block text-xs text-muted">{s.excerpt}</span>
            </button>
          </li>
        ))}
      </ul>
      {open && (
        <Modal open onClose={() => setOpen(null)} ariaLabel={open.title} size="max-w-2xl" panelClassName="max-h-[88vh] overflow-y-auto">
          <KbArticleView
            article={open}
            solvedLabel={t('kb.solvedButton')}
            onSolved={() => { toast.success(t('kb.solvedToast')); navigate('/'); }}
            onNotSolved={() => setOpen(null)}
          />
        </Modal>
      )}
    </div>
  );
}
