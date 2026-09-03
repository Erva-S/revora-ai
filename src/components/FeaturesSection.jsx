import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, Brain, Layers, Gauge, ShieldCheck, RefreshCw, CheckCircle2, ArrowRight, Sparkles, Cpu, Lock, Workflow, FileText } from 'lucide-react';

export default function FeaturesSection({ onOpenTryModal }) {
  const [activeTab, setActiveTab] = useState(0);

  const features = [
    {
      icon: Zap,
      title: 'Autonomous Task Execution',
      description: 'Revora breaks complex goals into multi-step workflows, executing code, drafting emails, and updating tools autonomously.',
      tag: 'Core Engine',
      color: 'from-[#0084FF] to-[#0066CC]',
    },
    {
      icon: Brain,
      title: 'Contextual Long-Term Memory',
      description: 'Remembers project specs, design guidelines, and user preferences across sessions with privacy-first indexing.',
      tag: 'Neural Core',
      color: 'from-[#10B981] to-[#059669]',
    },
    {
      icon: Layers,
      title: '100+ Seamless Integrations',
      description: 'Connects natively with Slack, GitHub, Notion, Figma, Gmail, Jira, and enterprise databases out of the box.',
      tag: 'Ecosystem',
      color: 'from-[#9333EA] to-[#7E22CE]',
    },
    {
      icon: Gauge,
      title: 'Zero-Latency Streaming',
      description: 'Ultra-fast sub-50ms token generation with real-time feedback loops and dynamic parallel processing.',
      tag: 'Performance',
      color: 'from-[#F59E0B] to-[#D97706]',
    },
    {
      icon: ShieldCheck,
      title: 'Enterprise-Grade Neural Security',
      description: 'SOC2 Type II compliant, end-to-end encrypted with zero data retention for private AI deployments.',
      tag: 'Security',
      color: 'from-[#EC4899] to-[#DB2777]',
    },
    {
      icon: RefreshCw,
      title: 'Cross-Device Liquid Sync',
      description: 'Continuously syncs your ongoing tasks, companion state, and preferences across mobile, desktop, and web.',
      tag: 'Sync',
      color: 'from-[#06B6D4] to-[#0891B2]',
    },
  ];

  const showcaseTabs = [
    {
      id: 'assistant',
      title: 'AI Companion Interface',
      badge: 'Natural Interaction',
      heading: 'Natural AI assistance tailored to your editorial rhythm.',
      description: 'Engage in fluid conversations with an assistant that understands nuanced instructions, technical codebases, and visual mockups instantly.',
      highlights: ['Multi-modal vision & text understanding', 'Adaptive tone & formatting', 'Code generation with live execution'],
      previewType: 'chat',
    },
    {
      id: 'documents',
      title: 'Document & PDF Intelligence',
      badge: 'Instant Analysis',
      heading: 'Extract insights from thousands of pages in seconds.',
      description: 'Upload complex PDFs, spreadsheets, or technical documentation. Revora synthesizes summaries, tables, and actionable insights.',
      highlights: ['Deep semantic document parsing', 'Source reference citations', 'Export to PDF, Markdown & CSV'],
      previewType: 'doc',
    },
    {
      id: 'workflow',
      title: 'Autonomous Workflow Pipelines',
      badge: 'Zero Friction',
      heading: 'Automate repetitive daily tasks without writing code.',
      description: 'Build triggered workflows that monitor incoming emails, draft meeting agendas, and sync task boards automatically.',
      highlights: ['Trigger-based background loops', 'Custom API webhooks', 'Multi-app chain execution'],
      previewType: 'workflow',
    },
  ];

  return (
    <section id="features" className="relative w-full py-20 bg-white overflow-hidden border-t border-black/5">
      {/* Subtle Background Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[500px] bg-[#60B1FF]/10 rounded-full blur-[130px] -z-10 pointer-events-none" />

      <div className="w-full max-w-[1280px] mx-auto px-6 sm:px-12 lg:px-20">
        {/* Section Header */}
        <div className="flex flex-col items-center text-center max-w-[720px] mx-auto mb-16">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="px-3.5 py-1.5 rounded-full bg-black/5 border border-black/5 text-xs font-semibold text-black/80 flex items-center gap-2 mb-4"
          >
            <Sparkles className="w-3.5 h-3.5 text-[#0084FF]" />
            <span>Built for Modern High-Velocity Teams</span>
          </motion.div>

          <motion.h2
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="font-outfit font-extrabold text-[32px] sm:text-[42px] lg:text-[50px] leading-[1.1] tracking-[-2px] text-black"
          >
            Everything you need to automate your work with AI.
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="font-sans text-[17px] text-black/60 tracking-[-0.5px] mt-4 leading-relaxed"
          >
            Revora combines state-of-the-art neural models with liquid-glass interfaces to give you an ultra-responsive corporate digital companion.
          </motion.p>
        </div>

        {/* Capabilities Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-20">
          {features.map((item, idx) => {
            const Icon = item.icon;
            return (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: idx * 0.08 }}
                whileHover={{ y: -4 }}
                className="p-8 rounded-[24px] bg-white border border-black/10 hover:border-black/20 shadow-xs hover:shadow-lg transition-all flex flex-col justify-between"
              >
                <div>
                  <div className={`w-12 h-12 rounded-[18px] bg-gradient-to-br ${item.color} flex items-center justify-center text-white mb-6 shadow-md`}>
                    <Icon className="w-6 h-6" />
                  </div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-outfit font-extrabold text-[20px] text-black">{item.title}</h3>
                  </div>
                  <p className="font-sans text-[14px] text-black/60 leading-relaxed mt-2">{item.description}</p>
                </div>
                <div className="mt-6 pt-4 border-t border-black/5 flex items-center justify-between">
                  <span className="text-[11px] font-mono font-semibold text-black/40 uppercase tracking-wider">{item.tag}</span>
                  <ArrowRight className="w-4 h-4 text-black/30" />
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Deep Interactive Showcase Tabs */}
        <div className="bg-neutral-50/80 rounded-[32px] border border-black/10 p-6 sm:p-10 shadow-xl">
          <div className="flex flex-wrap items-center justify-center gap-3 mb-10">
            {showcaseTabs.map((tab, idx) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(idx)}
                className={`px-5 py-3 rounded-full text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
                  activeTab === idx
                    ? 'bg-[#0084FF] text-white shadow-md scale-105'
                    : 'bg-white text-black/70 hover:text-black border border-black/5'
                }`}
              >
                <span>{tab.title}</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] ${activeTab === idx ? 'bg-white/20 text-white' : 'bg-black/5 text-black/50'}`}>
                  {tab.badge}
                </span>
              </button>
            ))}
          </div>

          {/* Active Tab Card Content */}
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.3 }}
              className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center"
            >
              {/* Left Details */}
              <div className="lg:col-span-5 flex flex-col justify-center">
                <h3 className="font-outfit font-extrabold text-[26px] sm:text-[32px] text-black leading-tight mb-3">
                  {showcaseTabs[activeTab].heading}
                </h3>
                <p className="font-sans text-[15px] text-black/60 leading-relaxed mb-6">
                  {showcaseTabs[activeTab].description}
                </p>

                <ul className="space-y-3 mb-8">
                  {showcaseTabs[activeTab].highlights.map((h, i) => (
                    <li key={i} className="flex items-center gap-3 text-xs font-bold text-black/80">
                      <CheckCircle2 className="w-4 h-4 text-[#0084FF]" />
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>

                <button
                  onClick={onOpenTryModal}
                  className="w-fit px-6 py-3.5 rounded-[16px] bg-black hover:bg-neutral-800 text-white text-xs font-bold flex items-center gap-2 shadow-md transition-all cursor-pointer"
                >
                  <span>Test in Live Sandbox</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>

              {/* Right Interactive Mock Preview */}
              <div className="lg:col-span-7 bg-white rounded-[24px] border border-black/10 p-6 shadow-md relative overflow-hidden">
                <div className="flex items-center justify-between pb-4 mb-4 border-b border-black/5">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-400" />
                    <div className="w-3 h-3 rounded-full bg-yellow-400" />
                    <div className="w-3 h-3 rounded-full bg-green-400" />
                  </div>
                  <span className="font-mono text-xs text-black/40">revora_engine_v3.4.2</span>
                </div>

                {showcaseTabs[activeTab].previewType === 'chat' && (
                  <div className="flex flex-col gap-3">
                    <div className="self-end bg-[#0084FF] text-white px-4 py-2.5 rounded-[16px] rounded-tr-xs text-xs font-sans max-w-[80%]">
                      "Draft a concise technical architecture summary for our new liquid-glass front-end framework."
                    </div>
                    <div className="self-start bg-neutral-100 border border-black/5 text-neutral-800 px-4 py-3 rounded-[16px] rounded-tl-xs text-xs font-sans max-w-[85%] leading-relaxed">
                      <strong>Architecture Overview:</strong><br />
                      • Core Canvas: Solid white (#FFFFFF) with ambient radial gradients.<br />
                      • Components: Squircle cards with backdrop-blur-[20px] and inset highlights.<br />
                      • Micro-animations: 60fps spring loops for floating weightlessness.
                    </div>
                  </div>
                )}

                {showcaseTabs[activeTab].previewType === 'doc' && (
                  <div className="flex flex-col gap-3">
                    <div className="p-4 rounded-xl bg-sky-50/50 border border-sky-100 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <FileText className="w-8 h-8 text-[#0084FF]" />
                        <div>
                          <div className="text-xs font-bold text-black">Q3_Quarterly_Strategy.pdf</div>
                          <div className="text-[10px] text-black/50">24 pages • 4.8 MB • Uploaded</div>
                        </div>
                      </div>
                      <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-green-100 text-green-700">100% Parsed</span>
                    </div>

                    <div className="p-3 bg-neutral-50 rounded-xl text-xs text-black/70 font-sans space-y-1.5">
                      <div className="font-bold text-black">Generated Key Points:</div>
                      <div>1. Revenue expanded by 34% YoY driven by enterprise AI adoption.</div>
                      <div>2. Customer retention reached 98.4% with liquid-glass UX upgrades.</div>
                    </div>
                  </div>
                )}

                {showcaseTabs[activeTab].previewType === 'workflow' && (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-3 p-3 bg-neutral-50 rounded-xl border border-black/5 text-xs">
                      <Workflow className="w-5 h-5 text-[#0084FF]" />
                      <div className="flex-1">
                        <span className="font-bold text-black">Trigger:</span> New Jira Issue Created
                      </div>
                      <span className="text-[10px] font-mono bg-blue-100 text-blue-700 px-2 py-0.5 rounded">Active</span>
                    </div>

                    <div className="flex items-center justify-center py-1">
                      <ArrowRight className="w-4 h-4 text-black/30 rotate-90" />
                    </div>

                    <div className="flex items-center gap-3 p-3 bg-green-50/60 rounded-xl border border-green-100 text-xs">
                      <Zap className="w-5 h-5 text-green-600" />
                      <div className="flex-1">
                        <span className="font-bold text-black">Action:</span> Revora auto-assigns lead dev & posts Slack briefing
                      </div>
                      <span className="text-[10px] font-mono bg-green-100 text-green-700 px-2 py-0.5 rounded">Completed</span>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
