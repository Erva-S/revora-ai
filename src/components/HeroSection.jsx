import React from 'react';
import { motion } from 'framer-motion';
import {
  ChevronRight,
  Mic,
  FileText,
  Users,
  CheckSquare,
  Calendar,
  Bell,
  Search,
  BarChart3,
} from 'lucide-react';

export default function HeroSection({ onOpenTryModal, onOpenFeatureModal }) {
  const avatars = [
    'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=80&h=80&fit=crop&crop=face',
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=80&h=80&fit=crop&crop=face',
    'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=80&h=80&fit=crop&crop=face',
    'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=80&h=80&fit=crop&crop=face',
  ];

  // 8 Premium Glassmorphism Feature Cards symmetrically surrounding central AI Robot
  const leftBadges = [
    {
      id: 'transcription',
      title: 'Live Transcription',
      subtitle: 'Convert speech into text',
      icon: Mic,
      gradient: 'from-[#0084FF] to-[#0066CC]',
      shadowHover: 'hover:shadow-[0_14px_36px_-4px_rgba(0,132,255,0.32)] hover:border-[#0084FF]/60 hover:ring-[#0084FF]/25',
      delay: 0.3,
      floatY: [-5, 5, -5],
      duration: 5.2,
    },
    {
      id: 'summary',
      title: 'AI Meeting Summary',
      subtitle: 'Generate smart summaries',
      icon: FileText,
      gradient: 'from-[#10B981] to-[#059669]',
      shadowHover: 'hover:shadow-[0_14px_36px_-4px_rgba(16,185,129,0.32)] hover:border-[#10B981]/60 hover:ring-[#10B981]/25',
      delay: 0.45,
      floatY: [5, -5, 5],
      duration: 4.8,
    },
    {
      id: 'speaker',
      title: 'Speaker Identification',
      subtitle: 'Recognize every speaker',
      icon: Users,
      gradient: 'from-[#9333EA] to-[#7E22CE]',
      shadowHover: 'hover:shadow-[0_14px_36px_-4px_rgba(147,51,234,0.32)] hover:border-[#9333EA]/60 hover:ring-[#9333EA]/25',
      delay: 0.6,
      floatY: [-6, 6, -6],
      duration: 5.5,
    },
    {
      id: 'actions',
      title: 'Action Items',
      subtitle: 'Extract tasks automatically',
      icon: CheckSquare,
      gradient: 'from-[#F59E0B] to-[#D97706]',
      shadowHover: 'hover:shadow-[0_14px_36px_-4px_rgba(245,158,11,0.32)] hover:border-[#F59E0B]/60 hover:ring-[#F59E0B]/25',
      delay: 0.75,
      floatY: [6, -6, 6],
      duration: 5.0,
    },
  ];

  const rightBadges = [
    {
      id: 'calendar',
      title: 'Calendar Sync',
      subtitle: 'Create meeting events',
      icon: Calendar,
      gradient: 'from-[#EF4444] to-[#DC2626]',
      shadowHover: 'hover:shadow-[0_14px_36px_-4px_rgba(239,68,68,0.32)] hover:border-[#EF4444]/60 hover:ring-[#EF4444]/25',
      delay: 0.35,
      floatY: [5, -5, 5],
      duration: 5.1,
    },
    {
      id: 'remind',
      title: 'Smart Reminders',
      subtitle: 'Never miss deadlines',
      icon: Bell,
      gradient: 'from-[#EC4899] to-[#DB2777]',
      shadowHover: 'hover:shadow-[0_14px_36px_-4px_rgba(236,72,153,0.32)] hover:border-[#EC4899]/60 hover:ring-[#EC4899]/25',
      delay: 0.5,
      floatY: [-5, 5, -5],
      duration: 4.9,
    },
    {
      id: 'search',
      title: 'AI Search',
      subtitle: 'Search past meetings instantly',
      icon: Search,
      gradient: 'from-[#0284C7] to-[#0369A1]',
      shadowHover: 'hover:shadow-[0_14px_36px_-4px_rgba(2,132,199,0.32)] hover:border-[#0284C7]/60 hover:ring-[#0284C7]/25',
      delay: 0.65,
      floatY: [6, -6, 6],
      duration: 5.4,
    },
    {
      id: 'analytics',
      title: 'Meeting Analytics',
      subtitle: 'AI-powered insights and reports',
      icon: BarChart3,
      gradient: 'from-[#7C3AED] to-[#6D28D9]',
      shadowHover: 'hover:shadow-[0_14px_36px_-4px_rgba(124,58,237,0.32)] hover:border-[#7C3AED]/60 hover:ring-[#7C3AED]/25',
      delay: 0.8,
      floatY: [-6, 6, -6],
      duration: 5.3,
    },
  ];

  return (
    <section id="home" className="relative w-full overflow-hidden bg-white pt-[110px] sm:pt-[125px] lg:pt-[135px] pb-16 lg:pb-24">
      {/* Main Responsive Grid Container */}
      <div className="w-full max-w-[1400px] mx-auto px-4 sm:px-8 lg:px-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-6 items-center">
          
          {/* LEFT COLUMN: Copy, Social Proof & Primary CTA (lg:col-span-4) */}
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col justify-center items-start text-left max-w-[560px] lg:col-span-4 z-10"
          >
            {/* CHARUSAT College Affiliation Badge */}
            <motion.div
              whileHover={{ scale: 1.02 }}
              className="mb-3.5 px-3.5 py-1.5 rounded-full bg-[#0084FF]/10 border border-[#0084FF]/25 flex items-center gap-2.5 shadow-2xs"
            >
              <div className="p-1 rounded-md bg-white shadow-2xs flex items-center">
                <img
                  src="/college-logo.png"
                  alt="CHARUSAT - Charotar University of Science and Technology"
                  className="h-5 w-auto object-contain"
                />
              </div>
              <span className="font-sans text-[12px] font-bold text-[#0066CC] tracking-tight">
                CHARUSAT <span className="font-normal text-black/60 hidden sm:inline">• Charotar University of Science & Technology</span>
              </span>
            </motion.div>

            {/* Social Proof Badge */}
            <motion.div
              whileHover={{ scale: 1.02 }}
              onClick={() => onOpenFeatureModal('social-proof')}
              className="px-4 py-2 rounded-full bg-black/5 border border-black/5 flex items-center gap-3 w-fit shadow-xs cursor-pointer group hover:bg-black/10 transition-all"
            >
              <div className="flex -space-x-2 select-none">
                {avatars.map((url, i) => (
                  <img
                    key={i}
                    src={url}
                    alt={`Team avatar ${i + 1}`}
                    className="w-6.5 h-6.5 rounded-full border-1.5 border-white object-cover group-hover:translate-x-[2px] transition-transform"
                    style={{ transitionDelay: `${i * 30}ms` }}
                  />
                ))}
              </div>
              <span className="font-sans text-[13px] text-black/80">
                Trusted by <strong className="font-semibold text-[#171717]">10,000+ teams</strong> worldwide
              </span>
            </motion.div>

            {/* Display Title */}
            <h1 className="font-outfit font-black text-[40px] sm:text-[50px] lg:text-[62px] leading-[1.06] tracking-[-3px] mt-6 select-none text-black">
              Your All in One <br />
              <span className="text-black">Revora.</span>
            </h1>

            {/* Body Paragraph */}
            <p className="font-sans text-[16px] sm:text-[18px] text-black/60 tracking-[-0.5px] leading-relaxed mt-5 max-w-[460px]">
              An AI-powered meeting assistant that automatically transcribes, summarizes, extracts action items, and syncs workflow.
            </p>

            {/* Primary CTA Pill Button */}
            <div className="mt-8 flex items-center gap-4">
              <motion.button
                onClick={onOpenTryModal}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                className="pl-7 pr-3 py-3 rounded-full bg-[#0084FF] hover:bg-[#0074E0] text-white flex items-center gap-4 text-base font-bold transition-all w-fit shadow-xl shadow-primary-btn cursor-pointer group"
              >
                <span>Try Revora. Free</span>
                <div className="w-9 h-9 rounded-full bg-white flex items-center justify-center text-[#0084FF] group-hover:translate-x-0.5 transition-transform duration-200 shadow-xs">
                  <ChevronRight className="w-4.5 h-4.5 stroke-[3px]" />
                </div>
              </motion.button>
            </div>
          </motion.div>

          {/* RIGHT COLUMN: Symmetrical Premium Glassmorphism Feature Cards flanking Central 3D Robot Companion (lg:col-span-8) */}
          <div className="relative w-full flex items-center justify-center py-6 lg:py-8 lg:col-span-8">
            
            {/* 3-Column Layout (4 Left Feature Cards | Central 3D Robot | 4 Right Feature Cards) */}
            <div className="relative w-full flex flex-col md:flex-row items-center justify-between gap-4 sm:gap-6 lg:gap-8">
              
              {/* LEFT 4 GLASSMORPHISM FEATURE CARDS */}
              <div className="w-full md:w-auto flex flex-col gap-4 sm:gap-5.5 z-20 shrink-0">
                {leftBadges.map((badge) => {
                  const Icon = badge.icon;
                  return (
                    <motion.div
                      key={badge.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{
                        opacity: 1,
                        x: 0,
                        y: badge.floatY,
                      }}
                      transition={{
                        opacity: { duration: 0.5, delay: badge.delay },
                        x: { duration: 0.5, delay: badge.delay },
                        y: { repeat: Infinity, duration: badge.duration, ease: 'easeInOut' },
                      }}
                      whileHover={{ scale: 1.05, x: 5 }}
                      onClick={() => onOpenFeatureModal(badge.id)}
                      className={`px-5 py-3.5 rounded-[22px] bg-white/95 backdrop-blur-[24px] border border-white/90 ring-1 ring-black/5 shadow-md ${badge.shadowHover} flex items-center gap-3.5 cursor-pointer transition-all duration-300 group w-full md:w-[250px] lg:w-[265px]`}
                    >
                      <div className={`w-10 h-10 rounded-2xl bg-gradient-to-br ${badge.gradient} flex items-center justify-center text-white shrink-0 shadow-md group-hover:scale-110 transition-transform duration-300`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div className="flex flex-col text-left leading-tight min-w-0">
                        <span className="font-sans font-bold text-[14px] text-neutral-900 tracking-tight group-hover:text-[#0084FF] transition-colors truncate">
                          {badge.title}
                        </span>
                        <span className="font-sans font-semibold text-[11px] text-neutral-500 mt-0.5 truncate">
                          {badge.subtitle}
                        </span>
                      </div>
                    </motion.div>
                  );
                })}
              </div>

              {/* CENTRAL 3D ROBOT COMPANION FOCUS (Seamless Pure White Canvas) */}
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.8, delay: 0.2 }}
                className="relative z-10 w-full max-w-[340px] sm:max-w-[440px] lg:max-w-[500px] xl:max-w-[540px] my-4 md:my-0 flex justify-center items-center"
              >
                {/* Pure Seamless Video Blend */}
                <video
                  src="https://strvid.nyc3.cdn.digitaloceanspaces.com/motionsite/hero_robo_video.mp4"
                  autoPlay
                  loop
                  muted
                  playsInline
                  controls={false}
                  className="w-full h-auto rounded-[24px] select-none block blend-video"
                />
              </motion.div>

              {/* RIGHT 4 GLASSMORPHISM FEATURE CARDS */}
              <div className="w-full md:w-auto flex flex-col gap-4 sm:gap-5.5 z-20 shrink-0">
                {rightBadges.map((badge) => {
                  const Icon = badge.icon;
                  return (
                    <motion.div
                      key={badge.id}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{
                        opacity: 1,
                        x: 0,
                        y: badge.floatY,
                      }}
                      transition={{
                        opacity: { duration: 0.5, delay: badge.delay },
                        x: { duration: 0.5, delay: badge.delay },
                        y: { repeat: Infinity, duration: badge.duration, ease: 'easeInOut' },
                      }}
                      whileHover={{ scale: 1.05, x: -5 }}
                      onClick={() => onOpenFeatureModal(badge.id)}
                      className={`px-5 py-3.5 rounded-[22px] bg-white/95 backdrop-blur-[24px] border border-white/90 ring-1 ring-black/5 shadow-md ${badge.shadowHover} flex items-center gap-3.5 cursor-pointer transition-all duration-300 group w-full md:w-[250px] lg:w-[265px]`}
                    >
                      <div className={`w-10 h-10 rounded-2xl bg-gradient-to-br ${badge.gradient} flex items-center justify-center text-white shrink-0 shadow-md group-hover:scale-110 transition-transform duration-300`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div className="flex flex-col text-left leading-tight min-w-0">
                        <span className="font-sans font-bold text-[14px] text-neutral-900 tracking-tight group-hover:text-[#0084FF] transition-colors truncate">
                          {badge.title}
                        </span>
                        <span className="font-sans font-semibold text-[11px] text-neutral-500 mt-0.5 truncate">
                          {badge.subtitle}
                        </span>
                      </div>
                    </motion.div>
                  );
                })}
              </div>

            </div>

          </div>

        </div>
      </div>
    </section>
  );
}
