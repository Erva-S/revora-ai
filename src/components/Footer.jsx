import React, { useState } from 'react';
import { Bot, ArrowRight, Check, Heart } from 'lucide-react';

export default function Footer({ onOpenTryModal }) {
  const [email, setEmail] = useState('');
  const [subscribed, setSubscribed] = useState(false);

  const handleSubscribe = (e) => {
    e.preventDefault();
    if (email.trim()) {
      setSubscribed(true);
      setEmail('');
      setTimeout(() => setSubscribed(false), 4000);
    }
  };

  return (
    <footer className="w-full bg-neutral-900 text-white pt-16 pb-12 border-t border-white/10">
      <div className="w-full max-w-[1280px] mx-auto px-6 sm:px-12 lg:px-20">
        
        {/* Top CTA Banner inside Footer */}
        <div className="mb-16 p-8 sm:p-12 rounded-[28px] bg-gradient-to-r from-[#0084FF] to-[#0066CC] flex flex-col md:flex-row items-center justify-between gap-8 shadow-2xl relative overflow-hidden">
          <div className="relative z-10 max-w-[560px] text-center md:text-left">
            <h3 className="font-outfit font-black text-[28px] sm:text-[36px] text-white leading-tight">
              Ready to transform how you work with Revora?
            </h3>
            <p className="font-sans text-[15px] text-white/80 mt-2">
              Join 10,000+ teams automating communications and daily tasks today.
            </p>
          </div>

          <button
            onClick={onOpenTryModal}
            className="relative z-10 px-8 py-4 rounded-[18px] bg-white text-[#0084FF] font-bold text-base hover:bg-neutral-100 transition-all hover:scale-105 shadow-xl cursor-pointer shrink-0 flex items-center gap-3"
          >
            <span>Try Revora. Free</span>
            <ArrowRight className="w-4 h-4 stroke-[3px]" />
          </button>

          {/* Background ambient pattern */}
          <div className="absolute -right-10 -bottom-10 w-80 h-80 bg-white/10 rounded-full blur-2xl pointer-events-none" />
        </div>

        {/* Links Grid */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-10 pb-12 border-b border-white/10">
          {/* Brand Col (4 cols) */}
          <div className="md:col-span-4 flex flex-col gap-4">
            <div className="font-fustat font-extrabold text-[24px] tracking-tight text-white flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-[#0084FF] flex items-center justify-center text-white">
                <Bot className="w-5 h-5" />
              </div>
              <span>Revora.</span>
            </div>

            <p className="font-sans text-[14px] text-neutral-400 max-w-[320px] leading-relaxed">
              Ultra-high-fidelity corporate AI digital companion. Streamlining emails, document summaries, and task automation.
            </p>

            {/* System Status indicator */}
            <div className="flex items-center gap-2 mt-2 text-xs text-neutral-400">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>All Systems Operational (99.99% Uptime)</span>
            </div>
          </div>

          {/* Links 1 */}
          <div className="md:col-span-2">
            <div className="font-outfit font-bold text-sm text-white uppercase tracking-wider mb-4">
              Product
            </div>
            <ul className="space-y-2.5 font-sans text-xs text-neutral-400">
              <li><a href="#features" className="hover:text-white transition-colors">Features</a></li>
              <li><a href="#demo" className="hover:text-white transition-colors">Interactive Demo</a></li>
              <li><a href="#pricing" className="hover:text-white transition-colors">Pricing Plans</a></li>
              <li><a href="#features" className="hover:text-white transition-colors">Enterprise AI</a></li>
              <li><a href="#features" className="hover:text-white transition-colors">Integrations</a></li>
            </ul>
          </div>

          {/* Links 2 */}
          <div className="md:col-span-2">
            <div className="font-outfit font-bold text-sm text-white uppercase tracking-wider mb-4">
              Company
            </div>
            <ul className="space-y-2.5 font-sans text-xs text-neutral-400">
              <li><a href="#" className="hover:text-white transition-colors">About Us</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Careers</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Press & Media</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Privacy Policy</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Terms of Service</a></li>
            </ul>
          </div>

          {/* Newsletter (4 cols) */}
          <div className="md:col-span-4">
            <div className="font-outfit font-bold text-sm text-white uppercase tracking-wider mb-4">
              Stay Updated
            </div>
            <p className="font-sans text-xs text-neutral-400 mb-4">
              Subscribe to get latest product updates, AI tips, and liquid glass feature releases.
            </p>

            <form onSubmit={handleSubscribe} className="flex gap-2">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your work email..."
                className="flex-1 px-4 py-2.5 rounded-[12px] bg-white/10 border border-white/15 text-xs text-white placeholder:text-neutral-500 focus:outline-none focus:border-[#0084FF]"
              />
              <button
                type="submit"
                className="px-4 py-2.5 rounded-[12px] bg-[#0084FF] hover:bg-[#0074E0] text-white font-bold text-xs transition-colors cursor-pointer"
              >
                Join
              </button>
            </form>

            {subscribed && (
              <div className="mt-2 text-xs text-emerald-400 font-medium flex items-center gap-1">
                <Check className="w-3.5 h-3.5" /> Thank you for subscribing!
              </div>
            )}
          </div>
        </div>

        {/* Bottom Copyright */}
        <div className="pt-8 flex flex-col sm:flex-row items-center justify-between text-xs text-neutral-500 font-sans gap-4">
          <div>
            © {new Date().getFullYear()} Revora Inc. All rights reserved. Designed with ultra-high fidelity visual principles.
          </div>

          <div className="flex items-center gap-4">
            <a href="#" className="hover:text-white transition-colors">Security</a>
            <a href="#" className="hover:text-white transition-colors">Cookies</a>
            <a href="#" className="hover:text-white transition-colors">Status</a>
          </div>
        </div>

      </div>
    </footer>
  );
}
