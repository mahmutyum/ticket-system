import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import Markdown from '../../../components/Markdown';
import { sendKbFeedback, type KbArticle } from './kb-api';

/** Makale gövdesi + "Bu yardımcı oldu mu?" — hem KB sayfasında hem talep sihirbazında. */
export default function KbArticleView({ article, onSolved, onNotSolved, solvedLabel }: {
  article: KbArticle;
  /** Verilirse "Evet" talep açmadan çıkış sayılır (sihirbaz). */
  onSolved?: () => void;
  onNotSolved?: () => void;
  solvedLabel?: string;
}) {
  const { t } = useTranslation();
  const [voted, setVoted] = useState<boolean | null>(null);

  const vote = async (helpful: boolean) => {
    setVoted(helpful);
    try {
      await sendKbFeedback(article.id, helpful, helpful && !!onSolved);
    } catch {
      /* geri bildirim kaybı kullanıcıyı engellememeli */
    }
    if (helpful) onSolved?.();
    else onNotSolved?.();
  };

  return (
    <article className="space-y-4">
      <h2 className="text-xl font-semibold">{article.title}</h2>
      <Markdown>{article.body}</Markdown>
      <div className="flex flex-wrap items-center gap-2 border-t border-subtle pt-4 text-sm">
        {voted === null ? (
          <>
            <span className="text-muted">{t('kb.helpfulQuestion')}</span>
            <button type="button" className="btn-secondary flex items-center gap-1" onClick={() => void vote(true)}>
              <ThumbsUp className="h-4 w-4" /> {solvedLabel ?? t('kb.yes')}
            </button>
            <button type="button" className="btn-secondary flex items-center gap-1" onClick={() => void vote(false)}>
              <ThumbsDown className="h-4 w-4" /> {t('kb.no')}
            </button>
          </>
        ) : (
          <span className="text-muted">{t('kb.thanks')}</span>
        )}
      </div>
    </article>
  );
}
