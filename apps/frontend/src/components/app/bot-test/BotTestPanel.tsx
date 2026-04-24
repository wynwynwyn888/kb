'use client';

import { FormEvent, useRef, useState } from 'react';
import { postSubaccountBotTest, isApiHttpError, getApiBaseUrl } from '@/lib/api';

const shell: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column' as const,
  minHeight: 'min(82vh, 800px)',
  maxHeight: 'min(90vh, 920px)',
  width: '100%',
  minWidth: 'min(100%, 640px)',
  border: '1px solid #cbd5e1',
  borderRadius: '12px',
  background: '#fff',
  boxShadow: '0 4px 24px rgba(15, 23, 42, 0.08)',
  overflow: 'hidden',
};

const messagesBox: React.CSSProperties = {
  flex: 1,
  minHeight: '420px',
  overflowY: 'auto' as const,
  padding: '0.9rem 1.1rem',
  background: 'linear-gradient(180deg, #f1f5f9 0%, #fff 28%)',
  fontSize: '0.9rem',
  lineHeight: 1.55,
};

function formatBotTestFailure(message: string, status?: number): { headline: string; detail?: string } {
  const m = message.toLowerCase();
  if (m.includes('cannot post') || m.includes('failed to fetch') || m.includes('networkerror') || m.includes('load failed')) {
    return {
      headline: 'Could not reach the app. Check your connection, then try again.',
      detail: `Technical: API base ${getApiBaseUrl()}`,
    };
  }
  if (status === 401) {
    return { headline: 'Session expired. Sign in again, then retry.' };
  }
  if (status === 404) {
    return {
      headline: 'The bot test feature is not available in this environment.',
      detail: `Technical: ${message}`,
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
      headline: 'Choose a default model under Agency → AI & models for the live provider.',
    };
  }
  return {
    headline: 'We could not run a test reply. Check Agency → AI & models, then try again.',
    detail: `Technical: ${message}`,
  };
}

