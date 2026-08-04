import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Building2, ShieldCheck, Award, Globe, Users, Sparkles, CheckCircle2 } from 'lucide-react';

export default function CompanyModal({ isOpen, onClose }) {
  if (!isOpen) return null;

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

        {/* Modal Window */}
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 220 }}
          className="relative w-full max-w-[780px] h-[85vh] max-h-[660px] bg-white/95 backdrop-blur-[35px] border border-white/80 rounded-[28px] shadow-2xl flex flex-col z-10 overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-black/5 bg-white/60">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#0084FF] to-[#0066CC] flex items-center justify-center text-white shadow-xs">
                <Building2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-outfit font-bold text-[18px] text-black">
                  About Assist Inc.
                </h3>
                <p className="font-sans text-[12px] text-black/50">
                  Building the next generation of corporate AI digital companions
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-black/5 hover:bg-black/10 flex items-center justify-center text-black/60 hover:text-black transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Modal Content */}
          <div className="flex-1 overflow-y-auto p-6 sm:p-8 space-y-8 font-sans">
            
            {/* Mission Statement */}
            <div>
              <span className="px-3 py-1 rounded-full bg-[#0084FF]/10 text-[#0084FF] font-bold text-xs">
                Our Mission
              </span>
              <h4 className="font-outfit font-black text-[24px] text-black mt-3 leading-tight tracking-tight">
                Empowering modern teams to eliminate routine friction through fluid, human-centric AI.
              </h4>
              <p className="text-sm text-black/60 mt-3 leading-relaxed">
                Assist was founded with a single mission: to create responsive, liquid-glass AI interfaces that seamlessly integrate speech transcription, document summarization, and task execution into enterprise workflows.
              </p>
            </div>

            {/* Key Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-5 rounded-[22px] bg-neutral-50 border border-black/5">
              <div>
                <div className="font-outfit font-black text-2xl text-[#0084FF]">10,000+</div>
                <div className="text-xs text-black/60 font-medium mt-0.5">Active Teams</div>
              </div>
              <div>
                <div className="font-outfit font-black text-2xl text-emerald-600">99.99%</div>
                <div className="text-xs text-black/60 font-medium mt-0.5">Uptime SLA</div>
              </div>
              <div>
                <div className="font-outfit font-black text-2xl text-purple-600">&lt; 50ms</div>
                <div className="text-xs text-black/60 font-medium mt-0.5">Stream Latency</div>
              </div>
              <div>
                <div className="font-outfit font-black text-2xl text-amber-600">SOC2 Type II</div>
                <div className="text-xs text-black/60 font-medium mt-0.5">Certified Privacy</div>
              </div>
            </div>

            {/* Values / Highlights */}
            <div className="space-y-3">
              <h5 className="font-outfit font-bold text-base text-black">Company Principles</h5>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="p-4 rounded-xl bg-white border border-black/10 flex items-start gap-3">
                  <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0" />
                  <div>
                    <strong className="block font-bold text-black mb-0.5">Neural Privacy First</strong>
                    <span className="text-black/60">Zero data retention for enterprise customers with full end-to-end encryption.</span>
                  </div>
                </div>
                <div className="p-4 rounded-xl bg-white border border-black/10 flex items-start gap-3">
                  <Globe className="w-5 h-5 text-[#0084FF] shrink-0" />
                  <div>
                    <strong className="block font-bold text-black mb-0.5">Global Infrastructure</strong>
                    <span className="text-black/60">Multi-region edge clusters in North America, Europe, and Asia Pacific.</span>
                  </div>
                </div>
              </div>
            </div>

          </div>

          {/* Footer */}
          <div className="px-6 py-4 bg-white border-t border-black/5 flex items-center justify-between">
            <span className="text-xs text-black/50 font-sans">Assist Inc. • San Francisco & Global</span>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-black hover:bg-neutral-800 text-white font-bold text-xs cursor-pointer"
            >
              Close Overview
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
