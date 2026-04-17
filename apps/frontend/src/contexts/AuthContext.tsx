'use client';

// Auth context - manages authentication state

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { getSupabaseClient, AuthUser } from '../lib/supabase';
import * as api from '../lib/api';

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
}

interface AuthContextType extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  token: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, loading: true, error: null });
  const [token, setToken] = useState<string | null>(null);
  const supabase = getSupabaseClient();

  const refreshUser = async () => {
    if (!token) {
      setState({ user: null, loading: false, error: null });
      return;
    }

    try {
      const userData = await api.getCurrentUser(token);
      setState({
        user: {
          id: userData.id,
          email: userData.email,
          profileId: userData.profile?.id,
          agencyId: userData.agencyId,
          tenantId: userData.tenantId,
          fullName: userData.profile?.fullName,
        },
        loading: false,
        error: null,
      });
    } catch (err) {
      setState({ user: null, loading: false, error: 'Failed to get user' });
      setToken(null);
    }
  };

  useEffect(() => {
    // Check for existing session
    const initAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setToken(session.access_token);
        await refreshUser();
      } else {
        setState({ user: null, loading: false, error: null });
      }
    };

    initAuth();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session) {
        setToken(session.access_token);
      } else {
        setToken(null);
        setState({ user: null, loading: false, error: null });
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const login = async (email: string, password: string) => {
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        throw error;
      }

      if (data.session) {
        setToken(data.session.access_token);
        await refreshUser();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Login failed';
      setState({ user: null, loading: false, error: message });
      throw err;
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setToken(null);
    setState({ user: null, loading: false, error: null });
  };

  return (
    <AuthContext.Provider value={{ ...state, login, logout, refreshUser, token }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}