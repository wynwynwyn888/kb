'use client';

import type { ReactNode } from 'react';
import { useModalA11y } from '@/hooks/use-modal-a11y';
import { mvpPrimaryButtonStyle, appFloatingSecondaryButtonStyle } from '@/components/app/mvp-ui';

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { dialogRef } = useModalA11y(open, onCancel);

  if (!open) return null;

  return (
    <div
      role="presentation"
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'var(--aisbp-overlay, rgba(15, 23, 42, 0.48))',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={e => e.stopPropagation()}
        style={{
          width: 'min(440px, 100%)',
          background: 'var(--aisbp-modal-bg, #fff)',
          border: '1px solid var(--aisbp-modal-border, #e2e8f0)',
          borderRadius: 12,
          padding: '1.25rem 1.35rem',
          boxShadow: '0 20px 50px rgba(15, 23, 42, 0.18)',
        }}
      >
        <h2 id="confirm-dialog-title" style={{ margin: '0 0 0.5rem', fontSize: '1.05rem' }}>
          {title}
        </h2>
        <div style={{ margin: '0 0 1.1rem', color: 'var(--aisbp-text-secondary, #334155)', fontSize: '0.9rem', lineHeight: 1.5 }}>
          {description}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={onCancel} disabled={busy} style={appFloatingSecondaryButtonStyle}>
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            style={{
              ...mvpPrimaryButtonStyle,
              ...(destructive
                ? { background: '#dc2626', borderColor: '#dc2626' }
                : {}),
            }}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
