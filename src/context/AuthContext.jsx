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

  // Helper to fetch user profile strictly from Supabase profiles table
  const fetchUserProfile = async (authUser, retry = true) => {
    if (!authUser) return null;

    try {
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', authUser.id)
        .maybeSingle();

      if (profile && !profileError) {
        let clientInfo = null;
        if (profile.client_id) {
          try {
            const { data: cData } = await supabase
              .from('clients')
              .select('id, name, email, company, contact_name')
              .eq('id', profile.client_id)
              .maybeSingle();
            if (cData) clientInfo = cData;
          } catch (cErr) {
            console.warn('Failed to load client details:', cErr);
          }
        }

        return {
          id: authUser.id,
          email: authUser.email,
          name: profile.full_name || authUser.user_metadata?.full_name || authUser.user_metadata?.name || authUser.email?.split('@')[0] || 'User',
          avatar: profile.avatar_url || authUser.user_metadata?.avatar_url || null,
          role: profile.role === 'admin' ? 'admin' : (profile.role === 'client' || profile.client_id ? 'client' : 'user'),
          clientId: profile.client_id || null,
          clientName: clientInfo?.name || null,
          clientCompany: clientInfo?.company || null,
          client: clientInfo,
          createdAt: profile.created_at || authUser.created_at,
        };
      }

      // If profile not yet created (e.g. brand new OAuth signup trigger running), retry once
      if (retry) {
        await new Promise((res) => setTimeout(res, 600));
        return await fetchUserProfile(authUser, false);
      }
    } catch (err) {
      console.warn('Profiles table query error:', err);
    }

    // Fail-closed fallback: ordinary user role only. NEVER grant admin privileges on client fallback.
    return {
      id: authUser.id,
      email: authUser.email,
      name: authUser.user_metadata?.full_name || authUser.user_metadata?.name || authUser.email?.split('@')[0] || 'User',
      avatar: authUser.user_metadata?.avatar_url || null,
      role: 'user',
      clientId: null,
      clientName: null,
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
            const intent = sessionStorage.getItem('revora_auth_intent');
            if (intent === 'admin' && userProfile?.role !== 'admin') {
              sessionStorage.removeItem('revora_auth_intent');
              await supabase.auth.signOut();
              persistUser(null);
              setError(`Access denied: Account (${userProfile?.email || 'user'}) does not have administrator privileges.`);
              setLoading(false);
              return;
            }
            if (intent) sessionStorage.removeItem('revora_auth_intent');
            persistUser(userProfile);
          } else {
            persistUser(null);
          }
          setLoading(false);
        }
      } catch (err) {
        console.error('Error initializing Supabase session:', err);
        if (mounted) {
          persistUser(null);
          setLoading(false);
        }
      }
    }

    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, currentSession) => {
      setSession(currentSession);
      if (currentSession?.user) {
        const userProfile = await fetchUserProfile(currentSession.user);
        const intent = sessionStorage.getItem('revora_auth_intent');
        if (intent === 'admin' && userProfile?.role !== 'admin') {
          sessionStorage.removeItem('revora_auth_intent');
          await supabase.auth.signOut();
          persistUser(null);
          setError(`Access denied: Account (${userProfile?.email || 'user'}) does not have administrator privileges.`);
          setLoading(false);
          return;
        }
        if (intent) sessionStorage.removeItem('revora_auth_intent');
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

  // Google OAuth Sign In (shared identity mechanism for Standard Users and Admins)
  const loginGoogle = async (intendedRole = 'user') => {
    setError(null);
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const isConfigured = supabaseUrl && !supabaseUrl.includes('placeholder-project-id');

    if (!isConfigured) {
      const msg = 'Supabase URL is not configured. Please check your environment variables.';
      setError(msg);
      return { success: false, message: msg };
    }

    try {
      sessionStorage.setItem('revora_auth_intent', intendedRole);
      const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}`,
        },
      });

      if (oauthError) throw oauthError;
      return { success: true, data };
    } catch (err) {
      sessionStorage.removeItem('revora_auth_intent');
      console.error('Supabase Google OAuth error:', err);
      const msg = err.message || 'Google sign-in failed. Please try again.';
      setError(msg);
      return { success: false, message: msg };
    }
  };

  // Admin Google Sign In
  const loginAdmin = async () => {
    return await loginGoogle('admin');
  };

  // Email/Password sign in for Clients and Users
  const loginPassword = async (email, password) => {
    setError(null);
    try {
      const cleanEmail = email.trim().toLowerCase();
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });

      if (signInError) throw signInError;

      if (data?.user) {
        const userProfile = await fetchUserProfile(data.user);
        persistUser(userProfile);
        return { success: true, user: userProfile, session: data.session };
      }
      return { success: true, data };
    } catch (err) {
      console.error('Password sign in error:', err);
      const msg = err.message || 'Invalid email or password.';
      setError(msg);
      return { success: false, message: msg };
    }
  };

  // Sign Out
  const logout = async () => {
    try {
      sessionStorage.removeItem('revora_auth_intent');
      localStorage.removeItem('revora_user');
      localStorage.removeItem('revora_current_view');
      await supabase.auth.signOut();
    } catch (err) {
      console.warn('Sign out notice:', err);
    } finally {
      persistUser(null);
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
        loginPassword,
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
