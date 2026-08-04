import React, { useState } from 'react';
import Navbar from './components/Navbar';
import HeroSection from './components/HeroSection';
import FeaturesSection from './components/FeaturesSection';
import InteractivePlaygroundSection from './components/InteractivePlaygroundSection';
import PricingSection from './components/PricingSection';
import Footer from './components/Footer';
import TryAssistModal from './components/TryAssistModal';
import FeatureModal from './components/FeatureModal';
import CompanyModal from './components/CompanyModal';
import GetStartedModal from './components/GetStartedModal';
import WatchDemoModal from './components/WatchDemoModal';

export default function App() {
  const [isTryModalOpen, setIsTryModalOpen] = useState(false);
  const [isFeatureModalOpen, setIsFeatureModalOpen] = useState(false);
  const [isCompanyModalOpen, setIsCompanyModalOpen] = useState(false);
  const [isGetStartedModalOpen, setIsGetStartedModalOpen] = useState(false);
  const [isDemoModalOpen, setIsDemoModalOpen] = useState(false);
  const [activeFeatureId, setActiveFeatureId] = useState('transcription');
  const [initialPrompt, setInitialPrompt] = useState('');

  const handleOpenTryModal = (prompt = '') => {
    setInitialPrompt(prompt);
    setIsTryModalOpen(true);
  };

  const handleOpenFeatureModal = (featureId = 'transcription') => {
    setActiveFeatureId(featureId);
    setIsFeatureModalOpen(true);
  };

  return (
    <div className="min-h-screen bg-white text-[#171717] font-sans antialiased selection:bg-[#0084FF]/20 selection:text-[#0084FF] relative overflow-x-hidden">
      {/* Floating Liquid-Glass Navigation Bar */}
      <Navbar
        onOpenTryModal={() => handleOpenTryModal('')}
        onOpenGetStartedModal={() => setIsGetStartedModalOpen(true)}
        onOpenCompanyModal={() => setIsCompanyModalOpen(true)}
      />

      {/* Main Content */}
      <main>
        {/* Section 1: Hero Landing Page matching exact 8-badge layout */}
        <HeroSection
          onOpenTryModal={() => handleOpenTryModal('')}
          onOpenFeatureModal={handleOpenFeatureModal}
        />

        {/* Section 2: Features Showcase */}
        <FeaturesSection
          onOpenTryModal={() => handleOpenTryModal('')}
        />

        {/* Section 3: Live In-Page Interactive Playground */}
        <InteractivePlaygroundSection
          onOpenTryModal={() => handleOpenTryModal('')}
        />

        {/* Section 4: Interactive Pricing Calculator */}
        <PricingSection
          onOpenTryModal={() => handleOpenTryModal('')}
        />
      </main>

      {/* Footer */}
      <Footer
        onOpenTryModal={() => handleOpenTryModal('')}
      />

      {/* MODAL 1: Interactive Try Assist AI Playground Drawer */}
      <TryAssistModal
        isOpen={isTryModalOpen}
        onClose={() => setIsTryModalOpen(false)}
        initialPrompt={initialPrompt}
      />

      {/* MODAL 2: Interactive 8 Feature Showcase Modal */}
      <FeatureModal
        isOpen={isFeatureModalOpen}
        onClose={() => setIsFeatureModalOpen(false)}
        activeFeatureId={activeFeatureId}
      />

      {/* MODAL 3: Company Overview Modal */}
      <CompanyModal
        isOpen={isCompanyModalOpen}
        onClose={() => setIsCompanyModalOpen(false)}
      />

      {/* MODAL 4: Onboarding Get Started Modal */}
      <GetStartedModal
        isOpen={isGetStartedModalOpen}
        onClose={() => setIsGetStartedModalOpen(false)}
      />

      {/* MODAL 5: HD Product Video Modal */}
      <WatchDemoModal
        isOpen={isDemoModalOpen}
        onClose={() => setIsDemoModalOpen(false)}
      />
    </div>
  );
}
