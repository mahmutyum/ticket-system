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
} from 'lucide-react';
import { useState } from 'react';
import { useAuthStore } from '../../stores/auth.store';
import { useTheme } from '../ThemeProvider';
import api from '../../api/client';

const navItems = [
  { path: '/staff', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/staff/tickets', label: 'Talepler', icon: Ticket },
  { path: '/staff/tasks', label: 'Görevler', icon: ClipboardList },
  { path: '/staff/onsite', label: 'Yerinde Destek', icon: MapPinned },
  { path: '/staff/companies', label: 'Şirketler', icon: Building2 },
  { path: '/staff/staff-management', label: 'Personel', icon: Users },
  { path: '/staff/reports', label: 'Raporlar', icon: BarChart3 },
  { path: '/staff/templates', label: 'Şablonlar', icon: FileText },
  { path: '/staff/passwords', label: 'Şifreler', icon: KeyRound, roles: ['admin'] },
];

export default function StaffLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const { theme, toggle } = useTheme();

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
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-64 bg-slate-900 text-white transform transition-transform lg:relative lg:translate-x-0 border-r border-slate-800 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="p-6 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-primary-600 shadow-glow">
              <LayoutDashboard className="w-4 h-4" />
            </span>
            <div>
              <h1 className="text-base font-semibold leading-tight">IT Destek</h1>
              <p className="text-xs text-slate-400">Yönetim Paneli</p>
            </div>
          </div>
        </div>

        <nav className="mt-4 px-3 space-y-1">
          {navItems.filter((item) => !(item as any).roles || (item as any).roles.includes(user?.role)).map((item) => {
            const isActive = location.pathname === item.path ||
              (item.path !== '/staff' && location.pathname.startsWith(item.path));
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
                  isActive
                    ? 'bg-primary-600 text-white shadow-glow'
                    : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                }`}
              >
                <item.icon className="w-5 h-5" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-slate-800">
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
            Çıkış Yap
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
        <header className="sticky top-0 z-10 glass border-b border-subtle px-4 py-3 flex items-center gap-4 lg:px-6">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="lg:hidden text-gray-600 dark:text-slate-300"
          >
            {sidebarOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
          <div className="flex-1" />
          <button
            onClick={toggle}
            aria-label="Tema değiştir"
            className="p-2 rounded-lg border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <span className="text-sm text-muted hidden sm:inline">
            {user?.role === 'admin' ? 'Yönetici' : user?.role === 'it_manager' ? 'IT Yöneticisi' : 'IT Personeli'}
          </span>
        </header>

        {/* Page content */}
        <main className="flex-1 p-4 lg:p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
