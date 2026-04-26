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

/** After Supabase accepts credentials, GET /auth/me can fail (API down, misconfigured env) — use a clear message. */
function formatProfileLoadError(err: unknown): string {
  const dev = process.env.NODE_ENV === 'development';
  if (api.isApiHttpError(err)) {
    const st = err.status;
    if (st === 502 || st === 503 || st === 504) {
      return dev
        ? 'Could not reach the application server. Start the API your team uses with this app, then refresh and sign in again.'
        : 'The application is temporarily unavailable. Please try again in a moment.';
    }
    if (st >= 500) {
      return dev
        ? 'The server had an error loading your profile. Ask an administrator to check recent deployments and database connectivity.'
        : 'Something went wrong while loading your account. Please try again later.';
    }
    if (st === 401) {
      return dev
        ? 'Your session was rejected by the server. Confirm this app and the API use the same sign-in configuration.'
        : 'Your session is no longer valid. Sign out and sign in again.';
    }
    if (st === 404) {
      return dev
        ? 'The account service endpoint was not found. Restart the API or confirm you are on the correct app URL.'
        : 'This version of the app could not load your account. Please contact support.';
    }
    if (err.message && err.message !== 'Request failed') {
      return err.message;
    }
    return dev
      ? `Could not load your account (error ${st}). Check that the API is running.`
      : 'Could not load your account. Please try again.';
  }
  const msg = err instanceof Error ? err.message : 'Login failed';
  if (msg === 'Failed to fetch' || msg === 'Load failed' || (err instanceof TypeError && /fetch|network/i.test(msg))) {
    return dev
      ? 'Network error talking to the app server. Check your connection and that the API is running, then retry.'
      : 'We could not reach the server. Check your connection and try again.';
  }
  return msg;
}

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
    const SESSION_MS = 15_000;

    const initAuth = async () => {
      try {
        const sessionResult = await Promise.race([
          supabase.auth.getSession(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('session init timeout')), SESSION_MS),
          ),
        ]);

        const {
          data: { session },
          error: sessionError,
        } = sessionResult;

        if (sessionError) {
          setState({ user: null, loading: false, error: null });
          setToken(null);
          return;
        }

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
      } catch {
        setState({ user: null, loading: false, error: null });
        setToken(null);
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
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        let message = error.message || 'Sign-in failed';
        if (message === 'Failed to fetch' || message === 'Load failed') {
          message =
            'Cannot reach Supabase (auth). For local dev: run `supabase start` or set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local to your Supabase project — demo users exist in that project.';
        }
        setState({ user: null, loading: false, error: message });
        throw new Error(message);
      }

      if (!data.session?.access_token) {
        setState({ user: null, loading: false, error: 'No session from sign-in. Try again.' });
        throw new Error('No session from sign-in. Try again.');
      }

      const t = data.session.access_token;
      setToken(t);
      try {
        await applyUserFromToken(t);
      } catch (profileErr: unknown) {
        await supabase.auth.signOut();
        setToken(null);
        const profileMessage = formatProfileLoadError(profileErr);
        setState({ user: null, loading: false, error: profileMessage });
        throw new Error(profileMessage);
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
