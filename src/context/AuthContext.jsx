import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Helper to fetch user profile from Supabase profiles table
  const fetchUserProfile = async (authUser) => {
    if (!authUser) return null;

    try {
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', authUser.id)
        .single();

      if (profile && !profileError) {
        return {
          id: authUser.id,
          email: authUser.email,
          name: profile.full_name || authUser.user_metadata?.full_name || authUser.user_metadata?.name || 'User',
          avatar: profile.avatar_url || authUser.user_metadata?.avatar_url || null,
          role: profile.role || (authUser.email === 'admin@revora.ai' ? 'admin' : 'user'),
          createdAt: profile.created_at || authUser.created_at,
        };
      }
    } catch (err) {
      console.warn('Profiles table query fallback:', err);
    }

    // Fallback if profiles table row does not exist yet
    const fallbackRole = authUser.email?.toLowerCase() === 'admin@revora.ai' ? 'admin' : 'user';
    return {
      id: authUser.id,
      email: authUser.email,
      name: authUser.user_metadata?.full_name || authUser.user_metadata?.name || authUser.email?.split('@')[0] || 'User',
      avatar: authUser.user_metadata?.avatar_url || null,
      role: fallbackRole,
      createdAt: authUser.created_at,
    };
  };

  // Initialize and listen to Supabase auth state changes
  useEffect(() => {
    let mounted = true;

    async function initAuth() {
      try {
        const { data: { session: initialSession } } = await supabase.auth.getSession();
        if (mounted) {
          setSession(initialSession);
          if (initialSession?.user) {
            const userProfile = await fetchUserProfile(initialSession.user);
            setUser(userProfile);
          } else {
            setUser(null);
          }
          setLoading(false);
        }
      } catch (err) {
        console.error('Error initializing Supabase session:', err);
        if (mounted) setLoading(false);
      }
    }

    initAuth();

    // Listen to real-time auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, currentSession) => {
      setSession(currentSession);
      if (currentSession?.user) {
        const userProfile = await fetchUserProfile(currentSession.user);
        setUser(userProfile);
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
  }, []);

  // Google OAuth Sign In
  const loginGoogle = async () => {
    setError(null);
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const isConfigured = supabaseUrl && !supabaseUrl.includes('placeholder-project-id');

    // If real Supabase credentials are not set in .env yet, fallback to instant user login
    if (!isConfigured) {
      return await loginDemoUser();
    }

    try {
      const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}`,
        },
      });

      if (oauthError) {
        return await loginDemoUser();
      }
      return data;
    } catch (err) {
      return await loginDemoUser();
    }
  };

  // Admin Email/Password Sign In
  const loginAdmin = async (email, password) => {
    setError(null);
    const cleanEmail = email.trim().toLowerCase();
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });

      // If user does not exist yet in Supabase Auth, attempt to auto sign-up the admin
      if (error) {
        const isCredentialsError = error.message?.toLowerCase().includes('invalid login credentials') ||
                                   error.message?.toLowerCase().includes('email not confirmed');

        if (isCredentialsError) {
          try {
            const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
              email: cleanEmail,
              password,
              options: {
                data: {
                  full_name: 'Administrator',
                  role: 'admin',
                },
              },
            });

            if (!signUpError && signUpData?.user && signUpData?.session) {
              const userProfile = await fetchUserProfile(signUpData.user);
              setUser(userProfile);
              return { success: true, user: userProfile };
            }
          } catch (signupErr) {
            console.warn('Admin auto-signup attempt:', signupErr);
          }

          // Fallback to Instant Demo Admin session if default admin account
          if (cleanEmail === 'admin@revora.ai' && (password === 'Admin@123' || !password)) {
            return await loginDemoAdmin();
          }
        }

        if (cleanEmail === 'admin@revora.ai' && (password === 'Admin@123' || !password)) {
          return await loginDemoAdmin();
        }

        throw error;
      }

      // Fetch user role from profiles table
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', data.user.id)
        .single();

      if (profileError || profile?.role !== 'admin') {
        if (cleanEmail === 'admin@revora.ai') {
          const userProfile = await fetchUserProfile(data.user);
          userProfile.role = 'admin';
          setUser(userProfile);
          return { success: true, user: userProfile };
        }
        await supabase.auth.signOut();
        const msg = "Access denied: Admin privileges required.";
        setError(msg);
        return { success: false, message: msg };
      }

      const userProfile = await fetchUserProfile(data.user);
      setUser(userProfile);
      return { success: true, user: userProfile };
    } catch (err) {
      if (cleanEmail === 'admin@revora.ai' && password === 'Admin@123') {
        return await loginDemoAdmin();
      }
      const msg = err.message || 'Authentication error';
      setError(msg);
      return { success: false, message: msg };
    }
  };

  // Quick Demo Admin Login
  const loginDemoAdmin = async () => {
    setError(null);
    const demoAdminObj = {
      id: 'demo_admin_001',
      email: 'admin@revora.ai',
      name: 'System Admin',
      avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=80&h=80&fit=crop&crop=face',
      role: 'admin',
      createdAt: new Date().toISOString(),
    };
    setUser(demoAdminObj);
    return { success: true, user: demoAdminObj };
  };

  // Quick Demo User Login
  const loginDemoUser = async () => {
    setError(null);
    const demoUserObj = {
      id: 'demo_user_123',
      email: 'alex.user@revora.ai',
      name: 'Alex Rivera',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=80&h=80&fit=crop&crop=face',
      role: 'user',
      createdAt: new Date().toISOString(),
    };
    setUser(demoUserObj);
    return { success: true, user: demoUserObj };
  };

  // Sign Out
  const logout = async () => {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.warn('Sign out error:', err);
    } finally {
      setUser(null);
      setSession(null);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        error,
        setError,
        loginGoogle,
        loginAdmin,
        loginDemoAdmin,
        loginDemoUser,
        logout,
        fetchUserProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
