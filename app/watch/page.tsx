'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState, useEffect, useRef } from 'react';

function WatchPageContent() {
  const searchParams = useSearchParams();
  const url = searchParams.get('url');
  const [menuOpen, setMenuOpen] = useState(false);
  const [spacebarEnabled, setSpacebarEnabled] = useState(true);
  const [showHelper, setShowHelper] = useState(true);
  const playerRef = useRef<any>(null);
  const playerReadyRef = useRef(false);
  
  if (!url) {
    return <div style={{ padding: '20px', color: 'white' }}>No video URL provided</div>;
  }

  const videoId = extractVideoId(url);
  
  if (!videoId) {
    return <div style={{ padding: '20px', color: 'white' }}>Invalid YouTube URL</div>;
  }

  // Load YouTube IFrame API
  useEffect(() => {
    if ((window as any).YT && (window as any).YT.Player) {
      initPlayer();
      return;
    }

    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);

    (window as any).onYouTubeIframeAPIReady = () => {
      initPlayer();
    };

    function initPlayer() {
      playerRef.current = new (window as any).YT.Player('youtube-player', {
        videoId: videoId,
        events: {
          onReady: () => {
            playerReadyRef.current = true;
            console.log('Player ready');
          }
        }
      });
    }
  }, [videoId]);

  // Spacebar control
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.code === 'Space' && spacebarEnabled && playerRef.current && playerReadyRef.current) {
        e.preventDefault();
        
        try {
          const state = playerRef.current.getPlayerState();
          
          if (state === 1) {
            playerRef.current.pauseVideo();
          } else {
            playerRef.current.playVideo();
          }
        } catch (error) {
          console.error('Error controlling player:', error);
        }
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [spacebarEnabled]);

  return (
    <div style={{ 
      width: '100vw', 
      height: '100vh', 
      background: '#000',
      position: 'relative'
    }}>
      {/* Menu Button */}
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        style={{
          position: 'absolute',
          top: '20px',
          right: '20px',
          padding: '10px 20px',
          background: '#4A90E2',
          color: 'white',
          border: 'none',
          borderRadius: '8px',
          fontSize: '16px',
          fontWeight: 'bold',
          cursor: 'pointer',
          zIndex: 1000
        }}
      >
        Menu
      </button>

      {/* Menu Dropdown */}
      {menuOpen && (
        <div style={{
          position: 'absolute',
          top: '70px',
          right: '20px',
          background: '#1a1a1a',
          border: '1px solid #384152',
          borderRadius: '8px',
          padding: '10px',
          minWidth: '200px',
          zIndex: 1000
        }}>
          <label style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            color: 'white',
            padding: '8px',
            cursor: 'pointer'
          }}>
            <input
              type="checkbox"
              checked={spacebarEnabled}
              onChange={(e) => setSpacebarEnabled(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            Spacebar Control
          </label>
        </div>
      )}

      {/* Overlay Helper Nudge */}
      {showHelper && (
        <div style={{
          position: 'absolute',
          bottom: '40px',
          right: '40px',
          background: '#4A90E2',
          color: 'white',
          padding: '15px 20px',
          borderRadius: '12px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          zIndex: 999,
          maxWidth: '280px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px'
        }}>
          <div style={{ fontSize: '14px', lineHeight: '1.4' }}>
            <strong>Tip:</strong> Click the X button in the top-right corner of the video overlay to clear it
          </div>
          
          {/* Arrow pointing up and to the left */}
          <svg 
            style={{
              position: 'absolute',
              top: '-60px',
              right: '20px',
              width: '60px',
              height: '70px'
            }}
            viewBox="0 0 60 70"
          >
            <defs>
              <marker
                id="arrowhead"
                markerWidth="10"
                markerHeight="10"
                refX="5"
                refY="5"
                orient="auto"
              >
                <polygon points="0 0, 10 5, 0 10" fill="#4A90E2" />
              </marker>
            </defs>
            <path
              d="M 30 70 Q 40 40, 50 10"
              stroke="#4A90E2"
              strokeWidth="3"
              fill="none"
              markerEnd="url(#arrowhead)"
            />
          </svg>
          
          <button
            onClick={() => setShowHelper(false)}
            style={{
              alignSelf: 'flex-end',
              background: 'transparent',
              border: '1px solid white',
              color: 'white',
              padding: '5px 15px',
              borderRadius: '6px',
              fontSize: '12px',
              cursor: 'pointer'
            }}
          >
            Got it
          </button>
        </div>
      )}

      {/* Video Player */}
      <div style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <iframe
          id="youtube-player"
          width="1280"
          height="720"
          src={`https://www.youtube.com/embed/${videoId}?enablejsapi=1&rel=0&modestbranding=1&iv_load_policy=3`}
          title="YouTube video player"
          frameBorder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          style={{ maxWidth: '100%', maxHeight: '100%' }}
        />
      </div>
    </div>
  );
}

export default function WatchPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <WatchPageContent />
    </Suspense>
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