'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type ToastTone = 'success' | 'error' | 'info';

type ToastItem = {
  id: string;
  message: string;
  tone: ToastTone;
};

type ToastContextValue = {
  pushToast: (message: string, tone?: ToastTone) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const pushToast = useCallback((message: string, tone: ToastTone = 'info') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts(prev => [...prev, { id, message, tone }]);
    window.setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4500);
  }, []);

  const value = useMemo(() => ({ pushToast }), [pushToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-relevant="additions"
        style={{
          position: 'fixed',
          right: 16,
          bottom: 16,
          zIndex: 10000,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          maxWidth: 'min(360px, calc(100vw - 32px))',
          pointerEvents: 'none',
        }}
      >
        {toasts.map(t => (
          <div
            key={t.id}
            role="status"
            style={{
              pointerEvents: 'auto',
              padding: '0.75rem 1rem',
              borderRadius: 10,
              border: '1px solid var(--aisbp-border, #e2e8f0)',
              background: 'var(--aisbp-surface, #fff)',
              color: 'var(--aisbp-text, #0f172a)',
              boxShadow: '0 8px 24px rgba(15, 23, 42, 0.12)',
              fontSize: '0.875rem',
              borderLeft: `4px solid ${
                t.tone === 'success' ? '#059669' : t.tone === 'error' ? '#dc2626' : '#2563eb'
              }`,
            }}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return ctx;
}
