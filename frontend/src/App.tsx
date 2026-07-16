import { Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense, useEffect, useState } from 'react';
import PublicLayout from './components/layout/PublicLayout';
import StaffLayout from './components/layout/StaffLayout';
import { useAuthStore } from './stores/auth.store';
import { initializeAuth } from './api/client';
import { ThemeProvider } from './components/ThemeProvider';
import { BrandingProvider } from './components/BrandingProvider';

const HomePage = lazy(() => import('./pages/public/HomePage'));
const CreateTicketPage = lazy(() => import('./pages/public/CreateTicketPage'));
const TrackTicketPage = lazy(() => import('./pages/public/TrackTicketPage'));
const TicketStatusPage = lazy(() => import('./pages/public/TicketStatusPage'));
const LoginPage = lazy(() => import('./pages/staff/LoginPage'));
const DashboardPage = lazy(() => import('./pages/staff/DashboardPage'));
const TicketListPage = lazy(() => import('./pages/staff/TicketListPage'));
const TicketDetailPage = lazy(() => import('./pages/staff/TicketDetailPage'));
const StaffManagementPage = lazy(() => import('./pages/staff/StaffManagementPage'));
const CompanyManagementPage = lazy(() => import('./pages/staff/CompanyManagementPage'));
const OnsiteSupportPage = lazy(() => import('./pages/staff/OnsiteSupportPage'));
const ReportsPage = lazy(() => import('./pages/staff/ReportsPage'));
const TemplatesPage = lazy(() => import('./pages/staff/TemplatesPage'));
const TasksPage = lazy(() => import('./pages/staff/TasksPage'));
const TaskDetailPage = lazy(() => import('./pages/staff/TaskDetailPage'));
const PasswordsPage = lazy(() => import('./pages/staff/PasswordsPage'));
const AccountPage = lazy(() => import('./pages/staff/AccountPage'));

function PageLoader() {
  return <div className="min-h-48 flex items-center justify-center text-sm text-muted">Sayfa yükleniyor…</div>;
}

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
          <Suspense fallback={<PageLoader />}><Routes>
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
          <Route path="account" element={<AccountPage />} />
          <Route
            path="passwords"
            element={
              <ProtectedRoute allowedRoles={['admin', 'it_manager']}>
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
          </Routes></Suspense>
        </AuthLoader>
      </BrandingProvider>
    </ThemeProvider>
  );
}
