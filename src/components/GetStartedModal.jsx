import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Bot, ArrowRight, Check, Sparkles, Shield, User, Building, Mail, RefreshCw } from 'lucide-react';
import confetti from 'canvas-confetti';

export default function GetStartedModal({ isOpen, onClose }) {
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmitEmail = (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setStep(2);
  };

  const handleCreateWorkspace = (e) => {
    e.preventDefault();
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setStep(3);
      confetti({
        particleCount: 50,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#0084FF', '#10B981', '#9333EA'],
      });
    }, 1000);
  };

  const resetForm = () => {
    setStep(1);
    setEmail('');
    setWorkspaceName('');
    onClose();
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-hidden">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={resetForm}
          className="fixed inset-0 bg-black/50 backdrop-blur-md"
        />

        {/* Modal Window */}
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 220 }}
          className="relative w-full max-w-[520px] bg-white/95 backdrop-blur-[35px] border border-white/80 rounded-[28px] shadow-2xl flex flex-col z-10 overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-black/5 bg-white/60">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-[#0084FF] flex items-center justify-center text-white shadow-xs">
                <Bot className="w-5 h-5" />
              </div>
              <h3 className="font-outfit font-bold text-[18px] text-black">
                Get Started with Revora
              </h3>
            </div>
            <button
              onClick={resetForm}
              className="w-8 h-8 rounded-full bg-black/5 hover:bg-black/10 flex items-center justify-center text-black/60 hover:text-black transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Form Content */}
          <div className="p-6 sm:p-8 font-sans">
            {step === 1 && (
              <form onSubmit={handleSubmitEmail} className="space-y-5">
                <div>
                  <label className="block text-xs font-bold text-black mb-1.5">Work Email Address</label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-black/40 absolute left-3.5 top-3.5" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="alex@company.com"
                      className="w-full pl-10 pr-4 py-3 rounded-2xl bg-neutral-100/80 border border-black/10 text-sm focus:outline-none focus:border-[#0084FF] focus:bg-white"
                    />
                  </div>
                  <span className="text-[11px] text-black/50 mt-1.5 block">14-day free trial • No credit card required</span>
                </div>

                <button
                  type="submit"
                  className="w-full py-3.5 px-6 rounded-2xl bg-[#0084FF] hover:bg-[#0074E0] text-white font-bold text-sm flex items-center justify-center gap-2 shadow-md cursor-pointer transition-all"
                >
                  <span>Continue to Workspace</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>
            )}

            {step === 2 && (
              <form onSubmit={handleCreateWorkspace} className="space-y-5">
                <div>
                  <label className="block text-xs font-bold text-black mb-1.5">Workspace / Company Name</label>
                  <div className="relative">
                    <Building className="w-4 h-4 text-black/40 absolute left-3.5 top-3.5" />
                    <input
                      type="text"
                      required
                      value={workspaceName}
                      onChange={(e) => setWorkspaceName(e.target.value)}
                      placeholder="Acme Corp Engineering"
                      className="w-full pl-10 pr-4 py-3 rounded-2xl bg-neutral-100/80 border border-black/10 text-sm focus:outline-none focus:border-[#0084FF] focus:bg-white"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3.5 px-6 rounded-2xl bg-[#0084FF] hover:bg-[#0074E0] text-white font-bold text-sm flex items-center justify-center gap-2 shadow-md cursor-pointer transition-all disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Provisioning Workspace...</span>
                    </>
                  ) : (
                    <>
                      <span>Create Workspace & Start</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>
            )}

            {step === 3 && (
              <div className="text-center py-4 space-y-4">
                <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-md">
                  <Check className="w-7 h-7 stroke-[3px]" />
                </div>
                <h4 className="font-outfit font-black text-2xl text-black">Workspace Ready!</h4>
                <p className="text-xs text-black/60 max-w-[340px] mx-auto">
                  Welcome to <strong>{workspaceName || 'your new workspace'}</strong>. Revora AI companion has been provisioned and ready for your team.
                </p>

                <button
                  onClick={resetForm}
                  className="w-full py-3 rounded-xl bg-black hover:bg-neutral-800 text-white font-bold text-xs shadow-md cursor-pointer mt-4"
                >
                  Launch Revora Dashboard
                </button>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
