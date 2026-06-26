'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { getSupabaseClient } from '@/lib/supabase';
import { createOnboardApi, type OnboardApi } from '@/lib/api/onboard';

interface AuthUser {
  id: string;
  email: string | undefined;
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
}

interface AuthContextType extends AuthState {
  token: string | null;
  api: OnboardApi | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, loading: true, error: null });
  const [token, setToken] = useState<string | null>(null);
  const supabase = getSupabaseClient();

  const api = token ? createOnboardApi(token) : null;

  const applySession = useCallback((accessToken: string | null) => {
    if (accessToken) {
      setToken(accessToken);
      supabase.auth.getUser(accessToken).then(({ data }) => {
        setState({
          user: data.user ? { id: data.user.id, email: data.user.email } : null,
          loading: false,
          error: null,
        });
      }).catch(() => {
        setState({ user: null, loading: false, error: null });
        setToken(null);
      });
    } else {
      setToken(null);
      setState({ user: null, loading: false, error: null });
    }
  }, [supabase]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      applySession(session?.access_token ?? null);
    }).catch(() => {
      setState({ user: null, loading: false, error: null });
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      applySession(session?.access_token ?? null);
    });

    return () => { subscription.unsubscribe(); };
  }, [supabase, applySession]);

  const login = useCallback(async (email: string, password: string) => {
    setState(s => ({ ...s, loading: true, error: null }));
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setState(s => ({ ...s, loading: false, error: error.message }));
      throw error;
    }
  }, [supabase]);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setToken(null);
    setState({ user: null, loading: false, error: null });
  }, [supabase]);

  return (
    <AuthContext.Provider value={{ ...state, token, api, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
