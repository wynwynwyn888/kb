'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { stripModelThinking } from '@aisbp/formatter';
import { postSubaccountBotTest, isApiHttpError, getApiBaseUrl } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

const PRIMARY = '#0F62FE';
const SURFACE_CHAT = 'var(--aisbp-surface-muted, rgba(248, 250, 252, 0.65))';
const BORDER_SOFT = 'var(--aisbp-border, rgba(226, 232, 240, 0.9))';

const BOT_TEST_MAX_HISTORY_MESSAGES = 12;

const shellDefault: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column' as const,
  height: 'min(700px, calc(100vh - 8rem))',
  maxHeight: 760,
  width: '100%',
  minWidth: 0,
  borderRadius: 18,
  border: `1px solid ${BORDER_SOFT}`,
  background: 'var(--aisbp-surface-elevated, rgba(255, 255, 255, 0.72))',
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  boxShadow: '0 12px 40px rgba(15, 23, 42, 0.06)',
  overflow: 'hidden',
};

const shellEmbedded: React.CSSProperties = {
  ...shellDefault,
  height: '100%',
  maxHeight: 'none',
  borderRadius: 14,
};

const messagesBox: React.CSSProperties = {
  flex: 1,
  minHeight: 280,
  overflowY: 'auto' as const,
  padding: '1.15rem 1.15rem 1rem',
  background: SURFACE_CHAT,
  fontSize: '0.875rem',
  lineHeight: 1.55,
  display: 'flex',
  flexDirection: 'column' as const,
  alignItems: 'stretch',
};

const messagesBoxEmbedded: React.CSSProperties = {
  ...messagesBox,
};

function formatBotTestFailure(message: string, status?: number): { headline: string; detail?: string } {
  const m = message.toLowerCase();
  if (m.includes('cannot post') || m.includes('failed to fetch') || m.includes('networkerror') || m.includes('load failed')) {
    return {
      headline: 'Could not reach the app. Check your connection, then try again.',
      detail: process.env.NODE_ENV === 'development' ? `Connection target: ${getApiBaseUrl()}` : undefined,
    };
  }
  if (status === 401) {
    return { headline: 'Session expired. Sign in again, then retry.' };
  }
  if (status === 404) {
    return {
      headline: 'The bot test tool is not available in this environment yet.',
      detail: process.env.NODE_ENV === 'development' ? message : undefined,
    };
  }
  if (
    m.includes('api key') ||
    m.includes('no key') ||
    m.includes('credential') ||
    m.includes('unauthorized') ||
    status === 403
  ) {
    return { headline: 'Set up your AI provider and API key first.' };
  }
  if (m.includes('active') && m.includes('provider')) {
    return { headline: 'Set up your AI provider and API key first.' };
  }
  if (m.includes('no active model') || m.includes('default model')) {
    return {
      headline: 'Choose a default model under Agency → AI Provider for the live provider.',
    };
  }
  return {
    headline: 'We could not run a test reply. Check Agency → AI Provider, then try again.',
    detail: process.env.NODE_ENV === 'development' ? message : undefined,
  };
}

function formatMetaLine(r: {
  activeProvider: string;
  modelUsed: string;
  kbChunksUsed: number;
  usedFallbackProvider?: 'OPENAI';
}): string {
  const kb =
    r.kbChunksUsed && r.kbChunksUsed > 0
      ? `${r.kbChunksUsed} chunk${r.kbChunksUsed === 1 ? '' : 's'}`
      : 'none';
  const parts = [r.activeProvider, r.modelUsed, `Knowledge: ${kb}`];
  if (r.usedFallbackProvider) parts.push(`Fallback: ${r.usedFallbackProvider}`);
  return parts.join(' · ');
}

