// M1 — router root. Shared file: small PRs only, reviewed by M1.
// Each feature owner swaps their placeholder below for their real page(s).
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider, RequireRole } from './auth.jsx';
import Layout from './Layout.jsx';
import {
  VoterPlaceholder,
  ObserverPlaceholder,
  NotFound,
} from './placeholders.jsx';
import VoterLoginPage from '../features/auth/VoterLoginPage.jsx';
import AdminLoginPage from '../features/auth/AdminLoginPage.jsx';
import AdminDashboard from '../features/admin/AdminDashboard.jsx';
import HomePage from '../features/public/HomePage.jsx'; // M3
import CandidateListPage from '../features/candidates/CandidateListPage.jsx'; // M3
import CandidateProfilePage from '../features/candidates/CandidateProfilePage.jsx'; // M3
import { PanelsPage, PanelDetailPage } from '../features/candidates/PanelsPage.jsx'; // M3
import NominationPage from '../features/candidates/NominationPage.jsx'; // M3

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
        {/* Public — M3 */}
        <Route index element={<HomePage />} />
        <Route path="candidates" element={<CandidateListPage />} />
        <Route path="candidates/:id" element={<CandidateProfilePage />} />
        <Route path="panels" element={<PanelsPage />} />
        <Route path="panels/:id" element={<PanelDetailPage />} />

        {/* M3 — a voter's own nomination, status and panel */}
        <Route
          path="nomination"
          element={
            <RequireRole roles={['voter']}>
              <NominationPage />
            </RequireRole>
          }
        />

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
              <AdminDashboard />
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
