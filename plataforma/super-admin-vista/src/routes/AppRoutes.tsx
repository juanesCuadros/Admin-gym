import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ProtectedRoute } from './ProtectedRoute';
import { AppLayout } from '@/components/layout/AppLayout';

// Pages
import { LoginPage } from '@/pages/auth/LoginPage';
import { RecoveryPage } from '@/pages/auth/RecoveryPage';
import { ResetPasswordPage } from '@/pages/auth/ResetPasswordPage';
import { DashboardPage } from '@/pages/dashboard/DashboardPage';
import { GymListPage } from '@/pages/gyms/GymListPage';
import { GymCreateWizardPage } from '@/pages/gyms/GymCreateWizardPage';
import { GymDetailPage } from '@/pages/gyms/GymDetailPage';
import { ExercisesPage } from '@/pages/exercises/ExercisesPage';
import { AuditPage } from '@/pages/audit/AuditPage';
import { NotFoundPage } from '@/pages/not-found/NotFoundPage';

export const AppRoutes: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public Authentication Routes */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/recovery" element={<RecoveryPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />

        {/* Protected Super Admin Routes */}
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/gyms" element={<GymListPage />} />
            <Route path="/gyms/new" element={<GymCreateWizardPage />} />
            <Route path="/gyms/:id" element={<GymDetailPage />} />
            <Route path="/exercises" element={<ExercisesPage />} />
            <Route path="/audit" element={<AuditPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
};
