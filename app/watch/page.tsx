'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState, useEffect, useRef } from 'react';

function WatchPageContent() {
  const searchParams = useSearchParams();
  const url = searchParams.get('url');
  const saveMode = searchParams.get('save');
  
  const [menuOpen, setMenuOpen] = useState(false);
  const [surfVideos, setSurfVideos] = useState<any[]>([]);
  const [showNudge, setShowNudge] = useState(false);
  const [spacebarExpanded, setSpacebarExpanded] = useState(false);
  const playerRef = useRef<any>(null);
  const playerReadyRef = useRef(false);
  const nudgeHasBeenShownRef = useRef(false);
  const firstSpacebarPauseRef = useRef(false);
  const nudgeTimerRef = useRef<any>(null);
  const previousStateRef = useRef(-1);
  const focusIntervalRef = useRef<any>(null);

  // Load the nudge flag from localStorage on mount
  useEffect(() => {
    const nudgeShown = localStorage.getItem('nudgeHasBeenShown');
    if (nudgeShown === 'true') {
      nudgeHasBeenShownRef.current = true;
    }
    loadSurfVideos();
  }, []);

  useEffect(() => {
    if (saveMode === 'true' && url) {
      saveToSurf(url);
      alert('Video saved to Surf list!');
    }
  }, [saveMode, url]);

  const loadSurfVideos = () => {
    const saved = localStorage.getItem('surfVideos');
    if (saved) {
      const videos = JSON.parse(saved);
      const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
      const filtered = videos.filter((v: any) => v.timestamp > oneWeekAgo);
      setSurfVideos(filtered);
      localStorage.setItem('surfVideos', JSON.stringify(filtered));
    }
  };

  const saveToSurf = (videoUrl: string) => {
    const videoId = extractVideoId(videoUrl);
    if (!videoId) return;

    const newVideo = {
      id: videoId,
      url: videoUrl,
      title: `Video ${videoId}`,
      timestamp: Date.now()
    };

    const saved = localStorage.getItem('surfVideos');
    const videos = saved ? JSON.parse(saved) : [];
    
    if (!videos.find((v: any) => v.id === videoId)) {
      videos.unshift(newVideo);
      localStorage.setItem('surfVideos', JSON.stringify(videos));
      loadSurfVideos();
    }
  };

  const deleteSurfVideo = (videoId: string) => {
    const filtered = surfVideos.filter(v => v.id !== videoId);
    localStorage.setItem('surfVideos', JSON.stringify(filtered));
    setSurfVideos(filtered);
  };

  if (!url) {
    return <div style={{ padding: '20px', color: 'white' }}>No video URL provided</div>;
  }

  const videoId = extractVideoId(url);
  
  if (!videoId) {
    return <div style={{ padding: '20px', color: 'white' }}>Invalid YouTube URL</div>;
  }

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
          },
          onStateChange: (event: any) => {
            const currentState = event.data;
            const prevState = previousStateRef.current;
            
            // State 1 = playing, State 2 = paused
            if (currentState === 1) {
              // Playing - ALWAYS hide nudge
              setShowNudge(false);
              clearNudgeTimer();
            } else if (currentState === 2 && prevState === 1) {
              // Just paused from playing - show nudge ONLY if it has never been shown before
              if (firstSpacebarPauseRef.current && !nudgeHasBeenShownRef.current) {
                setShowNudge(true);
                nudgeHasBeenShownRef.current = true;
                localStorage.setItem('nudgeHasBeenShown', 'true');
                startNudgeTimer();
              }
            }
            
            previousStateRef.current = currentState;
          }
        }
      });
    }
  }, [videoId]);

  const startNudgeTimer = () => {
    clearNudgeTimer();
    nudgeTimerRef.current = setTimeout(() => {
      setShowNudge(false);
    }, 5000);
  };

  const clearNudgeTimer = () => {
    if (nudgeTimerRef.current) {
      clearTimeout(nudgeTimerRef.current);
      nudgeTimerRef.current = null;
    }
  };

  // Aggressive focus management - constantly ensure window has focus
  useEffect(() => {
    // Ensure window always has focus
    const maintainFocus = () => {
      if (document.activeElement?.tagName === 'IFRAME') {
        window.focus();
      }
    };

    // Check every 100ms if iframe has stolen focus
    focusIntervalRef.current = setInterval(maintainFocus, 100);

    // Also listen for blur events
    const handleBlur = () => {
      setTimeout(() => window.focus(), 0);
    };

    window.addEventListener('blur', handleBlur);

    return () => {
      if (focusIntervalRef.current) {
        clearInterval(focusIntervalRef.current);
      }
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  // Spacebar handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        
        console.log('=== SPACEBAR PRESSED ===');
        console.log('Active element:', document.activeElement?.tagName);
        
        if (playerRef.current && playerReadyRef.current) {
          try {
            const state = playerRef.current.getPlayerState();
            console.log('Player state:', state);
            
            if (state === 1) {
              console.log('PAUSING video');
              playerRef.current.pauseVideo();
              // Mark that the first spacebar pause has occurred
              firstSpacebarPauseRef.current = true;
            } else {
              console.log('PLAYING video');
              playerRef.current.playVideo();
            }
          } catch (error) {
            console.error('Error controlling player:', error);
          }
        } else {
          console.log('Player not ready:', { 
            hasPlayer: !!playerRef.current, 
            isReady: playerReadyRef.current 
          });
        }
        
        return false;
      }
    };

    // Attach to document with capture phase
    document.addEventListener('keydown', handleKeyDown, true);
    
    // Also attach to window
    window.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, []);

  // Handle clicks on video area
  const handleVideoAreaClick = () => {
    console.log('Video area clicked');
    // Ensure window has focus
    setTimeout(() => window.focus(), 0);
  };

  // Handle closing the nudge - marks it as shown so it never appears again
  const handleCloseNudge = (e: React.MouseEvent) => {
    e.stopPropagation();
    console.log('Nudge closed - will never show again');
    setShowNudge(false);
    clearNudgeTimer();
    // Already marked as shown when it first appeared
  };

  return (
    <div style={{ 
      width: '100vw', 
      height: '100vh', 
      background: '#000',
      position: 'relative',
      display: 'flex'
    }}>
      {/* Video Area */}
      <div 
        onClick={handleVideoAreaClick}
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          position: 'relative'
        }}
      >
        <iframe
          id="youtube-player"
          width="100%"
          height="100%"
          src={`https://www.youtube.com/embed/${videoId}?enablejsapi=1&rel=0&modestbranding=1&iv_load_policy=3&disablekb=1`}
          title="YouTube video player"
          frameBorder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          style={{ 
            width: '100%',
            height: '100%',
            maxWidth: '100%',
            maxHeight: '100%'
          }}
        />
        
        {/* Small Pink Nudge - Bottom Right */}
        {showNudge && (
          <div style={{
            position: 'absolute',
            bottom: '60px',
            right: '120px',
            background: '#FF1493',
            color: 'white',
            padding: '8px 12px',
            borderRadius: '6px',
            fontSize: '12px',
            fontWeight: 'bold',
            boxShadow: '0 4px 20px rgba(255, 20, 147, 0.6)',
            zIndex: 999,
            animation: 'flash 1s ease-in-out infinite',
            maxWidth: '200px',
            textAlign: 'center',
            lineHeight: '1.3',
            pointerEvents: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <span style={{ flex: 1 }}>Click the X to close overlay</span>
            <button
              onClick={handleCloseNudge}
              style={{
                background: 'rgba(255, 255, 255, 0.3)',
                border: 'none',
                borderRadius: '4px',
                color: 'white',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: 'bold',
                padding: '2px 6px',
                lineHeight: '1',
                transition: 'background 0.2s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.5)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.3)';
              }}
              title="Don't show this nudge again"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* Right Side Menu Bar */}
      <div style={{
        width: '400px',
        background: '#000000',
        borderLeft: '2px solid #333',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '20px 0',
        position: 'relative',
        zIndex: 1000
      }}>
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          style={{
            padding: '12px 20px',
            background: '#4A90E2',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            fontSize: '16px',
            fontWeight: 'bold',
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(74, 144, 226, 0.3)',
            transition: 'all 0.2s ease',
            marginBottom: '20px'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#357ABD';
            e.currentTarget.style.transform = 'scale(1.05)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = '#4A90E2';
            e.currentTarget.style.transform = 'scale(1)';
          }}
        >
          Menu {menuOpen ? '▼' : '▶'}
        </button>

        {menuOpen && (
          <div style={{
            width: '90%',
            background: '#1a1a1a',
            border: '2px solid #384152',
            borderRadius: '12px',
            padding: '20px',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)'
          }}>
            <div style={{
              fontSize: '18px',
              fontWeight: 'bold',
              color: '#4A90E2',
              marginBottom: '15px',
              paddingBottom: '10px',
              borderBottom: '1px solid #333',
              textAlign: 'center'
            }}>
              Tutorial Clarity Functions
            </div>
            <div style={{
              color: '#fff',
              padding: '15px'
            }}>
              <div 
                onClick={() => setSpacebarExpanded(!spacebarExpanded)}
                style={{
                  fontSize: '16px',
                  fontWeight: 'bold',
                  marginBottom: spacebarExpanded ? '10px' : '0',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <span>{spacebarExpanded ? '▼' : '▶'}</span>
                <span>1. SPACEBAR</span>
              </div>
              {spacebarExpanded && (
                <div style={{
                  fontSize: '14px',
                  lineHeight: '1.5',
                  color: '#ccc',
                  paddingLeft: '24px'
                }}>
                  In addition to using YouTube's controls, you can use the spacebar to start and pause the video.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes flash {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
      `}</style>
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