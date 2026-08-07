import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
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
import LoginModal from './components/LoginModal';
import UserDashboard from './pages/UserDashboard';
import AdminDashboard from './pages/AdminDashboard';

function MainApp() {
  const { user } = useAuth();
  const [currentView, setCurrentView] = useState('home'); // 'home' | 'dashboard' | 'admin-dashboard'
  const [isTryModalOpen, setIsTryModalOpen] = useState(false);
  const [isFeatureModalOpen, setIsFeatureModalOpen] = useState(false);
  const [isCompanyModalOpen, setIsCompanyModalOpen] = useState(false);
  const [isGetStartedModalOpen, setIsGetStartedModalOpen] = useState(false);
  const [isDemoModalOpen, setIsDemoModalOpen] = useState(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
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

  const handleNavigateDashboard = () => {
    if (!user) {
      setIsLoginModalOpen(true);
      return;
    }
    if (user.role === 'admin') {
      setCurrentView('admin-dashboard');
    } else {
      setCurrentView('dashboard');
    }
  };

  const handleLoginSuccess = (authenticatedUser) => {
    if (authenticatedUser?.role === 'admin') {
      setCurrentView('admin-dashboard');
    } else {
      setCurrentView('dashboard');
    }
  };

  // Render Protected Dashboards when view state changes
  if (currentView === 'dashboard') {
    return (
      <UserDashboard
        onNavigateHome={() => setCurrentView('home')}
        onOpenTryModal={() => handleOpenTryModal('')}
      />
    );
  }

  if (currentView === 'admin-dashboard') {
    return (
      <AdminDashboard
        onNavigateHome={() => setCurrentView('home')}
      />
    );
  }

  // Render Main Landing Page
  return (
    <div className="min-h-screen bg-white text-[#171717] font-sans antialiased selection:bg-[#0084FF]/20 selection:text-[#0084FF] relative overflow-x-hidden">
      {/* Floating Liquid-Glass Navigation Bar */}
      <Navbar
        onOpenTryModal={() => handleOpenTryModal('')}
        onOpenGetStartedModal={() => setIsGetStartedModalOpen(true)}
        onOpenCompanyModal={() => setIsCompanyModalOpen(true)}
        onOpenLoginModal={() => setIsLoginModalOpen(true)}
        onNavigateDashboard={handleNavigateDashboard}
      />

      {/* Main Content */}
      <main>
        {/* Section 1: Hero Landing Page */}
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

      {/* MODAL 6: Unified Passport.js Login Modal (Google OAuth + Admin Local Strategy) */}
      <LoginModal
        isOpen={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
        onSuccessRedirect={handleLoginSuccess}
      />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <MainApp />
    </AuthProvider>
  );
}