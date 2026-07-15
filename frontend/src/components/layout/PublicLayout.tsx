import { Outlet, Link } from 'react-router-dom';
import { Headset, Moon, Sun } from 'lucide-react';
import { useBranding } from '../BrandingProvider';
import { useTheme } from '../ThemeProvider';

export default function PublicLayout() {
  const { branding } = useBranding();
  const { theme, toggle } = useTheme();

  return (
    <div className="relative min-h-screen overflow-hidden gradient-surface">
      {/* Decorative background orbs */}
      <div className="orb bg-primary-300 dark:bg-primary-700" style={{ width: 480, height: 480, top: -120, left: -120 }} />
      <div className="orb bg-primary-200 dark:bg-primary-900" style={{ width: 360, height: 360, bottom: -80, right: -80 }} />

      {/* Header */}
      <header className="relative z-10 sticky top-0 glass border-b border-white/30 dark:border-slate-700/40">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
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
          <nav className="flex items-center gap-2 text-sm">
            <Link to="/create" className="btn-primary text-sm">Yeni Talep</Link>
            <Link to="/track" className="btn-secondary text-sm">Talep Takip</Link>
            <button
              onClick={toggle}
              aria-label="Tema değiştir"
              className="ml-1 p-2 rounded-lg border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-300 hover:bg-white/50 dark:hover:bg-slate-800/60 transition-colors"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </nav>
        </div>
      </header>

      {/* Content */}
      <main className="relative z-10 max-w-5xl mx-auto px-4 py-8">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="relative z-10 text-center py-6 text-sm text-muted">
        {branding?.name || 'IT Destek Sistemi'} &copy; {new Date().getFullYear()}
      </footer>
    </div>
  );
}
