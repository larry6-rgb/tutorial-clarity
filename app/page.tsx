'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function HomePage() {
  const router = useRouter();
  const [urlInput, setUrlInput] = useState('');

  const handleWatch = () => {
    if (!urlInput.trim()) {
      alert('Please enter a YouTube URL');
      return;
    }
    
    const videoId = extractVideoId(urlInput);
    if (!videoId) {
      alert('Please enter a valid YouTube URL');
      return;
    }
    
    router.push(`/watch?url=https://www.youtube.com/watch?v=${videoId}`);
  };

  return (
    <div style={{ 
      minHeight: '100vh', 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center',
      background: '#8BB8EC',
      backgroundImage: `
        linear-gradient(#ffffff 1px, transparent 1px),
        linear-gradient(90deg, #ffffff 1px, transparent 1px)
      `,
      backgroundSize: '20px 20px',
      padding: '20px'
    }}>
      <div style={{
        background: '#000000',
        borderRadius: '16px',
        padding: '60px 50px',
        boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
        maxWidth: '600px',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '40px'
      }}>
        <h1 style={{ 
          background: 'linear-gradient(135deg, #E6E6FA 0%, #4A90E2 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
          fontSize: '48px', 
          margin: 0,
          fontWeight: 'bold',
          textAlign: 'center'
        }}>
          Tutorial Clarity
        </h1>
        
        <div style={{ 
          display: 'flex', 
          gap: '10px', 
          width: '100%',
          flexDirection: 'column'
        }}>
          <input
            type="text"
            placeholder="Paste YouTube URL here"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleWatch();
            }}
            style={{
              width: '100%',
              padding: '15px',
              fontSize: '16px',
              borderRadius: '8px',
              border: '1px solid #384152',
              background: '#1a1a1a',
              color: '#fff',
              boxSizing: 'border-box'
            }}
          />
          <button
            onClick={handleWatch}
            style={{
              width: '100%',
              padding: '15px 30px',
              fontSize: '16px',
              fontWeight: 'bold',
              borderRadius: '8px',
              border: 'none',
              background: '#4A90E2',
              color: 'white',
              cursor: 'pointer',
            }}
          >
            Watch Enhanced
          </button>
        </div>
      </div>
    </div>
  );
}

function extractVideoId(url: string): string | null {
  const trimmed = url.trim();
  
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }
  
  try {
    const urlObj = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    
    if (urlObj.hostname === 'youtu.be') {
      return urlObj.pathname.slice(1);
    }
    
    if (urlObj.hostname.includes('youtube.com')) {
      return urlObj.searchParams.get('v');
    }
  } catch {
    return null;
  }
  
  return null;
}