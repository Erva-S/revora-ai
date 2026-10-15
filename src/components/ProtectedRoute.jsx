import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Bot, RefreshCw } from 'lucide-react';

export default function ProtectedRoute({ children, adminOnly = false }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  // Wait until authentication status has completely loaded
  if (loading) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-4 font-sans">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center animate-pulse">
          <img src="/revora-icon.png" alt="Revora" className="w-12 h-12 object-contain" />
        </div>
        <div className="flex items-center gap-2 text-xs font-bold text-black/50">
          <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#0084FF]" />
          <span>Restoring session...</span>
        </div>
      </div>
    );
  }

  // Not signed in: send them to the existing login route, remembering where they
  // were headed so the app can return them there after authentication.
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Signed in but not an admin: keep them inside the user portal rather than
  // bouncing them out of the application. This is only a navigation guard —
  // the deploy-bot Edge Function and RLS enforce the real authorization.
  if (adminOnly && user.role !== 'admin') {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
