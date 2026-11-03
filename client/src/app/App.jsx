// M1 — router root. Shared file: small PRs only, reviewed by M1.
// Each feature owner swaps their placeholder below for their real page(s).
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider, RequireRole } from './auth.jsx';
import Layout from './Layout.jsx';
import {
  HomePlaceholder,
  VoterPlaceholder,
  AdminPlaceholder,
  ObserverPlaceholder,
  NotFound,
} from './placeholders.jsx';
import VoterLoginPage from '../features/auth/VoterLoginPage.jsx';
import AdminLoginPage from '../features/auth/AdminLoginPage.jsx';

export const routerFuture = { v7_startTransition: true, v7_relativeSplatPath: true };

export default function App() {
  return (
    <BrowserRouter future={routerFuture}>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        {/* Public — M3 replaces the home page */}
        <Route index element={<HomePlaceholder />} />

        {/* M1 — auth */}
        <Route path="login" element={<VoterLoginPage />} />
        <Route path="admin/login" element={<AdminLoginPage />} />

        {/* M4 — voting (voters and candidates) */}
        <Route
          path="voter/*"
          element={
            <RequireRole roles={['voter']}>
              <VoterPlaceholder />
            </RequireRole>
          }
        />

        {/* M2 — Election Commission */}
        <Route
          path="admin/*"
          element={
            <RequireRole roles={['ec']}>
              <AdminPlaceholder />
            </RequireRole>
          }
        />

        {/* M3 — Observer */}
        <Route
          path="observer/*"
          element={
            <RequireRole roles={['observer']}>
              <ObserverPlaceholder />
            </RequireRole>
          }
        />

        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