export function BotTestPanel(props: {
  token: string;
  subaccountId: string;
  /** Shorter panel for embedding under main page content (e.g. Knowledge). */
  variant?: 'default' | 'embedded';
}) {
  const { token, subaccountId, variant = 'default' } = props;
  const { user } = useAuth();
  const showSupport = Boolean(user?.agencyRole);
  const embedded = variant === 'embedded';
  const [input, setInput] = useState('');
  const [msgs, setMsgs] = useState<
    {
      role: 'user' | 'assistant';
      content: string;
      meta?: string;
      error?: boolean;
      rawDetail?: string;
      supportMeta?: string;
      supportDetail?: string;
    }[]
  >([]);
  const [sending, setSending] = useState(false);
  /** Friendly-only banner (no raw HTTP/provider text). */
  const [panelBanner, setPanelBanner] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs, sending]);

  const onSend = async (e: FormEvent) => {
    e.preventDefault();
    const t = input.trim();
    if (!t || !token) return;
    const userLine = t;
    const prior = msgs
      .filter(m => (m.role === 'user' || m.role === 'assistant') && !m.error && m.content.trim())
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: (m.role === 'assistant' ? stripModelThinking(m.content) : m.content).trim(),
      }))
      .filter(h => h.content.length > 0)
      .slice(-BOT_TEST_MAX_HISTORY_MESSAGES);
    setMsgs(m => [...m, { role: 'user' as const, content: userLine }]);
    setInput('');
    setSending(true);
    setPanelBanner(null);
    try {
      const r = await postSubaccountBotTest(token, subaccountId, {
        message: userLine,
        history: prior,
      });
      const meta = showSupport ? formatMetaLine(r) : undefined;
      const supportMeta = formatMetaLine(r);

      setMsgs(m => {
        const reply = stripModelThinking(r.reply?.trim() ?? '');
        if (reply) {
          setPanelBanner(null);
          return [
            ...m,
            {
              role: 'assistant' as const,
              content: reply,
              meta,
              supportMeta: showSupport ? supportMeta : undefined,
              supportDetail: showSupport ? r.supportDetail?.trim() : undefined,
            },
          ];
        }
        const skip = r.skipReason;
        const headline = showSupport
          ? skip === 'no_provider' || skip === 'no_agency'
            ? 'Set up your AI provider and API key first.'
            : skip === 'generation_failed'
              ? 'The model did not return a reply. Check your API key and model, then try again.'
              : 'We could not generate a test reply. Check AI settings, then try again.'
          : 'We could not generate a preview reply. Please contact your workspace admin.';
        setPanelBanner(headline);
        const support = r.supportDetail?.trim();
        const rawDetail = [
          skip ? `skip: ${skip}` : null,
          supportMeta || null,
          support ? `Support: ${support}` : null,
        ]
          .filter(Boolean)
          .join('\n');
        return [
          ...m,
          {
            role: 'assistant' as const,
            content: headline,
            error: true,
            rawDetail: showSupport ? (rawDetail || `skip: ${String(skip)}`) : undefined,
            supportMeta: showSupport ? supportMeta : undefined,
            supportDetail: showSupport ? (rawDetail || `skip: ${String(skip)}`) : undefined,
          },
        ];
      });
    } catch (er) {
      const isApi = isApiHttpError(er);
      const errMsg = isApi ? er.message : String(er);
      const { headline, detail } = formatBotTestFailure(errMsg, isApi ? er.status : undefined);
      setPanelBanner(showSupport ? headline : 'We could not run a preview reply. Please try again or contact your workspace admin.');
      const rawForDetails = detail
        ? detail
        : isApi
          ? `HTTP ${er.status}${er.body != null ? ` · ${JSON.stringify(er.body).slice(0, 800)}` : ` · ${errMsg}`}`
          : errMsg;
      setMsgs(m => [
        ...m,
        {
          role: 'assistant',
          content: showSupport ? headline : 'We could not run a preview reply. Please try again or contact your workspace admin.',
          error: true,
          rawDetail: showSupport ? rawForDetails.slice(0, 1200) : undefined,
          supportDetail: showSupport ? rawForDetails.slice(0, 1200) : undefined,
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  const emptyCopy =
    "Send a sample customer message to see how this assistant would respond using its current instructions, selected vaults, and this workspace's automation rules.";

  const botAvatar = (
    <div
      style={{
        width: 32,
        height: 32,
        borderRadius: '50%',
        background: PRIMARY,
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        fontSize: '0.9rem',
        fontWeight: 800,
        lineHeight: 1,
        boxShadow: '0 1px 3px rgba(15, 23, 42, 0.12)',
      }}
      aria-hidden
    >
      AI
    </div>
  );

  return (
    <div style={embedded ? shellEmbedded : shellDefault}>
      <style
        dangerouslySetInnerHTML={{
          __html: `@keyframes botTestTyping{0%,100%{opacity:0.35}50%{opacity:1}}
.aisbp-bot-test-input::placeholder{color:var(--aisbp-muted,#94a3b8);opacity:1}
.aisbp-bot-test-input::-webkit-input-placeholder{color:var(--aisbp-muted,#94a3b8)}`,
        }}
      />
      <div
        style={{
          padding: '1.1rem 1.15rem',
          borderBottom: `1px solid ${BORDER_SOFT}`,
          background: 'var(--aisbp-surface, rgba(255,255,255,0.55))',
        }}
      >
        <h2
          style={{
            fontSize: embedded ? '1.05rem' : '1.2rem',
            fontWeight: 700,
            margin: 0,
            color: 'var(--aisbp-text-heading, #0f172a)',
            letterSpacing: '-0.02em',
          }}
        >
          {embedded ? 'Preview bot reply' : 'Preview a reply'}
        </h2>
        <p style={{ fontSize: '0.8125rem', color: 'var(--aisbp-muted, #64748b)', margin: '0.35rem 0 0', lineHeight: 1.5 }}>
          {embedded
            ? 'Uses this workspace’s prompt and assistant profile knowledge access.'
            : "Send a sample customer message to see how this assistant would respond using its current instructions, selected vaults, and this workspace's automation rules."}
        </p>
      </div>
      {panelBanner ? (
        <div
          role="alert"
          style={{
            margin: 0,
            padding: '0.65rem 1.15rem',
            fontSize: '0.8125rem',
            lineHeight: 1.45,
            color: 'var(--aisbp-alert-error-fg, #9f1239)',
            background: 'var(--aisbp-alert-error-bg, #fff1f2)',
            borderBottom: `1px solid var(--aisbp-alert-error-border, #fecdd3)`,
          }}
        >
          {panelBanner}
        </div>
      ) : null}
      <div ref={scrollRef} style={embedded ? messagesBoxEmbedded : messagesBox} aria-label="Test messages">
        {msgs.length === 0 && !sending ? (
          <div
            style={{
              color: 'var(--aisbp-muted, #64748b)',
              fontSize: '0.875rem',
              lineHeight: 1.6,
              maxWidth: '20rem',
              margin: '0.75rem auto 0',
              textAlign: 'center' as const,
            }}
          >
            {emptyCopy}
          </div>
        ) : null}
        {msgs.map((m, i) => (
          <div
            key={i}
            style={{
              marginBottom: '1rem',
              display: 'flex',
              flexDirection: 'row' as const,
              justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
              alignItems: m.role === 'user' ? 'flex-end' : 'flex-start',
              gap: m.role === 'assistant' ? 10 : 0,
            }}
          >
            {m.role === 'assistant' ? botAvatar : null}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column' as const,
                alignItems: m.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: 'min(85%, 26rem)',
              }}
            >
              <div
                style={{
                  padding: '0.85rem 1rem',
                  borderRadius: m.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                  background:
                    m.role === 'user'
                      ? PRIMARY
                      : m.error
                        ? 'var(--aisbp-alert-error-bg, #fff1f2)'
                        : 'var(--aisbp-surface, #fff)',
                  color:
                    m.role === 'user' ? '#fff' : m.error ? 'var(--aisbp-alert-error-fg, #9f1239)' : 'var(--aisbp-text, #0f172a)',
                  border:
                    m.role === 'user'
                      ? 'none'
                      : m.error
                        ? '1px solid var(--aisbp-alert-error-border, #fecdd3)'
                        : '1px solid var(--aisbp-border, #e2e8f0)',
                  boxShadow: m.role === 'user' ? '0 2px 8px rgba(15, 98, 254, 0.2)' : '0 1px 2px rgba(15, 23, 42, 0.05)',
                  whiteSpace: 'pre-wrap' as const,
                  wordBreak: 'break-word' as const,
                }}
              >
                {m.role === 'assistant' && !m.error ? stripModelThinking(m.content) : m.content}
              </div>
              {m.meta && !m.error ? (
                <div
                  style={{
                    fontSize: '0.6875rem',
                    color: 'var(--aisbp-muted, #94a3b8)',
                    marginTop: '0.4rem',
                    paddingLeft: m.role === 'assistant' ? 2 : 0,
                    paddingRight: m.role === 'user' ? 2 : 0,
                    lineHeight: 1.35,
                  }}
                >
                  {m.meta}
                </div>
              ) : null}
              {showSupport && (m.supportMeta || m.supportDetail) ? (
                <details style={{ marginTop: '0.4rem', maxWidth: '100%', alignSelf: 'flex-start' }}>
                  <summary style={{ fontSize: '0.6875rem', color: 'var(--aisbp-muted, #94a3b8)', cursor: 'pointer', fontWeight: 600 }}>
                    Support details
                  </summary>
                  <pre
                    style={{
                      fontSize: '0.625rem',
                      color: 'var(--aisbp-muted, #64748b)',
                      margin: '0.35rem 0 0',
                      whiteSpace: 'pre-wrap' as const,
                      maxWidth: '100%',
                    }}
                  >
                    {[m.supportMeta, m.supportDetail].filter(Boolean).join('\n\n')}
                  </pre>
                </details>
              ) : null}
              {m.error && m.rawDetail ? (
                <details style={{ marginTop: '0.4rem', maxWidth: '100%', alignSelf: 'flex-start' }}>
                  <summary style={{ fontSize: '0.6875rem', color: 'var(--aisbp-muted, #94a3b8)', cursor: 'pointer', fontWeight: 600 }}>
                    Response details
                  </summary>
                  <pre
                    style={{
                      fontSize: '0.625rem',
                      color: 'var(--aisbp-muted, #64748b)',
                      margin: '0.35rem 0 0',
                      whiteSpace: 'pre-wrap' as const,
                      maxWidth: '100%',
                    }}
                  >
                    {m.rawDetail}
                  </pre>
                </details>
              ) : null}
            </div>
          </div>
        ))}
        {sending ? (
          <div
            style={{
              marginBottom: '1rem',
              display: 'flex',
              flexDirection: 'row' as const,
              justifyContent: 'flex-start',
              alignItems: 'flex-start',
              gap: 10,
            }}
          >
            {botAvatar}
            <div
              style={{
                maxWidth: 'min(85%, 26rem)',
                padding: '0.65rem 0.95rem',
                borderRadius: '16px 16px 16px 4px',
                background: 'var(--aisbp-card-subtle, #e2e8f0)',
                color: 'var(--aisbp-text-secondary, #475569)',
                fontSize: '0.875rem',
                lineHeight: 1.2,
              }}
              aria-live="polite"
              aria-label="Bot is replying"
            >
              <span style={{ animation: 'botTestTyping 1.2s ease-in-out infinite' }}>●</span>{' '}
              <span style={{ animation: 'botTestTyping 1.2s ease-in-out infinite 0.2s', opacity: 0.8 }}>●</span>{' '}
              <span style={{ animation: 'botTestTyping 1.2s ease-in-out infinite 0.4s', opacity: 0.6 }}>●</span>
            </div>
          </div>
        ) : null}
        <div ref={endRef} style={{ height: 1, flexShrink: 0 }} aria-hidden />
      </div>
      <div
        style={{
          padding: '0.65rem 1rem 0.85rem',
          borderTop: `1px solid ${BORDER_SOFT}`,
          background: 'var(--aisbp-surface, rgba(255,255,255,0.9))',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '4px 4px 4px 14px',
            borderRadius: 999,
            background: 'var(--aisbp-card-subtle, #f1f5f9)',
            border: '1px solid var(--aisbp-border, transparent)',
          }}
        >
          <form onSubmit={onSend} style={{ display: 'flex', flex: 1, alignItems: 'center', gap: 8, minWidth: 0 }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              disabled={sending}
              placeholder="Ask as a customer..."
              aria-label="Test message"
              className="aisbp-bot-test-input"
              style={{
                flex: 1,
                minWidth: 0,
                border: 'none',
                background: 'transparent',
                fontSize: '0.875rem',
                padding: '10px 4px',
                outline: 'none',
                color: '#0f172a',
              }}
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              aria-label="Test reply"
              style={{
                width: 40,
                height: 40,
                borderRadius: '50%',
                border: 'none',
                background: PRIMARY,
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: sending || !input.trim() ? 'not-allowed' : 'pointer',
                opacity: sending || !input.trim() ? 0.5 : 1,
                flexShrink: 0,
                transition: 'transform 0.15s ease',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M4 12L20 4L14 20L11 13L4 12Z"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </form>
        </div>
        <p style={{ fontSize: '0.65rem', color: 'var(--aisbp-muted, #94a3b8)', margin: '10px 8px 0', textAlign: 'center', lineHeight: 1.4 }}>
          Preview only. This message will not be sent to customers.
        </p>
      </div>
    </div>
  );
}
