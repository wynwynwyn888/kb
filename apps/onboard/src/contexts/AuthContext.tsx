'use client';

import { createContext, useContext, type ReactNode } from 'react';

interface AuthState {
  isAuthenticated: boolean;
  userName: string;
  userRole: 'operator' | 'agent' | 'admin';
}

interface AuthContextType extends AuthState {}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const value: AuthContextType = {
    isAuthenticated: false,
    userName: 'placeholder',
    userRole: 'operator',
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
