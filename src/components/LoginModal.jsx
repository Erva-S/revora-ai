import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  X, ShieldCheck, LogIn, ArrowRight, UserCheck, RefreshCw, 
  AlertCircle, Building2, Lock, Mail, Eye, EyeOff, Bot 
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function LoginModal({ isOpen, onClose, onSuccessRedirect }) {
  const { loginGoogle, loginPassword, error, setError } = useAuth();
  const [activeTab, setActiveTab] = useState('client'); // 'client' | 'user' | 'admin'
  const [authenticating, setAuthenticating] = useState(false);

  // Client form credentials
  const [clientEmail, setClientEmail] = useState('');
  const [clientPassword, setClientPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  if (!isOpen) return null;

  const handleOAuthSignIn = async (role) => {
    setAuthenticating(true);
    setError(null);
    try {
      await loginGoogle(role);
    } finally {
      setAuthenticating(false);
    }
  };

  const handleClientPasswordSubmit = async (e) => {
    e.preventDefault();
    if (!clientEmail.trim() || !clientPassword) {
      setError('Please enter both your client email and password.');
      return;
    }

    setAuthenticating(true);
    setError(null);
    try {
      const res = await loginPassword(clientEmail, clientPassword);
      if (res.success && res.user) {
        if (onSuccessRedirect) {
          onSuccessRedirect(res.user);
        } else {
          onClose();
        }
      }
    } finally {
      setAuthenticating(false);
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
          className="relative w-full max-w-[500px] bg-white/95 backdrop-blur-[35px] border border-white/80 rounded-[28px] shadow-2xl flex flex-col z-10 overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-black/5 bg-white/60">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#0084FF] to-[#0066CC] flex items-center justify-center text-white shadow-xs">
                <Bot className="w-4 h-4 text-white" />
              </div>
              <div>
                <h3 className="font-outfit font-bold text-[18px] text-black leading-tight">
                  Revora Meeting Assistant
                </h3>
                <p className="text-[11px] text-black/50">Secure multi-role account portal</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-black/5 hover:bg-black/10 flex items-center justify-center text-black/60 hover:text-black transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Role Tab Selector (Client, Standard User, Admin) */}
          <div className="px-6 pt-5 pb-2">
            <div className="p-1 bg-neutral-100 rounded-2xl flex items-center gap-1 border border-black/5">
              <button
                type="button"
                onClick={() => { setActiveTab('client'); setError(null); }}
                className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                  activeTab === 'client'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-black/60 hover:text-black'
                }`}
              >
                <Building2 className="w-3.5 h-3.5 text-[#0084FF]" />
                <span>Client Login</span>
              </button>

              <button
                type="button"
                onClick={() => { setActiveTab('user'); setError(null); }}
                className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                  activeTab === 'user'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-black/60 hover:text-black'
                }`}
              >
                <UserCheck className="w-3.5 h-3.5" />
                <span>Standard</span>
              </button>

              <button
                type="button"
                onClick={() => { setActiveTab('admin'); setError(null); }}
                className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                  activeTab === 'admin'
                    ? 'bg-[#0084FF] text-white shadow-xs'
                    : 'text-black/60 hover:text-black'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Admin</span>
              </button>
            </div>
          </div>

          {/* Form Content */}
          <div className="p-6 font-sans">
            {error && (
              <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-xs font-medium flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-500 mt-0.5" />
                <div className="flex-1">{error}</div>
                <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* TAB 1: CLIENT LOGIN (Email & Password) */}
            {activeTab === 'client' && (
              <div className="space-y-4">
                <div className="text-left pb-1">
                  <h4 className="font-outfit font-bold text-base text-black flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-[#0084FF]" />
                    Client Organization Portal
                  </h4>
                  <p className="text-xs text-black/60 mt-0.5">
                    Sign in with your organization credentials created by the administrator.
                  </p>
                </div>

                <form onSubmit={handleClientPasswordSubmit} className="space-y-3.5">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                      Client Email
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="email"
                        required
                        placeholder="e.g. erva@client.revora.ai"
                        value={clientEmail}
                        onChange={(e) => setClientEmail(e.target.value)}
                        className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:border-[#0084FF] focus:ring-2 focus:ring-[#0084FF]/10 text-xs font-medium text-slate-900 bg-white"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                      Password
                    </label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        placeholder="••••••••••••"
                        value={clientPassword}
                        onChange={(e) => setClientPassword(e.target.value)}
                        className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:border-[#0084FF] focus:ring-2 focus:ring-[#0084FF]/10 text-xs font-medium text-slate-900 bg-white"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={authenticating}
                    className="w-full mt-2 py-3 px-4 rounded-xl bg-slate-900 hover:bg-black text-white font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer disabled:opacity-50"
                  >
                    {authenticating ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin text-white" />
                        <span>Verifying Client Access...</span>
                      </>
                    ) : (
                      <>
                        <span>Sign In to Client Portal</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </>
                    )}
                  </button>
                </form>

                <div className="relative flex items-center justify-center my-3">
                  <div className="border-t border-slate-200 w-full" />
                  <span className="bg-white px-3 text-[10px] uppercase font-bold text-slate-400 shrink-0">
                    or authenticate with google
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => handleOAuthSignIn('user')}
                  disabled={authenticating}
                  className="w-full py-2.5 px-4 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-800 font-bold text-xs flex items-center justify-center gap-2.5 transition-all cursor-pointer group disabled:opacity-50"
                >
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                  </svg>
                  <span>Continue with Client Google Account</span>
                </button>
              </div>
            )}

            {/* TAB 2: STANDARD USER LOGIN */}
            {activeTab === 'user' && (
              <div className="space-y-5">
                <div className="text-center py-2">
                  <h4 className="font-outfit font-bold text-lg text-black">Sign in to Revora Meeting Assistant</h4>
                  <p className="text-xs text-black/60 mt-1">
                    Authenticate securely with your Google account
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => handleOAuthSignIn('user')}
                  disabled={authenticating}
                  className="w-full py-3.5 px-4 rounded-2xl bg-white border border-black/15 hover:border-black/30 hover:bg-neutral-50 text-black font-bold text-sm flex items-center justify-center gap-3 shadow-xs transition-all cursor-pointer group disabled:opacity-50"
                >
                  {authenticating ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin text-[#0084FF]" />
                      <span>Connecting to Google...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                      </svg>
                      <span>Sign in with Google</span>
                      <ArrowRight className="w-4 h-4 text-black/40 group-hover:translate-x-0.5 transition-transform ml-auto" />
                    </>
                  )}
                </button>
              </div>
            )}

            {/* TAB 3: ADMIN LOGIN */}
            {activeTab === 'admin' && (
              <div className="space-y-4">
                <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-1">
                  <div className="font-bold flex items-center gap-1.5 text-amber-800">
                    <ShieldCheck className="w-4 h-4 text-amber-700" />
                    <span>Administrator Authorization</span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-amber-800/90">
                    Restricted access. Sign in with your designated Google Admin account (<span className="font-mono font-bold">evv18407@gmail.com</span>). Administrative privileges are verified server-side.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => handleOAuthSignIn('admin')}
                  disabled={authenticating}
                  className="w-full py-3.5 px-4 rounded-2xl bg-[#0084FF] hover:bg-[#0074E0] text-white font-bold text-sm flex items-center justify-center gap-3 shadow-md transition-all cursor-pointer disabled:opacity-50"
                >
                  {authenticating ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Connecting to Google...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5 shrink-0 bg-white rounded-full p-0.5" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                      </svg>
                      <span>Sign in with Google as Admin</span>
                      <ArrowRight className="w-4 h-4 ml-auto" />
                    </>
                  )}
                </button>
              </div>
            )}

          </div>

          {/* Footer */}
          <div className="px-6 py-3.5 bg-neutral-50 border-t border-black/5 flex items-center justify-between text-[11px] text-black/50 font-mono">
            <span>Revora Meeting Assistant</span>
            <span>256-bit Encrypted</span>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
