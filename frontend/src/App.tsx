import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import PublicLayout from './components/layout/PublicLayout';
import StaffLayout from './components/layout/StaffLayout';
import HomePage from './pages/public/HomePage';
import CreateTicketPage from './pages/public/CreateTicketPage';
import TrackTicketPage from './pages/public/TrackTicketPage';
import TicketStatusPage from './pages/public/TicketStatusPage';
import LoginPage from './pages/staff/LoginPage';
import DashboardPage from './pages/staff/DashboardPage';
import TicketListPage from './pages/staff/TicketListPage';
import TicketDetailPage from './pages/staff/TicketDetailPage';
import StaffManagementPage from './pages/staff/StaffManagementPage';
import CompanyManagementPage from './pages/staff/CompanyManagementPage';
import OnsiteSupportPage from './pages/staff/OnsiteSupportPage';
import ReportsPage from './pages/staff/ReportsPage';
import TemplatesPage from './pages/staff/TemplatesPage';
import TasksPage from './pages/staff/TasksPage';
import TaskDetailPage from './pages/staff/TaskDetailPage';
import PasswordsPage from './pages/staff/PasswordsPage';
import { useAuthStore } from './stores/auth.store';
import { initializeAuth } from './api/client';
import { ThemeProvider } from './components/ThemeProvider';
import { BrandingProvider } from './components/BrandingProvider';

function ProtectedRoute({ children, allowedRoles }: { 
  children: React.ReactNode; 
  allowedRoles?: string[] 
}) {
  const { isAuthenticated, user } = useAuthStore();
  if (!isAuthenticated) return <Navigate to="/staff/login" replace />;
  if (allowedRoles && user && !allowedRoles.includes(user.role)) {
    return <Navigate to="/staff" replace />;
  }
  return <>{children}</>;
}

function AuthLoader({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const isHydrated = useAuthStore((s) => s.isHydrated);

  useEffect(() => {
    if (isHydrated) {
      setLoading(false);
      return;
    }
    initializeAuth().finally(() => setLoading(false));
  }, [isHydrated]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
          <p className="mt-2 text-sm text-gray-500">Yükleniyor...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <ThemeProvider>
      <BrandingProvider>
        <AuthLoader>
          <Routes>
        {/* Public routes */}
        <Route element={<PublicLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/create" element={<CreateTicketPage />} />
          <Route path="/track" element={<TrackTicketPage />} />
          <Route path="/ticket/:accessToken" element={<TicketStatusPage />} />
        </Route>

        {/* Staff routes */}
        <Route path="/staff/login" element={<LoginPage />} />
        <Route
          path="/staff"
          element={
            <ProtectedRoute>
              <StaffLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="tickets" element={<TicketListPage />} />
          <Route path="tickets/:id" element={<TicketDetailPage />} />
          <Route
            path="companies"
            element={
              <ProtectedRoute allowedRoles={['admin', 'it_manager']}>
                <CompanyManagementPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="staff-management"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <StaffManagementPage />
              </ProtectedRoute>
            }
          />
          <Route path="onsite" element={<OnsiteSupportPage />} />
          <Route path="tasks" element={<TasksPage />} />
          <Route path="tasks/:id" element={<TaskDetailPage />} />
          <Route
            path="passwords"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <PasswordsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="reports"
            element={
              <ProtectedRoute allowedRoles={['admin', 'it_manager']}>
                <ReportsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="templates"
            element={
              <ProtectedRoute allowedRoles={['admin', 'it_manager']}>
                <TemplatesPage />
              </ProtectedRoute>
            }
          />
        </Route>

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthLoader>
      </BrandingProvider>
    </ThemeProvider>
  );
}
