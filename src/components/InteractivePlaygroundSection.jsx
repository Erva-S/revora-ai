import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Bot, Sparkles, Send, Check, Play, RefreshCw, PenLine, FileText, CheckSquare, ChevronRight } from 'lucide-react';
import confetti from 'canvas-confetti';

export default function InteractivePlaygroundSection({ onOpenTryModal }) {
  const [selectedTask, setSelectedTask] = useState('email');
  const [isProcessing, setIsProcessing] = useState(false);
  const [completed, setCompleted] = useState(false);

  const tasks = [
    {
      id: 'email',
      icon: PenLine,
      title: 'Compose Q3 Meeting Email',
      badge: 'Email Task',
      color: 'from-[#0084FF] to-[#0066CC]',
      prompt: 'Draft an email to the product leadership team scheduling our Q3 AI assistant roadmap review.',
      result: `Subject: Invitation: Q3 Product Roadmap & AI Integration Review\n\nDear Leadership Team,\n\nI would like to schedule a 45-minute sync to walk through our completed Q3 AI assistant architecture, liquid glass UI designs, and performance benchmarks.\n\nAgenda:\n1. Front-End Liquid Glass Architecture Demo\n2. Real-Time Streaming Performance Stats\n3. Enterprise Rollout Plan\n\nBest regards,\nEngineering & Product Team`,
    },
    {
      id: 'doc',
      icon: FileText,
      title: 'Summarize Benchmark Report',
      badge: 'Document Task',
      color: 'from-[#10B981] to-[#059669]',
      prompt: 'Summarize the 40-page Enterprise AI Productivity Benchmark Report into 3 executive bullet points.',
      result: `Executive Summary Highlights:\n\n1. Enterprise teams using Revora saved an average of 14.2 hours per week on routine communication & document synthesis.\n2. Customer satisfaction scores (CSAT) reached 99.1% across all audited departments.\n3. Zero security incidents reported with neural end-to-end encryption.`,
    },
    {
      id: 'todo',
      icon: CheckSquare,
      title: 'Generate Daily Engineering Backlog',
      badge: 'Planning Task',
      color: 'from-[#9333EA] to-[#7E22CE]',
      prompt: 'Create a prioritized sprint task list for modern liquid-glass landing page rollout.',
      result: `Prioritized Sprint Backlog:\n\n• [HIGH] Verify mobile responsiveness & 12-column grid alignment under 1024px\n• [HIGH] Audit liquid glass backdrop blur filters & inset ring shadows\n• [MEDIUM] Run end-to-end user interaction tests on floating task badges\n• [LOW] Update API integration docs`,
    },
  ];

  const currentTask = tasks.find((t) => t.id === selectedTask);

  const handleRunTask = () => {
    setIsProcessing(true);
    setCompleted(false);
    setTimeout(() => {
      setIsProcessing(false);
      setCompleted(true);
      confetti({
        particleCount: 35,
        spread: 50,
        origin: { y: 0.7 },
        colors: ['#0084FF', '#10B981', '#9333EA'],
      });
    }, 800);
  };

  return (
    <section id="demo" className="relative w-full py-20 bg-neutral-50/50 border-t border-black/5">
      <div className="w-full max-w-[1280px] mx-auto px-6 sm:px-12 lg:px-20">
        
        {/* Header */}
        <div className="flex flex-col items-center text-center max-w-[700px] mx-auto mb-14">
          <span className="px-3.5 py-1.5 rounded-full bg-[#0084FF]/10 text-[#0084FF] text-xs font-bold mb-3 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" />
            Live In-Page Playground
          </span>
          <h2 className="font-outfit font-extrabold text-[32px] sm:text-[40px] text-black tracking-tight leading-tight">
            See Revora in action. Test live workflows right here.
          </h2>
          <p className="font-sans text-[16px] text-black/60 mt-3">
            Select an automated task template below and watch Revora generate ultra-fast structured outputs.
          </p>
        </div>

        {/* Playground Container */}
        <div className="w-full bg-white rounded-[28px] border border-black/10 shadow-xl overflow-hidden grid grid-cols-1 lg:grid-cols-12">
          
          {/* Left Controls (lg:col-span-5) */}
          <div className="lg:col-span-5 p-6 sm:p-8 bg-neutral-50/80 border-b lg:border-b-0 lg:border-r border-black/10 flex flex-col justify-between">
            <div>
              <h3 className="font-outfit font-bold text-[18px] text-black mb-4 flex items-center gap-2">
                <img src="/revora-icon.png" alt="Revora" className="w-5 h-5 object-contain" />
                Select Task Template
              </h3>

              <div className="flex flex-col gap-3">
                {tasks.map((task) => {
                  const Icon = task.icon;
                  const isSelected = task.id === selectedTask;
                  return (
                    <button
                      key={task.id}
                      onClick={() => {
                        setSelectedTask(task.id);
                        setCompleted(false);
                      }}
                      className={`p-4 rounded-[20px] text-left transition-all cursor-pointer border flex items-center justify-between ${
                        isSelected
                          ? 'bg-white border-[#0084FF] shadow-md ring-2 ring-[#0084FF]/20 scale-102'
                          : 'bg-white/60 hover:bg-white border-black/5 text-black/70'
                      }`}
                    >
                      <div className="flex items-center gap-3.5">
                        <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${task.color} flex items-center justify-center text-white shadow-xs shrink-0`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="font-outfit font-bold text-sm text-black">{task.title}</div>
                          <div className="font-sans text-[11px] text-black/50">{task.badge}</div>
                        </div>
                      </div>
                      <ChevronRight className={`w-4 h-4 transition-transform ${isSelected ? 'text-[#0084FF] translate-x-1' : 'text-black/30'}`} />
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-8 pt-6 border-t border-black/10">
              <button
                onClick={handleRunTask}
                disabled={isProcessing}
                className="w-full py-3.5 px-6 rounded-[16px] bg-[#0084FF] hover:bg-[#0074E0] text-white font-bold text-sm flex items-center justify-center gap-3 shadow-md hover:shadow-lg transition-all cursor-pointer"
              >
                {isProcessing ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Processing Task...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-white" />
                    <span>Execute Task with Revora</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Right Live Preview Output (lg:col-span-7) */}
          <div className="lg:col-span-7 p-6 sm:p-8 flex flex-col justify-between bg-white relative">
            <div>
              <div className="flex items-center justify-between pb-4 mb-4 border-b border-black/5">
                <span className="font-mono text-xs font-bold text-black/50 uppercase tracking-wider">
                  Live Terminal Output
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-green-100 text-green-700">
                  Ready
                </span>
              </div>

              {/* Prompt box */}
              <div className="p-4 rounded-[16px] bg-neutral-100/70 border border-black/5 mb-4">
                <div className="text-[11px] font-mono text-black/40 mb-1">User Prompt:</div>
                <div className="font-sans text-xs text-neutral-800 font-medium">"{currentTask.prompt}"</div>
              </div>

              {/* Generated Result */}
              <div className="p-5 rounded-[20px] bg-gradient-to-br from-white to-sky-50/20 border border-black/10 shadow-xs relative min-h-[200px]">
                {isProcessing ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/90 backdrop-blur-xs gap-3">
                    <RefreshCw className="w-6 h-6 text-[#0084FF] animate-spin" />
                    <span className="font-sans text-xs font-semibold text-black/60">Executing neural inference...</span>
                  </div>
                ) : (
                  <pre className="font-sans text-xs text-neutral-800 whitespace-pre-wrap leading-relaxed">
                    {currentTask.result}
                  </pre>
                )}
              </div>
            </div>

            {/* Bottom action bar */}
            <div className="mt-6 pt-4 border-t border-black/5 flex items-center justify-between">
              <span className="text-xs text-black/50 font-sans">
                {completed ? '✓ Task successfully generated in 0.04s' : 'Click "Execute Task" to test streaming'}
              </span>

              <button
                onClick={onOpenTryModal}
                className="text-xs font-bold text-[#0084FF] hover:underline flex items-center gap-1 cursor-pointer"
              >
                Open Full Interactive Drawer →
              </button>
            </div>
          </div>

        </div>
      </div>
    </section>
  );
}
