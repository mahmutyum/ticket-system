import { Outlet, Link } from 'react-router-dom';
import { Headset, Moon, Sun, Plus, Search } from 'lucide-react';
import { useBranding } from '../branding-context';
import { useTheme } from '../theme-context';

export default function PublicLayout() {
  const { branding } = useBranding();
  const { theme, toggle } = useTheme();

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
              <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-primary-600 text-white shadow-glow">
                <Headset className="w-5 h-5" />
              </span>
            )}
            <div className="leading-tight">
              <h1 className="text-base font-semibold text-gray-900 dark:text-slate-100">
                {branding?.name || 'IT Destek Sistemi'}
              </h1>
              <p className="text-xs text-muted">Teknik Destek Talep Merkezi</p>
            </div>
          </Link>
          <nav className="flex items-center gap-2 text-sm" aria-label="Ana navigasyon">
            <Link to="/create" className="btn-primary flex items-center gap-2 text-sm"><Plus className="h-4 w-4" /><span className="hidden sm:inline">Yeni Talep</span></Link>
            <Link to="/track" className="btn-secondary flex items-center gap-2 text-sm"><Search className="h-4 w-4" /><span className="hidden sm:inline">Talep Takip</span></Link>
            <button
              onClick={toggle}
              aria-label="Tema değiştir"
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
          <span>{branding?.name || 'IT Destek Sistemi'} &copy; {new Date().getFullYear()}</span>
          <span>Teknik destek talepleriniz için güvenli takip merkezi</span>
        </div>
      </footer>
    </div>
  );
}
