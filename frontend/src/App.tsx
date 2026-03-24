import { Routes, Route, Navigate } from 'react-router-dom';
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
import { useAuthStore } from './stores/auth.store';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (!isAuthenticated) return <Navigate to="/staff/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
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
        <Route path="companies" element={<CompanyManagementPage />} />
        <Route path="staff-management" element={<StaffManagementPage />} />
        <Route path="onsite" element={<OnsiteSupportPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="templates" element={<TemplatesPage />} />
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
