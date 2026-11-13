import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type ModalProps = {
  open: boolean;
  onClose: () => void;
  /** Ekran okuyucu için iletişim kutusu adı (zorunlu). */
  ariaLabel: string;
  /** Verilirse üstte başlık + kapatma düğmesi satırı çizilir; verilmezse
   * tüketici kendi başlığını (ör. zengin SLA başlığı) children içine koyar. */
  title?: string;
  /** Tailwind genişlik sınıfı — örn. 'max-w-md' (varsayılan), 'max-w-4xl'. */
  size?: string;
  /** Panel için ek sınıflar (max-h, overflow, space-y, padding düzeltmeleri). */
  panelClassName?: string;
  /**
   * Arka plana tıklayınca kapansın mı? Varsayılan açık; form modallarında
   * yanlışlıkla kayıp olmasın diye `false` verilir (Tasks/Templates/Staff/
   * CompanyManagement eskiden de kapatmıyordu).
   */
  closeOnBackdrop?: boolean;
  /** Panelin yüzey sınıfı — 'card' (varsayılan) veya 'dialog-surface'. */
  surface?: 'card' | 'dialog-surface';
  children: ReactNode;
};

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Varsayılan panel: kısa içerikli diyaloglar için makul boyut + kaydırma. */
const DEFAULT_PANEL = 'max-w-md max-h-[90vh] overflow-y-auto';

/**
 * Tek modal uygulaması — eskiden 11 dosyada kopyalanmış 15 overlay vardı:
 * hepsi Escape/focus-trap'sizdi, yalnızca biri Escape dinliyor, 8'inde
 * role="dialog" yoktu. Bu bileşen hepsini tek yerde toplar:
 *
 * - `role="dialog"` + `aria-modal` + etiket (ekran okuyucu),
 * - Escape ile kapatma,
 * - Tab odak tuzağı (odak iletişim kutusundan kaçamaz),
 * - açılışta odak kutuya girer (autoFocus'lu input korunur), kapanışta
 *   tetikleyen öğeye geri döner,
 * - açıkken sayfa kaydırma kilidi.
 */
export function Modal({ open, onClose, ariaLabel, title, size = 'max-w-md', panelClassName, closeOnBackdrop = true, surface = 'card', children }: ModalProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    // Açılış anında odağı hatırla ve kutuya al; kapanışta geri ver.
    restoreFocusRef.current = (document.activeElement as HTMLElement | null) ?? null;
    const panel = panelRef.current;
    // autoFocus'lu bir input zaten odak almışsa onu ezme.
    if (panel && !panel.contains(document.activeElement)) {
      panel.focus();
    }
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKeyDown);
      restoreFocusRef.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const trapTab = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
      // checkVisibility: gizli (display:none) öğeleri atlar. jsdom'da
      // uygulanmadığı için orada yalnızca `hidden` özniteliğine bakılır.
      .filter((el) => (el.checkVisibility ? el.checkVisibility() : !el.hasAttribute('hidden')));
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={closeOnBackdrop ? onClose : undefined}
      data-testid="modal-overlay"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        onKeyDown={trapTab}
        onClick={(event) => event.stopPropagation()}
        className={`${surface} w-full outline-none ${size} ${panelClassName ?? DEFAULT_PANEL}`}
      >
        {title !== undefined && (
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="font-semibold">{title}</h3>
            <button type="button" className="icon-button" aria-label={t('common.close')} onClick={onClose}>
              <X className="h-5 w-5" />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
