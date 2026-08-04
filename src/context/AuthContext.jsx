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
          role: profile.role || (authUser.email === 'admin@assist.ai' ? 'admin' : 'user'),
          createdAt: profile.created_at || authUser.created_at,
        };
      }
    } catch (err) {
      console.warn('Profiles table query fallback:', err);
    }

    // Fallback if profiles table row does not exist yet
    const fallbackRole = authUser.email?.toLowerCase() === 'admin@assist.ai' ? 'admin' : 'user';
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
      let { data, error: authError } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });

      // If user does not exist in Supabase Auth yet, attempt auto signup for admin
      if (authError && (authError.message.includes('Invalid login credentials') || authError.status === 400)) {
        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            data: {
              full_name: 'System Admin',
              role: 'admin',
            },
          },
        });

        if (!signUpError && signUpData?.user) {
          data = signUpData;
          authError = null;
        }
      }

      if (authError) {
        // Fallback to Express backend if Supabase local credentials not connected
        const res = await fetch('/auth/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: cleanEmail, password }),
        });
        const expressData = await res.json();
        if (expressData.success && expressData.user) {
          setUser(expressData.user);
          return { success: true, user: expressData.user };
        }
        setError(authError.message || expressData.message || 'Admin authentication failed');
        return { success: false, message: authError.message || expressData.message };
      }

      const userProfile = await fetchUserProfile(data.user);
      if (userProfile.role !== 'admin') {
        setError('Access denied: Account role is not admin.');
        await supabase.auth.signOut();
        return { success: false, message: 'Access denied: Admin role required.' };
      }

      setUser(userProfile);
      return { success: true, user: userProfile };
    } catch (err) {
      const msg = err.message || 'Authentication error';
      setError(msg);
      return { success: false, message: msg };
    }
  };

  // Quick Demo User Login
  const loginDemoUser = async () => {
    setError(null);
    try {
      const res = await fetch('/auth/demo-user-login', { method: 'POST' });
      const data = await res.json();
      if (data.success && data.user) {
        setUser(data.user);
        return { success: true, user: data.user };
      }
    } catch (err) {
      setUser({
        id: 'demo_user_123',
        email: 'alex.user@assist.ai',
        name: 'Alex Rivera',
        avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=80&h=80&fit=crop&crop=face',
        role: 'user',
      });
    }
  };

  // Sign Out
  const logout = async () => {
    try {
      await supabase.auth.signOut();
      await fetch('/auth/logout', { method: 'POST' }).catch(() => {});
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
