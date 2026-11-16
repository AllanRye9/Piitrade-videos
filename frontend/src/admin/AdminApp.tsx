import { Navigate, Route, Routes } from 'react-router-dom';
import { AdminAuthProvider } from './AdminAuthContext';
import RequireAdmin, { RequirePermission } from './RequireAdmin';
import AdminLogin from './AdminLogin';
import AdminRegister from './AdminRegister';
import AdminLayout from './AdminLayout';
import { ToastProvider } from './ui';
import DashboardPage from './pages/DashboardPage';
import UsersPage from './pages/UsersPage';
import VideosPage from './pages/VideosPage';
import CommentsPage from './pages/CommentsPage';
import ReportsPage from './pages/ReportsPage';
import ProductsPage from './pages/ProductsPage';
import LocationsPage from './pages/LocationsPage';
import AdminsPage from './pages/AdminsPage';
import ActivityPage from './pages/ActivityPage';
import MyAccountPage from './pages/MyAccountPage';
import { ADMIN_BASE } from './paths';

/** Everything under /const/admin. Mounted once from main.tsx so the consumer app never loads admin auth. */
export default function AdminApp() {
  return (
    <AdminAuthProvider>
      <ToastProvider>
        <Routes>
          <Route path="login" element={<AdminLogin />} />
          <Route path="register" element={<AdminRegister />} />
          <Route
            element={
              <RequireAdmin>
                <AdminLayout />
              </RequireAdmin>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="users" element={<RequirePermission permission="users.view"><UsersPage /></RequirePermission>} />
            <Route path="videos" element={<RequirePermission permission="videos.view"><VideosPage /></RequirePermission>} />
            <Route path="comments" element={<RequirePermission permission="comments.view"><CommentsPage /></RequirePermission>} />
            <Route path="reports" element={<RequirePermission permission="reports.view"><ReportsPage /></RequirePermission>} />
            <Route path="products" element={<RequirePermission permission="products.view"><ProductsPage /></RequirePermission>} />
            <Route path="locations" element={<RequirePermission permission="locations.view"><LocationsPage /></RequirePermission>} />
            <Route path="admins" element={<RequirePermission primaryOnly><AdminsPage /></RequirePermission>} />
            <Route path="activity" element={<RequirePermission primaryOnly><ActivityPage /></RequirePermission>} />
            <Route path="account" element={<MyAccountPage />} />
          </Route>
          <Route path="*" element={<Navigate to={ADMIN_BASE} replace />} />
        </Routes>
      </ToastProvider>
    </AdminAuthProvider>
  );
}
