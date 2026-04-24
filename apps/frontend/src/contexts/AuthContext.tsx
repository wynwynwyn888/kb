'use client';

// Auth context — manages authentication state and coordinates with API user profile

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
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

  const applyUserFromToken = useCallback(async (accessToken: string) => {
    const apply = async (token: string) => {
      const userData = await api.getCurrentUser(token);
      setToken(token);
      setState({
        user: {
          id: userData.id,
          email: userData.email,
          profileId: userData.profile?.id,
          agencyId: userData.agencyId,
          tenantId: userData.tenantId,
          fullName: userData.profile?.fullName,
          agencyRole: userData.agencyRole,
          tenantRole: userData.tenantRole,
        },
        loading: false,
        error: null,
      });
    };
    try {
      await apply(accessToken);
    } catch (e) {
      if (api.isApiHttpError(e) && e.status === 401) {
        const { data } = await supabase.auth.refreshSession();
        const t2 = data.session?.access_token;
        if (t2) {
          await apply(t2);
          return;
        }
      }
      throw e;
    }
  }, [supabase]);

  const refreshUser = useCallback(async () => {
    if (!token) {
      setState({ user: null, loading: false, error: null });
      return;
    }
    try {
      await applyUserFromToken(token);
    } catch {
      setState({ user: null, loading: false, error: 'Failed to get user' });
      setToken(null);
    }
  }, [token, applyUserFromToken]);

  useEffect(() => {
    const initAuth = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.access_token) {
        const t = session.access_token;
        setToken(t);
        try {
          await applyUserFromToken(t);
        } catch {
          setState({ user: null, loading: false, error: null });
          setToken(null);
        }
      } else {
        setState({ user: null, loading: false, error: null });
      }
    };

    void initAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.access_token) {
        const t = session.access_token;
        setToken(t);
        try {
          await applyUserFromToken(t);
        } catch {
          setState({ user: null, loading: false, error: null });
          setToken(null);
        }
      } else {
        setToken(null);
        setState({ user: null, loading: false, error: null });
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [supabase, applyUserFromToken]);

  const login = useCallback(
    async (email: string, password: string) => {
      setState(s => ({ ...s, loading: true, error: null }));
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) {
          throw error;
        }

        if (data.session?.access_token) {
          const t = data.session.access_token;
          setToken(t);
          await applyUserFromToken(t);
        }
      } catch (err: unknown) {
        let message = err instanceof Error ? err.message : 'Login failed';
        if (message === 'Failed to fetch' || message === 'Load failed') {
          message =
            'Cannot reach Supabase (auth). For local dev: run `supabase start` or set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local to your Supabase project — demo users exist in that project.';
        }
        setState({ user: null, loading: false, error: message });
        throw err;
      }
    },
    [supabase, applyUserFromToken],
  );

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setToken(null);
    setState({ user: null, loading: false, error: null });
  }, [supabase]);

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
