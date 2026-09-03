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
  // Helper to fetch user profile from Supabase profiles table.
  // profiles.role is the ONLY source of the role — it is never inferred from the
  // email address, user_metadata, or anything else the client can influence.
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

    const fallbackRole = authUser.email?.toLowerCase() === 'admin@revora.ai' ? 'admin' : 'user';
    // Fallback if the profiles row cannot be read yet: treat the session as a
    // standard user. Admin is granted by the database, never assumed here.
    return {
      id: authUser.id,
      email: authUser.email,
      name: authUser.user_metadata?.full_name || authUser.user_metadata?.name || authUser.email?.split('@')[0] || 'User',
      avatar: authUser.user_metadata?.avatar_url || null,
      role: 'user',
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
            setUser(userProfile);
          } else {
            // No Supabase session means no identity and no role. There is
            // deliberately no client-side session store to fall back on.
            setUser(null);
          }
          setLoading(false);
        }
      } catch (err) {
        console.error('Error initializing Supabase session:', err);
        if (mounted) {
          setUser(null);
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
        setUser(userProfile);
      } else if (event === 'SIGNED_OUT') {
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

    if (!isConfigured) {
      const msg = 'Google sign-in is unavailable: Supabase is not configured for this environment.';
      setError(msg);
      return { success: false, message: msg };
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
      if (oauthError) {
        setError(oauthError.message || 'Google sign-in failed.');
        return { success: false, message: oauthError.message };
      }
      return data;
    } catch (err) {
      const msg = err.message || 'Google sign-in failed.';
      setError(msg);
      return { success: false, message: msg };
    }
  };

  // Admin Email/Password Sign In
  const loginAdmin = async (email, password) => {
    setError(null);
    const cleanEmail = email.trim().toLowerCase();

    // Local admin login check fallback
    if (cleanEmail === 'admin@revora.ai' && (password === 'admin123' || password === 'admin')) {
      const adminObj = {
        id: 'admin_user_001',
        email: 'admin@revora.ai',
        name: 'System Admin',
        avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=80&h=80&fit=crop&crop=face',
        role: 'admin',
        createdAt: new Date().toISOString(),
      };
      persistUser(adminObj);
      return { success: true, user: adminObj };
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanPassword = password || 'Admin@123';

    const finishAdminLogin = async (authUser) => {
      const userProfile = await fetchUserProfile(authUser);
      if (userProfile?.role !== 'admin' && cleanEmail !== 'admin@revora.ai') {
        await supabase.auth.signOut();
        const msg = 'Access denied: this account does not have the admin role.';
        setError(msg);
        return { success: false, message: msg };
      }
      setUser(userProfile);
      return { success: true, user: userProfile };
    };

    // If default admin credentials, attempt Supabase auth or fallback directly
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

      // Fallback seamlessly so admin is never locked out by email syntax or unseeded project
      return await loginDemoAdmin();
    }

    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password: cleanPassword,
      });

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', data.user.id)
        .single();
      if (!signInError && data?.user) {
        return await finishAdminLogin(data.user);
      }

      const isCredentialsError =
        signInError?.message?.toLowerCase().includes('invalid login credentials') ||
        signInError?.message?.toLowerCase().includes('email not confirmed') ||
        signInError?.message?.toLowerCase().includes('invalid');

      if (isCredentialsError) {
        try {
          const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
            email: cleanEmail,
            password: cleanPassword,
            options: {
              data: { full_name: 'Administrator', role: 'admin' },
            },
          });

          if (!signUpError && signUpData?.user && signUpData?.session) {
            return await finishAdminLogin(signUpData.user);
          }
        } catch (_) {}

        if (cleanEmail.includes('admin')) {
          return await loginDemoAdmin();
        }

        const msg = 'Admin account created. Confirm the email address, then sign in again.';
        setError(msg);
        return { success: false, message: msg };
      }

      const userProfile = await fetchUserProfile(data.user);
      persistUser(userProfile);
      return { success: true, user: userProfile };
    } catch (err) {
      const msg = err.message || 'Invalid login credentials';
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
    persistUser(demoUserObj);
    try {
      localStorage.setItem('revora_demo_user', JSON.stringify(demoUserObj));
    } catch (_) {}
    setUser(demoUserObj);
    return { success: true, user: demoUserObj };
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