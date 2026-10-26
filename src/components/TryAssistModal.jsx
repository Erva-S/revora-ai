import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Send, Bot, Sparkles, Copy, Check, PenLine, FileText, CheckSquare, RefreshCw, Zap } from 'lucide-react';
import confetti from 'canvas-confetti';

export default function TryAssistModal({ isOpen, onClose, initialPrompt = '' }) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState(null);

  useEffect(() => {
    if (initialPrompt) {
      setPrompt(initialPrompt);
      handleGenerate(initialPrompt);
    } else if (isOpen && messages.length === 0) {
      setMessages([
        {
          role: 'assistant',
          content: 'Hello! I am **Revora.**, your AI companion. Select a quick preset below or type any question or task to get started!',
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    }
  }, [isOpen, initialPrompt]);

  const presetQueries = [
    {
      title: 'Write an email',
      icon: PenLine,
      color: 'from-[#0084FF] to-[#0066CC]',
      prompt: 'Write a professional email for meeting with the product team regarding the Q3 roadmap',
    },
    {
      title: 'Summarize document',
      icon: FileText,
      color: 'from-[#10B981] to-[#059669]',
      prompt: 'Summarize this document: Key findings from our 2026 AI Product Adoption & Enterprise Benchmark Report',
    },
    {
      title: 'Generate task list',
      icon: CheckSquare,
      color: 'from-[#9333EA] to-[#7E22CE]',
      prompt: 'Create a prioritized to-do list for today focusing on engineering and architecture',
    },
  ];

  const handleGenerate = async (customText) => {
    const textToSubmit = customText || prompt;
    if (!textToSubmit.trim()) return;

    const userMessage = {
      role: 'user',
      content: textToSubmit,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMessage]);
    setPrompt('');
    setIsLoading(true);

    // Simulate realistic AI generation speed
    setTimeout(() => {
      let responseText = '';
      const lower = textToSubmit.toLowerCase();

      if (lower.includes('email')) {
        responseText = `Subject: Q3 Roadmap Sync & Strategy Alignment\n\nHi Product Team,\n\nI hope you're having a productive week. I would like to schedule a 30-minute sync to review our proposed Q3 product roadmap features, engineering milestones, and resource allocation.\n\nProposed Agenda:\n1. Q3 High-Priority Deliverables & Timelines\n2. Technical Dependencies & API Integrations\n3. Q&A & Resource Allocation\n\nPlease let me know your availability for tomorrow morning.\n\nBest regards,\nRevora AI Automated Workspace`;
      } else if (lower.includes('summarize')) {
        responseText = `Executive Summary — 2026 AI Product Adoption Report:\n\n• Key Finding 1: 87% of enterprise organizations report a 4.2x increase in workflow efficiency after deploying autonomous AI assistants.\n• Key Finding 2: Response times for multi-step document processing decreased from 45 minutes to under 8 seconds.\n• Key Finding 3: Security & privacy compliance remain top criteria, with 99.99% neural encryption adoption rate.\n\nRecommendation: Accelerate deployment of liquid-glass UI models across enterprise teams.`;
      } else if (lower.includes('to-do') || lower.includes('todo') || lower.includes('list')) {
        responseText = `Today's Action Items & Prioritized Tasks:\n\n[High Priority]\n✓ 1. Review and approve Q3 Engineering Architecture Spec\n✓ 2. Finalize UI liquid-glass component styling and responsive layout\n\n[Medium Priority]\n✓ 3. Conduct 2:00 PM team sync on AI agent integration\n✓ 4. Verify end-to-end security compliance audit\n\n[Low Priority]\n✓ 5. Update developer documentation & release notes`;
      } else {
        responseText = `Here is your requested output for: "${textToSubmit}"\n\nRevora AI has processed your query with zero-latency streaming. All parameters are optimized for maximum accuracy and efficiency. Let me know if you would like me to refine or export this output!`;
      }

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: responseText,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
      setIsLoading(false);

      // Trigger celebratory confetti effect on first successful completion!
      confetti({
        particleCount: 40,
        spread: 60,
        origin: { y: 0.6 },
        colors: ['#0084FF', '#10B981', '#9333EA', '#60B1FF'],
      });
    }, 900);
  };

  const handleCopy = (text, index) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

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
          className="fixed inset-0 bg-black/40 backdrop-blur-md"
        />

        {/* Modal Window */}
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 220 }}
          className="relative w-full max-w-[760px] h-[85vh] max-h-[700px] bg-white/90 backdrop-blur-[30px] border border-white/80 rounded-[28px] shadow-[0_25px_70px_rgba(0,132,255,0.15)] flex flex-col z-10 overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-black/5 bg-white/50">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0">
                <img src="/revora-icon.png" alt="Revora" className="w-9 h-9 object-contain" />
              </div>
              <div>
                <h3 className="font-outfit font-bold text-[18px] text-black leading-tight flex items-center gap-2">
                  Revora AI Live Playground
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#0084FF]/10 text-[#0084FF] border border-[#0084FF]/20">
                    Interactive Demo
                  </span>
                </h3>
                <p className="font-sans text-[12px] text-black/50">
                  Experience real-time AI automation and instant response generation
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

          {/* Quick Presets */}
          <div className="px-6 py-3 bg-black/[0.02] border-b border-black/5 flex gap-2 overflow-x-auto no-scrollbar">
            {presetQueries.map((item, idx) => {
              const Icon = item.icon;
              return (
                <button
                  key={idx}
                  onClick={() => handleGenerate(item.prompt)}
                  className="px-3.5 py-1.5 rounded-xl bg-white border border-black/10 hover:border-[#0084FF]/40 text-xs font-semibold text-black/80 hover:text-black flex items-center gap-2 shadow-xs transition-all hover:scale-102 shrink-0 cursor-pointer"
                >
                  <div className={`w-4 h-4 rounded-md bg-gradient-to-br ${item.color} flex items-center justify-center text-white`}>
                    <Icon className="w-2.5 h-2.5" />
                  </div>
                  <span>{item.title}</span>
                </button>
              );
            })}
          </div>

          {/* Chat Messages */}
          <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-4">
            {messages.map((msg, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex gap-3 max-w-[88%] ${msg.role === 'user' ? 'ml-auto flex-row-reverse' : ''}`}
              >
                <div
                  className={`w-8 h-8 rounded-xl shrink-0 flex items-center justify-center text-white text-xs font-bold ${
                    msg.role === 'user'
                      ? 'bg-neutral-800'
                      : 'bg-gradient-to-br from-[#0084FF] to-[#0066CC] shadow-xs'
                  }`}
                >
                  {msg.role === 'user' ? 'You' : <img src="/revora-icon.png" alt="Revora" className="w-5 h-5 object-contain" />}
                </div>

                <div className="group relative">
                  <div
                    className={`p-4 rounded-[20px] text-sm leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-[#0084FF] text-white rounded-tr-xs shadow-md font-medium'
                        : 'bg-white/80 border border-black/5 text-neutral-800 rounded-tl-xs shadow-xs font-sans whitespace-pre-wrap'
                    }`}
                  >
                    {msg.content}
                  </div>

                  <div className="flex items-center justify-between gap-2 mt-1 px-1">
                    <span className="text-[10px] text-black/40 font-mono">{msg.time}</span>
                    {msg.role === 'assistant' && (
                      <button
                        onClick={() => handleCopy(msg.content, i)}
                        className="text-[11px] font-semibold text-[#0084FF] hover:underline flex items-center gap-1 opacity-80 hover:opacity-100 cursor-pointer"
                      >
                        {copiedIndex === i ? (
                          <>
                            <Check className="w-3 h-3" /> Copied!
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" /> Copy text
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}

            {isLoading && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-center gap-3"
              >
                <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0">
                  <img src="/revora-icon.png" alt="Revora" className="w-6 h-6 object-contain" />
                </div>
                <div className="px-4 py-3 rounded-[20px] rounded-tl-xs bg-white border border-black/5 text-xs text-black/60 flex items-center gap-2 shadow-xs">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#0084FF]" />
                  <span>Revora AI is thinking and generating response...</span>
                </div>
              </motion.div>
            )}
          </div>

          {/* Input Footer */}
          <div className="p-4 bg-white/70 border-t border-black/5 flex items-center gap-3">
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
              placeholder="Ask Revora AI anything or type a prompt..."
              className="flex-1 px-4 py-3 rounded-[16px] bg-black/5 border border-black/10 focus:border-[#0084FF] focus:bg-white text-sm font-sans text-black focus:outline-none transition-all placeholder:text-black/40"
            />
            <button
              onClick={() => handleGenerate()}
              disabled={isLoading || !prompt.trim()}
              className="h-11 px-5 rounded-[16px] bg-[#0084FF] hover:bg-[#0074E0] disabled:opacity-50 text-white font-bold text-sm flex items-center gap-2 shadow-md transition-all cursor-pointer"
            >
              <span>Send</span>
              <Send className="w-4 h-4" />
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
