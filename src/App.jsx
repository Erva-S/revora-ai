import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
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

function LandingPage({ isLoginRoute = false }) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [isTryModalOpen, setIsTryModalOpen] = useState(false);
  const [isFeatureModalOpen, setIsFeatureModalOpen] = useState(false);
  const [isCompanyModalOpen, setIsCompanyModalOpen] = useState(false);
  const [isGetStartedModalOpen, setIsGetStartedModalOpen] = useState(false);
  const [isDemoModalOpen, setIsDemoModalOpen] = useState(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(isLoginRoute);
  const [activeFeatureId, setActiveFeatureId] = useState('transcription');
  const [initialPrompt, setInitialPrompt] = useState('');

  // Handle URL query parameters (e.g. ?try=true)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('try') === 'true') {
      setIsTryModalOpen(true);
    }
  }, [location.search]);

  // Keep login modal open if on /login route and unauthenticated
  useEffect(() => {
    if (isLoginRoute && !user && !loading) {
      setIsLoginModalOpen(true);
    }
  }, [isLoginRoute, user, loading]);

  // Handle post-OAuth redirect if an intent was stored
  useEffect(() => {
    if (user && !loading) {
      const intent = sessionStorage.getItem('revora_auth_intent');
      if (intent) {
        sessionStorage.removeItem('revora_auth_intent');
        if (intent === 'admin' && user.role === 'admin') {
          navigate('/admin-dashboard', { replace: true });
        } else {
          navigate('/dashboard', { replace: true });
        }
      }
    }
  }, [user, loading, navigate]);

  // If authenticated user visits /login, redirect to /dashboard
  if (isLoginRoute && user && !loading) {
    return <Navigate to={user.role === 'admin' ? '/admin-dashboard' : '/dashboard'} replace />;
  }

  const handleOpenTryModal = (prompt = '') => {
    setInitialPrompt(prompt);
    setIsTryModalOpen(true);
  };

  const handleOpenFeatureModal = (featureId = 'transcription') => {
    setActiveFeatureId(featureId);
    setIsFeatureModalOpen(true);
  };

  const handleNavigateDashboard = () => {
    if (user?.role === 'admin') {
      navigate('/admin-dashboard');
    } else if (user) {
      navigate('/dashboard');
    } else {
      setIsLoginModalOpen(true);
    }
  };

  const handleLoginSuccess = (authenticatedUser) => {
    setIsLoginModalOpen(false);
    if (authenticatedUser?.role === 'admin') {
      navigate('/admin-dashboard');
    } else {
      navigate('/dashboard');
    }
  };

  const handleCloseLoginModal = () => {
    setIsLoginModalOpen(false);
    if (isLoginRoute) {
      navigate('/');
    }
  };

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
      <main id="home">
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

      {/* MODAL 6: Authentication Modal */}
      <LoginModal
        isOpen={isLoginModalOpen}
        onClose={handleCloseLoginModal}
        onSuccessRedirect={handleLoginSuccess}
      />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* Public Landing Page */}
        <Route path="/" element={<LandingPage />} />

        {/* Dedicated /login route -> opens authentication or redirects to dashboard */}
        <Route path="/login" element={<LandingPage isLoginRoute={true} />} />

        {/* User Dashboard Overview */}
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <UserDashboard />
            </ProtectedRoute>
          }
        />

        {/* Meetings Feed & Direct Meeting URL (/meetings/:id or /meeting/:id) */}
        <Route
          path="/meetings"
          element={
            <ProtectedRoute>
              <UserDashboard defaultTab="meetings" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/meetings/:id"
          element={
            <ProtectedRoute>
              <UserDashboard defaultTab="meetings" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/meeting/:id"
          element={
            <ProtectedRoute>
              <UserDashboard defaultTab="meetings" />
            </ProtectedRoute>
          }
        />

        {/* Settings & Profile Pages */}
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <UserDashboard defaultTab="settings" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <UserDashboard defaultTab="profile" />
            </ProtectedRoute>
          }
        />

        {/* Protected Admin Control Center */}
        <Route
          path="/admin"
          element={
            <ProtectedRoute adminOnly={true}>
              <AdminDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin-dashboard"
          element={
            <ProtectedRoute adminOnly={true}>
              <AdminDashboard />
            </ProtectedRoute>
          }
        />
        {/* Admin meeting management lives on the same control center screen */}
        <Route
          path="/admin/meetings"
          element={
            <ProtectedRoute adminOnly={true}>
              <AdminDashboard />
            </ProtectedRoute>
          }
        />

        {/* Fallback Catch-all -> Redirect to / */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}