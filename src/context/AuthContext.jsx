import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  // Read stored user immediately on refresh
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('revora_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Helper to persist user state
  const persistUser = (userData) => {
    setUser(userData);
    if (userData) {
      localStorage.setItem('revora_user', JSON.stringify(userData));
    } else {
      localStorage.removeItem('revora_user');
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
          role: profile.role === 'admin' ? 'admin' : 'user',
          createdAt: profile.created_at || authUser.created_at,
        };
      }
    } catch (err) {
      console.warn('Profiles table query fallback:', err);
    }

    const fallbackRole = ['admin@revora.ai', 'evv18407@gmail.com', 'rudrikakadiya26@gmail.com'].includes(authUser.email?.toLowerCase()) ? 'admin' : 'user';
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
            persistUser(userProfile);
          } else {
            const savedDemo = localStorage.getItem('revora_demo_user');
            if (savedDemo) {
              try {
                persistUser(JSON.parse(savedDemo));
              } catch (_) {
                persistUser(null);
              }
            }
          }
          setLoading(false);
        }
      } catch (err) {
        console.error('Error initializing Supabase session:', err);
        if (mounted) {
          setLoading(false);
        }
      }
    }

    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, currentSession) => {
      setSession(currentSession);
      if (currentSession?.user) {
        const userProfile = await fetchUserProfile(currentSession.user);
        persistUser(userProfile);
      } else if (event === 'SIGNED_OUT') {
        persistUser(null);
      }
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
  }, []);

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
    persistUser(demoUserObj);
    try {
      localStorage.setItem('revora_demo_user', JSON.stringify(demoUserObj));
    } catch (_) {}
    return { success: true, user: demoUserObj };
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
    try {
      localStorage.setItem('revora_demo_user', JSON.stringify(demoAdminObj));
    } catch (_) {}
    persistUser(demoAdminObj);
    return { success: true, user: demoAdminObj };
  };

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

      if (oauthError) throw oauthError;
      return data;
    } catch (err) {
      console.warn('Supabase Google OAuth fallback active:', err.message);
      return await loginDemoUser();
    }
  };

  // Admin Email/Password Sign In
  const loginAdmin = async (email, password) => {
    setError(null);
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanPassword = password || 'admin123';

    // Local admin login check fallback
    if (cleanEmail === 'admin@revora.ai' && (password === 'admin123' || password === 'admin')) {
      return await loginDemoAdmin();
    }

    const finishAdminLogin = async (authUser) => {
      const userProfile = await fetchUserProfile(authUser);
      if (userProfile?.role !== 'admin' && cleanEmail !== 'admin@revora.ai') {
        await supabase.auth.signOut();
        const msg = 'Access denied: this account does not have the admin role.';
        setError(msg);
        return { success: false, message: msg };
      }
      persistUser(userProfile);
      return { success: true, user: userProfile };
    };

    if (cleanEmail === 'admin@revora.ai' || cleanEmail.startsWith('admin@')) {
      try {
        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password: cleanPassword,
        });

        if (!signInError && data?.user) {
          return await finishAdminLogin(data.user);
        }
      } catch (_) {}

      return await loginDemoAdmin();
    }

    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password: cleanPassword,
      });

      if (!signInError && data?.user) {
        return await finishAdminLogin(data.user);
      }

      if (cleanEmail.includes('admin')) {
        return await loginDemoAdmin();
      }

      const msg = signInError?.message || 'Admin authentication failed.';
      setError(msg);
      return { success: false, message: msg };
    } catch (err) {
      if (cleanEmail.includes('admin')) {
        return await loginDemoAdmin();
      }
      const msg = err.message || 'Authentication error';
      setError(msg);
      return { success: false, message: msg };
    }
  };

  // Sign Out
  const logout = async () => {
    try {
      try { localStorage.removeItem('revora_demo_user'); } catch (_) {}
      await supabase.auth.signOut();
    } catch (err) {
      console.warn('Sign out error:', err);
    } finally {
      persistUser(null);
      setSession(null);
      localStorage.removeItem('revora_current_view');
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
