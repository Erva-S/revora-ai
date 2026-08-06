import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ShieldCheck, Mail, Lock, LogIn, ArrowRight, UserCheck, Key, RefreshCw, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function LoginModal({ isOpen, onClose, onSuccessRedirect }) {
  const { loginAdmin, loginGoogle, loginDemoUser, error, setError } = useAuth();
  const [activeTab, setActiveTab] = useState('user'); // 'user' | 'admin'
  const [adminEmail, setAdminEmail] = useState('admin@revora.ai');
  const [adminPassword, setAdminPassword] = useState('Admin@123');
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleAdminSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const result = await loginAdmin(adminEmail, adminPassword);
    setSubmitting(false);

    if (result.success) {
      onClose();
      if (onSuccessRedirect) onSuccessRedirect(result.user);
    }
  };

  const handleDemoUserClick = async () => {
    setSubmitting(true);
    const result = await loginDemoUser();
    setSubmitting(false);
    if (result?.success) {
      onClose();
      if (onSuccessRedirect) onSuccessRedirect(result.user);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-hidden">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-black/50 backdrop-blur-md"
        />

        {/* Modal Container */}
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 220 }}
          className="relative w-full max-w-[480px] bg-white/95 backdrop-blur-[35px] border border-white/80 rounded-[28px] shadow-2xl flex flex-col z-10 overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-black/5 bg-white/60">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#0084FF] to-[#0066CC] flex items-center justify-center text-white shadow-xs">
                <LogIn className="w-4 h-4" />
              </div>
              <h3 className="font-outfit font-bold text-[18px] text-black">
                Revora Authentication
              </h3>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-black/5 hover:bg-black/10 flex items-center justify-center text-black/60 hover:text-black transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Role Tab Selector */}
          <div className="px-6 pt-5 pb-2">
            <div className="p-1 bg-neutral-100 rounded-2xl flex items-center gap-1 border border-black/5">
              <button
                onClick={() => { setActiveTab('user'); setError(null); }}
                className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2 ${
                  activeTab === 'user'
                    ? 'bg-white text-black shadow-xs'
                    : 'text-black/60 hover:text-black'
                }`}
              >
                <UserCheck className="w-3.5 h-3.5" />
                <span>Standard User Login</span>
              </button>
              <button
                onClick={() => { setActiveTab('admin'); setError(null); }}
                className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2 ${
                  activeTab === 'admin'
                    ? 'bg-[#0084FF] text-white shadow-xs'
                    : 'text-black/60 hover:text-black'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Admin Login</span>
              </button>
            </div>
          </div>

          {/* Form Content */}
          <div className="p-6 font-sans">
            {error && (
              <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-xs font-medium flex items-center justify-between">
                <span>{error}</span>
                <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* TAB 1: STANDARD USER LOGIN (Google OAuth) */}
            {activeTab === 'user' && (
              <div className="space-y-5">
                <div className="text-center py-2">
                  <h4 className="font-outfit font-bold text-lg text-black">Sign in to Revora</h4>
                  <p className="text-xs text-black/60 mt-1">
                    Authenticate securely via Supabase & Google OAuth2.0
                  </p>
                </div>

                {/* Google Sign In Button */}
                <button
                  onClick={loginGoogle}
                  className="w-full py-3.5 px-4 rounded-2xl bg-white border border-black/15 hover:border-black/30 hover:bg-neutral-50 text-black font-bold text-sm flex items-center justify-center gap-3 shadow-xs transition-all cursor-pointer group"
                >
                  <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                  </svg>
                  <span>Sign in with Google</span>
                  <ArrowRight className="w-4 h-4 text-black/40 group-hover:translate-x-0.5 transition-transform ml-auto" />
                </button>

                {/* Instant Local Demo Login shortcut */}
                <div className="pt-2 text-center">
                  <span className="text-[11px] text-black/40 font-mono block mb-2">— OR FOR QUICK LOCAL TESTING —</span>
                  <button
                    onClick={handleDemoUserClick}
                    disabled={submitting}
                    className="w-full py-2.5 px-4 rounded-xl bg-sky-50 hover:bg-sky-100 text-[#0084FF] border border-sky-100 font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition-colors"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Instant User Demo Login (alex.user@revora.ai)</span>
                  </button>
                </div>
              </div>
            )}

            {/* TAB 2: ADMIN LOGIN (Supabase Auth Strategy) */}
            {activeTab === 'admin' && (
              <form onSubmit={handleAdminSubmit} className="space-y-4">
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-800 font-medium">
                  <strong>Admin Credentials:</strong> Requires `role === 'admin'` database check.
                </div>

                <div>
                  <label className="block text-xs font-bold text-black mb-1">Admin Email</label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-black/40 absolute left-3.5 top-3.5" />
                    <input
                      type="email"
                      required
                      value={adminEmail}
                      onChange={(e) => setAdminEmail(e.target.value)}
                      placeholder="admin@revora.ai"
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-neutral-100 border border-black/10 text-xs focus:outline-none focus:border-[#0084FF] focus:bg-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-black mb-1">Password</label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-black/40 absolute left-3.5 top-3.5" />
                    <input
                      type="password"
                      required
                      value={adminPassword}
                      onChange={(e) => setAdminPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-neutral-100 border border-black/10 text-xs focus:outline-none focus:border-[#0084FF] focus:bg-white"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-3 px-4 rounded-xl bg-[#0084FF] hover:bg-[#0074E0] text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md transition-all cursor-pointer disabled:opacity-50 mt-2"
                >
                  {submitting ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Authenticating Admin...</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-4 h-4" />
                      <span>Authenticate as Admin</span>
                    </>
                  )}
                </button>
              </form>
            )}

          </div>

          {/* Footer */}
          <div className="px-6 py-3.5 bg-neutral-50 border-t border-black/5 flex items-center justify-between text-[11px] text-black/50 font-mono">
            <span>Supabase Auth & Database</span>
            <span>256-bit Encrypted</span>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
