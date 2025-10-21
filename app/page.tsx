'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function LandingPage() {
  const router = useRouter();
  const [urlInput, setUrlInput] = useState('');

  const handleWatch = () => {
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    router.push(`/watch?url=${encodeURIComponent(trimmed)}`);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        backgroundColor: '#4A90E2',
        backgroundImage: `
          linear-gradient(rgba(255,255,255,0.12) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,0.12) 1px, transparent 1px)
        `,
        backgroundSize: '40px 40px',
        display: 'grid',
        placeItems: 'center',
        overflow: 'hidden',
      }}
    >
      {/* Center column: title + cartouche */}
      <div
        style={{
          width: 'min(92vw, 760px)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '16px',
        }}
      >
        {/* Title with lavender -> deep blue gradient */}
        <h1
          style={{
            margin: 0,
            textAlign: 'center',
            fontSize: '48px',
            fontWeight: 800,
            lineHeight: 1.1,
            background: 'linear-gradient(90deg, #C7A0FF, #2441A7)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent',
          }}
        >
          Tutorial Clarity
        </h1>

        {/* Black cartouche */}
        <div
          style={{
            position: 'relative',
            width: 'min(92vw, 680px)',
            borderRadius: '16px',
            background: 'rgba(0,0,0,0.95)',
            padding: '24px',
            boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
            outline: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          {/* Menu button inside cartouche (top-right) */}
          <button
            onClick={() => alert('Menu inside cartouche (hook up to your panel)')}
            style={{
              position: 'absolute',
              top: '12px',
              right: '12px',
              borderRadius: '8px',
              background: '#2563EB',
              color: 'white',
              padding: '8px 14px',
              boxShadow: '0 4px 10px rgba(0,0,0,0.35)',
              border: 'none',
              cursor: 'pointer',
            }}
            onMouseOver={(e) => (e.currentTarget.style.background = '#1D4ED8')}
            onMouseOut={(e) => (e.currentTarget.style.background = '#2563EB')}
          >
            Menu
          </button>

          {/* Inner content centered */}
          <div
            style={{
              width: 'min(100%, 520px)',
              margin: '32px auto 0',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <label
              htmlFor="yt-url"
              style={{
                marginBottom: '8px',
                fontSize: '14px',
                fontWeight: 600,
                color: 'rgba(255,255,255,0.85)',
              }}
            >
              Paste YouTube URL here
            </label>

            <input
              id="yt-url"
              type="url"
              placeholder="https://www.youtube.com/watch?v=..."
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleWatch(); }}
              style={{
                marginBottom: '16px',
                width: '100%',
                borderRadius: '10px',
                border: '1px solid rgba(255,255,255,0.15)',
                background: '#111827',
                color: 'white',
                padding: '12px 14px',
                outline: 'none',
                boxShadow: 'inset 0 0 0 2px transparent',
              }}
              onFocus={(e) => (e.currentTarget.style.boxShadow = 'inset 0 0 0 2px #3B82F6')}
              onBlur={(e) => (e.currentTarget.style.boxShadow = 'inset 0 0 0 2px transparent')}
            />

            <button
              onClick={handleWatch}
              style={{
                width: '100%',
                borderRadius: '10px',
                background: '#2563EB',
                color: 'white',
                padding: '12px 16px',
                fontSize: '18px',
                fontWeight: 700,
                border: 'none',
                cursor: 'pointer',
                boxShadow: '0 10px 20px rgba(0,0,0,0.35)',
              }}
              onMouseOver={(e) => (e.currentTarget.style.background = '#1D4ED8')}
              onMouseOut={(e) => (e.currentTarget.style.background = '#2563EB')}
            >
              Watch Enhanced
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}