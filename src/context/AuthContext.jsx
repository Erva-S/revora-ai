import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  // 1. Check localStorage first so local demo sessions survive page refreshes
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('revora_local_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Helper to persist session in React state AND localStorage
  const updateActiveUser = (userData) => {
    setUser(userData);
    if (userData) {
      localStorage.setItem('revora_local_user', JSON.stringify(userData));
    } else {
      localStorage.removeItem('revora_local_user');
    }
  };

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
            updateActiveUser(userProfile);
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
        updateActiveUser(userProfile);
      } else {
        // Only clear if no local demo user is saved
        const localSaved = localStorage.getItem('revora_local_user');
        if (!localSaved) {
          updateActiveUser(null);
        }
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

    // 1. Check local demo admin credentials
    if (cleanEmail === 'admin@revora.ai' && password === 'admin123') {
      const demoAdmin = {
        id: 'admin_demo_999',
        email: 'admin@revora.ai',
        name: 'Revora Executive Admin',
        role: 'admin',
        avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=80&h=80&fit=crop&crop=face',
      };
      updateActiveUser(demoAdmin);
      return { success: true, user: demoAdmin };
    }

    // 2. Fallback to Supabase authentication check
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });
      if (error) throw error;

      // Fetch user role from profiles table
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', data.user.id)
        .single();

      if (profileError || profile?.role !== 'admin') {
        await supabase.auth.signOut();
        const msg = "Access denied: Admin privileges required.";
        setError(msg);
        return { success: false, message: msg };
      }

      const userProfile = await fetchUserProfile(data.user);
      updateActiveUser(userProfile);
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
        updateActiveUser(data.user);
        return { success: true, user: data.user };
      }
    } catch (err) {
      const demoUser = {
        id: 'demo_user_123',
        email: 'alex.user@revora.ai',
        name: 'Alex Rivera',
        avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=80&h=80&fit=crop&crop=face',
        role: 'user',
      };
      updateActiveUser(demoUser);
      return { success: true, user: demoUser };
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
      updateActiveUser(null);
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