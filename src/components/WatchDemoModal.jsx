import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Play, Sparkles } from 'lucide-react';

export default function WatchDemoModal({ isOpen, onClose }) {
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
          className="fixed inset-0 bg-black/60 backdrop-blur-md"
        />

        {/* Modal Window */}
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 220 }}
          className="relative w-full max-w-[840px] bg-black/90 rounded-[28px] border border-white/20 shadow-2xl overflow-hidden z-10 flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-white/5">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-[#0084FF] flex items-center justify-center text-white">
                <Play className="w-4 h-4 fill-white ml-0.5" />
              </div>
              <h3 className="font-outfit font-bold text-[18px] text-white">
                Assist AI — Product Overview & Demo
              </h3>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Video Container */}
          <div className="relative aspect-video w-full bg-black flex items-center justify-center overflow-hidden">
            <video
              src="https://strvid.nyc3.cdn.digitaloceanspaces.com/motionsite/hero_robo_video.mp4"
              controls
              autoPlay
              className="w-full h-full object-contain"
            />
          </div>

          {/* Footer note */}
          <div className="px-6 py-4 bg-white/5 border-t border-white/10 flex items-center justify-between text-xs text-white/70">
            <span className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-[#0084FF]" />
              Ultra-high fidelity liquid glass companion interface demo
            </span>
            <span className="font-mono text-white/50">HD 1080p</span>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
