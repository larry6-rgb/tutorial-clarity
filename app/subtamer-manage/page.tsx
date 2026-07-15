'use client';

import { useState } from 'react';

export default function SubTamerManage() {
  const [key, setKey] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('loading');
    setErrorMsg('');
    try {
      const res = await fetch('/api/subtamer/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: key.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus('error');
        setErrorMsg(data.error || 'Something went wrong. Please try again.');
        return;
      }
      window.location.href = data.url;
    } catch {
      setStatus('error');
      setErrorMsg('Something went wrong. Please try again.');
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1a1a1a', color: '#fff', fontFamily: 'sans-serif', textAlign: 'center', padding: '2rem' }}>
      <div style={{ maxWidth: '400px', width: '100%' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Manage Your Subscription</h1>
        <p style={{ fontSize: '1rem', color: '#ccc', marginBottom: '1.5rem' }}>
          Enter your SubTamer license key to update payment details or cancel your subscription.
        </p>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <input
            type="text"
            required
            placeholder="Your license key"
            value={key}
            onChange={e => setKey(e.target.value)}
            style={{ padding: '0.6rem 0.8rem', borderRadius: '0.5rem', border: '1px solid #444', background: '#2a2a2a', color: '#fff', fontSize: '1rem' }}
          />
          <button
            type="submit"
            disabled={status === 'loading'}
            style={{ padding: '0.6rem 0.8rem', borderRadius: '0.5rem', border: 'none', background: '#ffd700', color: '#1a1a1a', fontWeight: 600, fontSize: '1rem', cursor: status === 'loading' ? 'wait' : 'pointer', opacity: status === 'loading' ? 0.7 : 1 }}
          >
            {status === 'loading' ? 'Loading…' : 'Manage Subscription'}
          </button>
          {status === 'error' && (
            <span style={{ color: '#ff6b6b', fontSize: '0.9rem' }}>{errorMsg}</span>
          )}
        </form>
        <p style={{ fontSize: '0.85rem', color: '#888', marginTop: '1.5rem' }}>
          Lost your license key? It was sent to the email you used at checkout.
        </p>
      </div>
    </div>
  );
}
