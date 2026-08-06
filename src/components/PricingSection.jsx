import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Sparkles, ArrowRight, Zap, ShieldCheck } from 'lucide-react';

export default function PricingSection({ onOpenTryModal }) {
  const [isAnnual, setIsAnnual] = useState(true);

  const plans = [
    {
      name: 'Starter',
      description: 'Ideal for individuals and creators exploring AI assistance.',
      monthlyPrice: '$19',
      annualPrice: '$15',
      features: [
        '5,000 AI executions per month',
        'Standard liquid-glass companion',
        'Email & document summarization',
        '3 device sync',
        'Community support',
      ],
      cta: 'Start Free Trial',
      popular: false,
    },
    {
      name: 'Pro Revora',
      description: 'Perfect for power users and fast-growing professional teams.',
      monthlyPrice: '$49',
      annualPrice: '$39',
      features: [
        'Unlimited AI executions',
        'Full liquid-glass companion customization',
        'Autonomous multi-step workflow builder',
        '100+ native integrations (Slack, Jira, Figma)',
        'Unlimited device sync',
        'Priority 24/7 support',
      ],
      cta: 'Get Started with Pro',
      popular: true,
    },
    {
      name: 'Enterprise',
      description: 'Dedicated infrastructure, custom SLAs, and neural privacy.',
      monthlyPrice: '$129',
      annualPrice: '$99',
      features: [
        'Dedicated custom neural models',
        'SOC2 Type II & HIPAA compliance',
        'On-premise / private cloud deployment',
        'Custom SSO & SAML authentication',
        'Dedicated Success Manager',
        'Custom API limits',
      ],
      cta: 'Contact Enterprise Sales',
      popular: false,
    },
  ];

  return (
    <section id="pricing" className="relative w-full py-20 bg-white border-t border-black/5">
      <div className="w-full max-w-[1280px] mx-auto px-6 sm:px-12 lg:px-20">
        
        {/* Header */}
        <div className="flex flex-col items-center text-center max-w-[700px] mx-auto mb-12">
          <span className="px-3.5 py-1.5 rounded-full bg-black/5 text-black/80 text-xs font-bold mb-3">
            Transparent Pricing
          </span>
          <h2 className="font-outfit font-extrabold text-[32px] sm:text-[42px] text-black tracking-tight leading-tight">
            Simple, predictable plans for every workflow.
          </h2>
          <p className="font-sans text-[17px] text-black/60 mt-3">
            Start with a 14-day free trial. No credit card required.
          </p>

          {/* Monthly / Annual Billing Toggle */}
          <div className="mt-8 flex items-center gap-3 p-1.5 bg-neutral-100 rounded-full border border-black/10">
            <button
              onClick={() => setIsAnnual(false)}
              className={`px-5 py-2 rounded-full text-xs font-bold transition-all cursor-pointer ${
                !isAnnual ? 'bg-white text-black shadow-xs' : 'text-black/60 hover:text-black'
              }`}
            >
              Monthly Billing
            </button>
            <button
              onClick={() => setIsAnnual(true)}
              className={`px-5 py-2 rounded-full text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                isAnnual ? 'bg-[#0084FF] text-white shadow-md' : 'text-black/60 hover:text-black'
              }`}
            >
              <span>Annual Billing</span>
              <span className="px-2 py-0.5 rounded-full bg-white/20 text-[10px] font-extrabold text-white uppercase">
                Save 20%
              </span>
            </button>
          </div>
        </div>

        {/* Pricing Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-stretch">
          {plans.map((plan, idx) => (
            <motion.div
              key={plan.name}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: idx * 0.1 }}
              whileHover={{ y: -6 }}
              className={`relative p-8 rounded-[28px] flex flex-col justify-between transition-all duration-300 ${
                plan.popular
                  ? 'bg-gradient-to-b from-white to-sky-50/40 border-2 border-[#0084FF] shadow-[0_20px_50px_rgba(0,132,255,0.15)] ring-4 ring-[#0084FF]/10'
                  : 'bg-white border border-black/10 hover:border-black/20 shadow-xs hover:shadow-lg'
              }`}
            >
              {plan.popular && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-[#0084FF] text-white text-[11px] font-extrabold tracking-wider uppercase shadow-md flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> Most Popular Choice
                </div>
              )}

              <div>
                <h3 className="font-outfit font-extrabold text-[22px] text-black mb-2">
                  {plan.name}
                </h3>
                <p className="font-sans text-[13px] text-black/60 min-h-[38px] leading-relaxed">
                  {plan.description}
                </p>

                <div className="my-6 flex items-baseline gap-1">
                  <span className="font-outfit font-black text-[44px] text-black tracking-tight">
                    {isAnnual ? plan.annualPrice : plan.monthlyPrice}
                  </span>
                  <span className="font-sans text-sm text-black/50 font-semibold">/ month</span>
                </div>

                <div className="space-y-3 pt-4 border-t border-black/5 mb-8">
                  {plan.features.map((feature, fIdx) => (
                    <div key={fIdx} className="flex items-start gap-3">
                      <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center text-green-600 shrink-0 mt-0.5">
                        <Check className="w-3.5 h-3.5 stroke-[3px]" />
                      </div>
                      <span className="font-sans text-[14px] text-black/80 font-medium leading-tight">
                        {feature}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <button
                onClick={onOpenTryModal}
                className={`w-full py-3.5 px-6 rounded-[16px] font-bold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer ${
                  plan.popular
                    ? 'bg-[#0084FF] hover:bg-[#0074E0] text-white shadow-lg shadow-primary-btn hover:scale-102'
                    : 'bg-black hover:bg-neutral-800 text-white shadow-xs'
                }`}
              >
                <span>{plan.cta}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </motion.div>
          ))}
        </div>

      </div>
    </section>
  );
}
