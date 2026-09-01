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
        <div className="w-12 h-12 rounded-2xl bg-[#0084FF]/10 text-[#0084FF] flex items-center justify-center animate-pulse">
          <Bot className="w-6 h-6" />
        </div>
        <div className="flex items-center gap-2 text-xs font-bold text-black/50">
          <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#0084FF]" />
          <span>Restoring session...</span>
        </div>
      </div>
    );
  }

  // If user is not authenticated, redirect to /dashboard preserving origin
  if (!user) {
    return <Navigate to="/dashboard" state={{ from: location }} replace />;
  }

  // If route is restricted to admins and current user is not admin
  if (adminOnly && user.role !== 'admin') {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
