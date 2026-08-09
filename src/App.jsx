import React, { useState, useEffect } from 'react';
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
  const { user, loading } = useAuth();
  
  // Initialize view from localStorage if available, or default to 'home'
  const [currentView, setCurrentView] = useState(() => {
    return localStorage.getItem('revora_current_view') || 'home';
  });

  const [isTryModalOpen, setIsTryModalOpen] = useState(false);
  const [isFeatureModalOpen, setIsFeatureModalOpen] = useState(false);
  const [isCompanyModalOpen, setIsCompanyModalOpen] = useState(false);
  const [isGetStartedModalOpen, setIsGetStartedModalOpen] = useState(false);
  const [isDemoModalOpen, setIsDemoModalOpen] = useState(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [activeFeatureId, setActiveFeatureId] = useState('transcription');
  const [initialPrompt, setInitialPrompt] = useState('');

  // 1. Keep view state in sync with authenticated user on reload/mount
  useEffect(() => {
    if (user) {
      const targetView = user.role === 'admin' ? 'admin-dashboard' : 'dashboard';
      setCurrentView(targetView);
      localStorage.setItem('revora_current_view', targetView);
    } else {
      setCurrentView('home');
      localStorage.removeItem('revora_current_view');
    }
  }, [user]);

  // Helper to safely navigate views and persist state
  const changeView = (view) => {
    setCurrentView(view);
    localStorage.setItem('revora_current_view', view);
  };

  const handleOpenTryModal = (prompt = '') => {
    setInitialPrompt(prompt);
    setIsTryModalOpen(true);
  };

  const handleOpenFeatureModal = (featureId = 'transcription') => {
    setActiveFeatureId(featureId);
    setIsFeatureModalOpen(true);
  };

  const handleNavigateDashboard = async () => {
    if (!user) {
      const res = await loginDemoUser();
      if (res?.user?.role === 'admin') {
        setCurrentView('admin-dashboard');
      } else {
        setCurrentView('dashboard');
      }
      return;
    }
    if (user.role === 'admin') {
      changeView('admin-dashboard');
    } else {
      changeView('dashboard');
    }
  };

  const handleLoginSuccess = (authenticatedUser) => {
    if (authenticatedUser?.role === 'admin') {
      changeView('admin-dashboard');
    } else {
      changeView('dashboard');
    }
  };

  // Prevent UI flickering while context loads
  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-900 text-white flex items-center justify-center font-sans">
        <div className="text-xs font-mono text-neutral-400 animate-pulse">
          Restoring session...
        </div>
      </div>
    );
  }

  // Render Protected Dashboards when view state changes
  if (currentView === 'dashboard' && user) {
    return (
      <UserDashboard
        onNavigateHome={() => changeView('home')}
        onOpenTryModal={() => handleOpenTryModal('')}
      />
    );
  }

  if (currentView === 'admin-dashboard' && user) {
    return (
      <AdminDashboard
        onNavigateHome={() => changeView('home')}
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

      {/* MODAL 1: Interactive Try Revora AI Playground Drawer */}
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

      {/* MODAL 6: Unified Passport.js Login Modal */}
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