export function BotTestPanel(props: { token: string; subaccountId: string }) {
  const { token, subaccountId } = props;
  const [input, setInput] = useState('');
  const [msgs, setMsgs] = useState<
    { role: 'user' | 'assistant'; content: string; meta?: string; error?: boolean; rawDetail?: string }[]
  >([]);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const onSend = async (e: FormEvent) => {
    e.preventDefault();
    const t = input.trim();
    if (!t || !token) return;
    setSending(true);
    setInput('');
    const userLine = t;
    const prior = msgs
      .filter(m => (m.role === 'user' || m.role === 'assistant') && !m.error)
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
    try {
      const r = await postSubaccountBotTest(token, subaccountId, {
        message: userLine,
        history: prior,
      });
      const meta = [
        `Live: ${r.activeProvider}`,
        `Model: ${r.modelUsed}`,
        r.kbChunksUsed ? `KB: ${r.kbChunksUsed} chunks` : 'KB: none',
        r.usedFallbackProvider ? `Fallback: ${r.usedFallbackProvider}` : null,
      ]
        .filter(Boolean)
        .join(' · ');

      setMsgs(m => {
        const userMsg = { role: 'user' as const, content: userLine };
        if (r.reply?.trim()) {
          return [...m, userMsg, { role: 'assistant' as const, content: r.reply, meta }];
        }
        const skip = r.skipReason;
        const headline =
          skip === 'no_provider' || skip === 'no_agency'
            ? 'Set up your AI provider and API key first.'
            : skip === 'generation_failed'
              ? 'The model did not return a reply. Check your API key and model, then try again.'
              : 'We could not generate a test reply. Check AI settings, then try again.';
        return [
          ...m,
          userMsg,
          {
            role: 'assistant' as const,
            content: headline,
            error: true,
            rawDetail: [skip ? `skip: ${skip}` : null, meta || null].filter(Boolean).join(' · ') || `skip: ${String(skip)}`,
          },
        ];
      });
    } catch (er) {
      const isApi = isApiHttpError(er);
      const errMsg = isApi ? er.message : String(er);
      const { headline, detail } = formatBotTestFailure(errMsg, isApi ? er.status : undefined);
      const rawForDetails = detail
        ? detail
        : isApi
          ? `HTTP ${er.status}${er.body != null ? ` · ${JSON.stringify(er.body).slice(0, 800)}` : ` · ${errMsg}`}`
          : errMsg;
      setMsgs(m => [
        ...m,
        { role: 'user', content: userLine },
        {
          role: 'assistant',
          content: headline,
          error: true,
          rawDetail: rawForDetails.slice(0, 1200),
        },
      ]);
    } finally {
      setSending(false);
      setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }), 0);
    }
  };

  return (
    <div style={shell}>
      <div style={{ padding: '0.7rem 1rem', borderBottom: '1px solid #e2e8f0', background: '#0f172a', color: '#f8fafc' }}>
        <div style={{ fontSize: '0.68rem', textTransform: 'uppercase' as const, letterSpacing: '0.1em', opacity: 0.75 }}>Test</div>
        <div style={{ fontSize: '1.05rem', fontWeight: 800, marginTop: '0.2rem' }}>Test your bot</div>
        <p style={{ fontSize: '0.8rem', opacity: 0.9, margin: '0.35rem 0 0', lineHeight: 1.4 }}>
          Not live customer traffic. Uses agency AI, this subaccount prompt, and KB.
        </p>
      </div>
      <div ref={scrollRef} style={messagesBox} aria-label="Test messages">
        {msgs.length === 0 ? (
          <div style={{ color: '#475569', fontSize: '0.9rem', lineHeight: 1.55, maxWidth: '100%' }}>
            <p style={{ margin: '0 0 0.4rem', fontWeight: 700, color: '#0f172a' }}>Ask something your customers would</p>
            <p style={{ margin: 0 }}>If generation is not set up, you will see a clear message in the thread and can open <strong>Technical details</strong> on that line to debug.</p>
          </div>
        ) : (
          msgs.map((m, i) => (
            <div
              key={i}
              style={{
                marginBottom: '0.75rem',
                textAlign: m.role === 'user' ? 'right' : 'left',
              }}
            >
              <div
                style={{
                  display: 'inline-block',
                  maxWidth: '96%',
                  padding: '0.55rem 0.7rem',
                  borderRadius: '10px',
                  background: m.role === 'user' ? '#0f172a' : m.error ? '#fff1f2' : '#f1f5f9',
                  color: m.role === 'user' ? '#fff' : m.error ? '#9f1239' : '#0f172a',
                }}
              >
                {m.content}
              </div>
              {m.meta ? <div style={{ fontSize: '0.66rem', color: '#94a3b8', marginTop: '0.2rem' }}>{m.meta}</div> : null}
              {m.error && m.rawDetail ? (
                <details style={{ marginTop: '0.3rem', textAlign: 'left' as const }}>
                  <summary style={{ fontSize: '0.68rem', color: '#94a3b8', cursor: 'pointer' }}>Technical details</summary>
                  <pre
                    style={{
                      fontSize: '0.64rem',
                      color: '#64748b',
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
          ))
        )}
      </div>
      <form
        onSubmit={onSend}
        style={{
          display: 'flex',
          gap: '0.6rem',
          padding: '0.75rem 1rem',
          borderTop: '1px solid #e2e8f0',
          background: '#fafbfc',
        }}
      >
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          disabled={sending}
          placeholder="Type a test message…"
          style={{
            flex: 1,
            minWidth: 0,
            padding: '0.65rem 0.8rem',
            borderRadius: '10px',
            border: '1px solid #cbd5e1',
            fontSize: '0.9rem',
          }}
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          style={{
            padding: '0.6rem 1.15rem',
            borderRadius: '10px',
            border: '1px solid #0f172a',
            background: '#0f172a',
            color: '#fff',
            fontWeight: 800,
            fontSize: '0.88rem',
            cursor: sending ? 'not-allowed' : 'pointer',
            opacity: sending || !input.trim() ? 0.65 : 1,
          }}
        >
          {sending ? '…' : 'Send'}
        </button>
      </form>
    </div>
  );
}
