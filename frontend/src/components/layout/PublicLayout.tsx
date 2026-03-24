import { Outlet, Link } from 'react-router-dom';
import { Headset } from 'lucide-react';

export default function PublicLayout() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-blue-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3 text-primary-700 hover:text-primary-800">
            <Headset className="w-8 h-8" />
            <div>
              <h1 className="text-xl font-bold leading-tight">IT Destek Sistemi</h1>
              <p className="text-xs text-gray-500">Teknik Destek Talep Merkezi</p>
            </div>
          </Link>
          <nav className="flex gap-4 text-sm">
            <Link to="/create" className="btn-primary text-sm">
              Yeni Talep
            </Link>
            <Link to="/track" className="btn-secondary text-sm">
              Talep Takip
            </Link>
          </nav>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-5xl mx-auto px-4 py-8">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="text-center py-6 text-sm text-gray-400">
        IT Destek Sistemi &copy; {new Date().getFullYear()}
      </footer>
    </div>
  );
}
