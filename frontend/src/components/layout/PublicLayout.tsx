import { Outlet, Link } from 'react-router-dom';
import { Headset, Moon, Sun, Plus, Search, MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useBranding } from '../branding-context';
import { useTheme } from '../theme-context';
import { LanguageSwitcher } from '../LanguageSwitcher';

export default function PublicLayout() {
  const { branding } = useBranding();
  const { theme, toggle } = useTheme();
  const { t } = useTranslation();

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden gradient-surface">
      {/* Decorative background orbs */}
      <div className="orb bg-primary-300 dark:bg-primary-700" style={{ width: 480, height: 480, top: -120, left: -120 }} />
      <div className="orb bg-primary-200 dark:bg-primary-900" style={{ width: 360, height: 360, bottom: -80, right: -80 }} />

      {/* Header */}
      <header className="relative z-10 sticky top-0 glass border-b border-white/30 dark:border-slate-700/40">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <Link to="/" className="flex items-center gap-3">
            {branding?.logo ? (
              <img src={branding.logo} alt={branding.name} className="h-10 w-auto max-w-[160px] object-contain" />
            ) : (
              <span className="inline-flex items-center justify-center w-10 h-10 rounded-inset bg-primary-600 text-white shadow-glow">
                <Headset className="w-5 h-5" />
              </span>
            )}
            <div className="hidden leading-tight min-[420px]:block">
              <h1 className="text-base font-semibold text-gray-900 dark:text-slate-100">
                {branding?.name || t('publicLayout.appName')}
              </h1>
              <p className="text-xs text-muted">{t('publicLayout.tagline')}</p>
            </div>
          </Link>
          <nav className="flex items-center gap-2 text-sm" aria-label={t('publicLayout.mainNav')}>
            <Link to="/create" className="btn-primary hidden items-center gap-2 text-sm sm:inline-flex"><Plus className="h-4 w-4" />{t('publicLayout.newTicket')}</Link>
            <Link to="/track" className="btn-secondary hidden items-center gap-2 text-sm sm:inline-flex"><Search className="h-4 w-4" />{t('publicLayout.trackTicket')}</Link>
            <details className="group relative sm:hidden">
              <summary className="icon-button list-none cursor-pointer" aria-label={t('publicLayout.mainNav')}>
                <MoreHorizontal className="h-4 w-4" />
              </summary>
              <div className="absolute right-0 top-12 z-20 grid min-w-48 gap-1 rounded-inset border border-subtle bg-white p-1.5 shadow-overlay dark:bg-slate-900">
                <Link to="/create" className="flex min-h-10 items-center gap-2 rounded-control px-3 text-sm font-medium hover:bg-gray-50 dark:hover:bg-slate-800"><Plus className="h-4 w-4 text-primary-600" />{t('publicLayout.newTicket')}</Link>
                <Link to="/track" className="flex min-h-10 items-center gap-2 rounded-control px-3 text-sm font-medium hover:bg-gray-50 dark:hover:bg-slate-800"><Search className="h-4 w-4 text-primary-600" />{t('publicLayout.trackTicket')}</Link>
              </div>
            </details>
            <LanguageSwitcher compact />
            <button
              onClick={toggle}
              aria-label={t('layout.toggleTheme')}
              className="icon-button ml-1"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </nav>
        </div>
      </header>

      {/* Content */}
      <main className="relative z-10 mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/30 py-6 text-sm text-muted dark:border-slate-700/40">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 sm:flex-row sm:px-6">
          <span>{branding?.name || t('publicLayout.appName')} &copy; {new Date().getFullYear()}</span>
          <span>{t('publicLayout.footerTagline')}</span>
        </div>
      </footer>
    </div>
  );
}
