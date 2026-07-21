import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Ticket,
  LogOut,
  Menu,
  X,
  Building2,
  Users,
  MapPinned,
  BarChart3,
  FileText,
  ClipboardList,
  Moon,
  Sun,
  KeyRound,
  ShieldCheck,
  ShieldAlert,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../stores/auth.store';
import { useTheme } from '../theme-context';
import { LanguageSwitcher } from '../LanguageSwitcher';
import api from '../../api/client';
import type { LucideIcon } from 'lucide-react';

type NavItem = { path: string; labelKey: string; icon: LucideIcon; roles?: string[] };

const navItems: NavItem[] = [
  { path: '/staff', labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { path: '/staff/tickets', labelKey: 'nav.tickets', icon: Ticket },
  { path: '/staff/tasks', labelKey: 'nav.tasks', icon: ClipboardList },
  { path: '/staff/onsite', labelKey: 'nav.onsite', icon: MapPinned },
  { path: '/staff/companies', labelKey: 'nav.companies', icon: Building2 },
  { path: '/staff/staff-management', labelKey: 'nav.staff', icon: Users },
  { path: '/staff/reports', labelKey: 'nav.reports', icon: BarChart3 },
  { path: '/staff/templates', labelKey: 'nav.templates', icon: FileText },
  { path: '/staff/passwords', labelKey: 'nav.passwords', icon: KeyRound, roles: ['admin', 'it_manager'] },
  { path: '/staff/account', labelKey: 'nav.account', icon: ShieldCheck },
];

export default function StaffLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const { user, logout, mfaWarningEnabled } = useAuthStore();
  const { theme, toggle } = useTheme();

  // Personel arayüz dilini değiştirdiğinde bildirim dilini (staff.locale) senkronla:
  // böylece e-posta/SMS bildirimleri panelde kullanılan dilde gider. Yalnızca
  // gerçekten farklıysa istek atılır.
  useEffect(() => {
    const uiLang = i18n.language?.startsWith('tr') ? 'tr' : 'en';
    if (user && user.locale && user.locale !== uiLang) {
      api.patch('/auth/staff/preferences', { locale: uiLang })
        .then(() => useAuthStore.getState().setUser({ ...user, locale: uiLang }))
        .catch(() => { /* sessizce geç — bir sonraki değişimde tekrar denenir */ });
    }
  }, [i18n.language, user]);
  // Ayrıcalıklı hesap (kasa erişimi) MFA kurmamışsa uyar — zorunluluk değil.
  const showMfaWarning =
    mfaWarningEnabled &&
    !!user &&
    (user.role === 'admin' || user.role === 'it_manager') &&
    user.mfaEnabled === false &&
    location.pathname !== '/staff/account';
  const currentItem = navItems
    .filter((item) => !item.roles || (user && item.roles.includes(user.role)))
    .find((item) => location.pathname === item.path || (item.path !== '/staff' && location.pathname.startsWith(item.path)));

  const handleLogout = async () => {
    try {
      await api.post('/auth/staff/logout');
    } catch {
      // ignore
    }
    logout();
    navigate('/staff/login');
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 flex">
      {/* Sidebar */}
      {/*
        Mobil: fixed inset-y-0 ile viewport'a sabit off-canvas çekmece.
        Desktop: lg:sticky + lg:h-screen ile ekran yüksekliğinde sabit kolon.

        Daha önce burada lg:relative vardı ve `fixed`i eziyordu: aside normal
        akışa dönüyor, flex stretch ile içeriğin TAMAMI boyunca uzuyordu
        (uzun sayfada binlerce piksel). inset-y-0 ise relative üzerinde etkisiz
        olduğu için yükseklik kısıtı hiç kalmıyordu — menü yukarıda kalıp sayfayla
        birlikte kayıyor, absolute bottom-0 olan alt blok ekranın çok altına düşüyordu.

        flex flex-col + nav'da flex-1 overflow-y-auto: menü uzunsa kendi içinde
        kayar, alt blok mt-auto ile her iki kırılımda da dipte kalır.
      */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-64 flex flex-col bg-slate-900 text-white transform transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 border-r border-slate-800 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="shrink-0 p-6 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center justify-center w-9 h-9 rounded-inset bg-primary-600 shadow-glow">
              <LayoutDashboard className="w-4 h-4" />
            </span>
            <div>
              <h1 className="text-base font-semibold leading-tight">{t('layout.appName')}</h1>
              <p className="text-xs text-slate-400">{t('layout.staffPanel')}</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto mt-4 px-3 space-y-1">
          {navItems.filter((item) => !item.roles || (user && item.roles.includes(user.role))).map((item) => {
            const isActive = location.pathname === item.path ||
              (item.path !== '/staff' && location.pathname.startsWith(item.path));
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-control text-sm transition-[color,background-color,box-shadow] ${
                  isActive
                    ? 'bg-primary-600 text-white shadow-glow'
                    : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                }`}
              >
                <item.icon className="w-5 h-5" />
                {t(item.labelKey)}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto shrink-0 p-4 border-t border-slate-800">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 bg-primary-600 rounded-full flex items-center justify-center text-sm font-bold ring-2 ring-primary-500/30">
              {user?.fullName?.charAt(0) || 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user?.fullName}</p>
              <p className="text-xs text-slate-400 truncate">{user?.email}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors w-full"
          >
            <LogOut className="w-4 h-4" />
            {t('layout.logout')}
          </button>
        </div>
      </aside>

      {/* Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="app-bar sticky top-0 z-10 px-4 py-3 flex items-center gap-4 lg:px-6">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="icon-button border-0 lg:hidden"
            aria-label={sidebarOpen ? t('layout.closeMenu') : t('layout.openMenu')}
          >
            {sidebarOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{currentItem ? t(currentItem.labelKey) : t('layout.staffPanel')}</p>
            <p className="hidden text-xs text-muted sm:block">{t('layout.appName')} / {currentItem ? t(currentItem.labelKey) : t('layout.general')}</p>
          </div>
          <LanguageSwitcher />
          <button
            onClick={toggle}
            aria-label={t('layout.toggleTheme')}
            className="icon-button"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <span className="text-sm text-muted hidden sm:inline">
            {user?.role === 'admin' ? t('layout.roleAdmin') : user?.role === 'it_manager' ? t('layout.roleManager') : t('layout.roleStaff')}
          </span>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto p-4 sm:p-5 lg:p-8">
          <div className="mx-auto w-full max-w-[1600px] space-y-4">
            {showMfaWarning && (
              <div className="flex items-start gap-3 rounded-inset border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
                <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
                <div className="flex-1">
                  <p className="font-semibold">{t('layout.mfaWarningTitle')}</p>
                  <p className="text-amber-800/90 dark:text-amber-200/80">
                    {t('layout.mfaWarningBody')}
                  </p>
                </div>
                <Link
                  to="/staff/account"
                  className="shrink-0 rounded-control bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
                >
                  {t('layout.mfaSetupNow')}
                </Link>
              </div>
            )}
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
