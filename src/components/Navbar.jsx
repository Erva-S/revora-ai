import React, { useState, useEffect } from 'react';
import { Bot, ArrowRight, Menu, X, Sparkles, User, ShieldCheck, LogIn } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../context/AuthContext';

export default function Navbar({ onOpenTryModal, onOpenGetStartedModal, onOpenCompanyModal, onOpenLoginModal, onNavigateDashboard }) {
  const { user } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <>
      <header className="fixed top-[20px] sm:top-[30px] left-0 right-0 z-50 flex justify-center px-4 pointer-events-none">
        <motion.div
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className={`w-full max-w-[1280px] h-12 rounded-[16px] pointer-events-auto transition-all duration-300 ${
            scrolled
              ? 'bg-white/85 backdrop-blur-[20px] border border-black/10 shadow-[0_8px_30px_rgb(0,0,0,0.06)]'
              : 'bg-white/50 backdrop-blur-[12px] border border-white/70 shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:bg-white/70'
          }`}
        >
          <div className="flex items-center justify-between gap-4 sm:gap-8 px-4 sm:px-6 py-1.5 h-full w-full">
            
            {/* Brand Logo & College Logo */}
            <div className="flex items-center gap-2.5">
              <a
                href="#home"
                title="CHARUSAT - Charotar University of Science and Technology"
                className="flex items-center gap-2 bg-white/80 px-2 py-1 rounded-xl border border-black/5 shadow-2xs hover:bg-white transition-all shrink-0"
              >
                <img
                  src="/college-logo.png"
                  alt="CHARUSAT - Charotar University of Science and Technology"
                  className="h-7 sm:h-8 w-auto object-contain shrink-0"
                />
              </a>
              <div className="h-5 w-[1px] bg-black/15 shrink-0 hidden sm:block" />
              <a
                href="#home"
                className="font-fustat font-extrabold text-[20px] sm:text-[22px] tracking-tight text-black flex items-center gap-2 group select-none"
              >
                <div className="w-7 h-7 rounded-lg bg-[#0084FF]/10 flex items-center justify-center group-hover:scale-105 transition-transform duration-200">
                  <Bot className="w-5 h-5 text-[#0084FF]" />
                </div>
                <span>Revora<span className="text-[#0084FF]">.</span></span>
              </a>
            </div>

            {/* Desktop Navigation Links */}
            <nav className="hidden md:flex items-center gap-8">
              <a href="#home" className="font-sans text-[14px] font-medium text-black/70 hover:text-black transition-colors">
                Home
              </a>
              <a href="#features" className="font-sans text-[14px] font-medium text-black/60 hover:text-black transition-colors">
                Features
              </a>
              <button
                onClick={onOpenCompanyModal}
                className="font-sans text-[14px] font-medium text-black/60 hover:text-black transition-colors cursor-pointer"
              >
                Company
              </button>
              <a href="#pricing" className="font-sans text-[14px] font-medium text-black/60 hover:text-black transition-colors">
                Pricing
              </a>
            </nav>

            {/* Right Call-to-Action Pill & Authentication Trigger */}
            <div className="flex items-center gap-3">
              {user ? (
                <button
                  onClick={onNavigateDashboard}
                  className={`group h-9 px-4 rounded-[12px] text-[13px] font-bold flex items-center gap-2 border shadow-xs transition-all cursor-pointer ${
                    user.role === 'admin'
                      ? 'bg-amber-50 hover:bg-amber-100 border-amber-200 text-amber-800'
                      : 'bg-sky-50 hover:bg-sky-100 border-sky-200 text-[#0084FF]'
                  }`}
                >
                  {user.avatar ? (
                    <img
                      src={user.avatar}
                      alt={user.name || 'User Avatar'}
                      className="w-5.5 h-5.5 rounded-full object-cover border border-white"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  ) : (
                    <div className="w-5.5 h-5.5 rounded-full bg-[#0084FF] text-white flex items-center justify-center text-[10px] font-black uppercase shadow-2xs shrink-0">
                      {(user.name || user.email || 'U').charAt(0)}
                    </div>
                  )}
                  <span className="max-w-[140px] truncate">{user.name || user.email || (user.role === 'admin' ? 'Admin Control' : 'User Dashboard')}</span>
                </button>
              ) : (
                <button
                  onClick={onOpenLoginModal}
                  className="h-9 px-3.5 rounded-[12px] bg-black/5 hover:bg-black/10 border border-black/10 text-[13px] font-semibold flex items-center gap-1.5 text-black transition-all cursor-pointer"
                >
                  <LogIn className="w-3.5 h-3.5 text-[#0084FF]" />
                  <span>Sign In</span>
                </button>
              )}

              <button
                onClick={onOpenGetStartedModal}
                className="group h-9 px-4 sm:px-5 rounded-[12px] bg-[#0084FF] hover:bg-[#0074E0] text-white text-[13px] sm:text-[14px] font-bold flex items-center gap-2 shadow-xs transition-all cursor-pointer"
              >
                <span>Get Started</span>
                <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
              </button>

              {/* Mobile Menu Toggle */}
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                aria-label="Toggle Navigation Menu"
                className="md:hidden w-9 h-9 rounded-[12px] bg-black/5 hover:bg-black/10 border border-black/10 flex items-center justify-center text-black cursor-pointer"
              >
                {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            </div>

          </div>
        </motion.div>
      </header>

      {/* Mobile Drawer */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileMenuOpen(false)}
              className="fixed inset-0 bg-black/30 backdrop-blur-xs z-50 md:hidden"
            />

            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed top-0 right-0 bottom-0 w-[260px] bg-white/95 backdrop-blur-[40px] border-l border-black/10 z-50 p-6 flex flex-col justify-between shadow-2xl md:hidden"
            >
              <div>
                <div className="flex items-center justify-between pb-6 border-b border-black/10">
                  <div className="flex items-center gap-2">
                    <div className="p-1 rounded-lg bg-white border border-black/10 shadow-2xs">
                      <img
                        src="/college-logo.png"
                        alt="CHARUSAT - Charotar University of Science and Technology"
                        className="h-6 w-auto object-contain"
                      />
                    </div>
                    <div className="h-4 w-[1px] bg-black/15" />
                    <div className="font-fustat font-extrabold text-[17px] tracking-tight text-black flex items-center gap-1.5">
                      <Bot className="w-4 h-4 text-[#0084FF]" />
                      <span>Revora.</span>
                    </div>
                  </div>
                  <button onClick={() => setMobileMenuOpen(false)} className="p-1 rounded-lg text-black/60">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <nav className="flex flex-col gap-4 mt-6">
                  <a href="#home" onClick={() => setMobileMenuOpen(false)} className="font-sans text-[15px] font-medium py-2 border-b border-black/5">Home</a>
                  <a href="#features" onClick={() => setMobileMenuOpen(false)} className="font-sans text-[15px] font-medium py-2 border-b border-black/5">Features</a>
                  <button onClick={() => { setMobileMenuOpen(false); onOpenCompanyModal(); }} className="font-sans text-[15px] font-medium py-2 border-b border-black/5 text-left">Company</button>
                  <a href="#pricing" onClick={() => setMobileMenuOpen(false)} className="font-sans text-[15px] font-medium py-2 border-b border-black/5">Pricing</a>
                </nav>
              </div>

              <div className="pt-6 border-t border-black/10 flex flex-col gap-3">
                {user ? (
                  <button
                    onClick={() => { setMobileMenuOpen(false); onNavigateDashboard(); }}
                    className="w-full h-11 rounded-[14px] bg-[#0084FF] text-white font-bold text-sm flex items-center justify-center gap-2 shadow-md"
                  >
                    <User className="w-4 h-4" />
                    <span>{user.name || user.email || 'Open Dashboard'}</span>
                  </button>
                ) : (
                  <button
                    onClick={() => { setMobileMenuOpen(false); onOpenLoginModal(); }}
                    className="w-full h-11 rounded-[14px] bg-black/5 hover:bg-black/10 text-black font-bold text-sm flex items-center justify-center gap-2"
                  >
                    <LogIn className="w-4 h-4 text-[#0084FF]" />
                    <span>Sign In / Passport Auth</span>
                  </button>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
