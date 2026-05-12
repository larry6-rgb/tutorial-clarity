'use client';

import { useEffect } from 'react';

type SurfShelfProps = {
  open: boolean;
  onClose: () => void;
  children?: React.ReactNode;
  title?: string;
};

export default function SurfShelf({ open, onClose, children, title = 'Menu' }: SurfShelfProps) {
  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: open ? 'rgba(0,0,0,0.45)' : 'transparent',
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 200ms ease',
          zIndex: 50,
        }}
      />
      {/* Panel */}
      <aside
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          height: '100vh',
          width: 'min(90vw, 360px)',
          background: '#0B1220',
          color: 'white',
          boxShadow: '0 0 30px rgba(0,0,0,0.5)',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 220ms ease',
          zIndex: 60,
          display: 'flex',
          flexDirection: 'column',
          borderLeft: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontWeight: 700 }}>{title}</div>
          <button
            onClick={onClose}
            style={{ marginLeft: 'auto', background: 'transparent', color: '#9CA3AF', border: 0, cursor: 'pointer', fontSize: 18 }}
            aria-label="Close menu"
            title="Close (Esc)"
          >
            ×
          </button>
        </div>
        <div style={{ padding: 14, display: 'grid', gap: 10 }}>
          {children ?? (
            <>
              <div style={{ fontSize: 12, color: '#9CA3AF' }}>Quick Controls</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <button style={btn}>⏪ 10s</button>
                <button style={btn}>⏩ 10s</button>
                <button style={btn}>0.75×</button>
                <button style={btn}>1.25×</button>
                <button style={btn}>Mute</button>
                <button style={btn}>Unmute</button>
              </div>
              <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '8px 0' }} />
              <div style={{ fontSize: 12, color: '#9CA3AF' }}>Tips</div>
              <ul style={{ margin: 0, paddingLeft: 18, color: '#D1D5DB' }}>
                <li>Spacebar toggles play/pause on the Watch page</li>
                <li>Press Esc to close this panel</li>
              </ul>
            </>
          )}
        </div>
      </aside>
    </>
  );
}

const btn: React.CSSProperties = {
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.12)',
  background: '#111827',
  color: 'white',
  padding: '10px 12px',
  cursor: 'pointer',
};