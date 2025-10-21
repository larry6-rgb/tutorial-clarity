'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState, useEffect, useRef } from 'react';

function WatchPageContent() {
  const searchParams = useSearchParams();
  const url = searchParams.get('url');
  const saveMode = searchParams.get('save');
  
  const [menuOpen, setMenuOpen] = useState(false);
  const [spacebarOpen, setSpacebarOpen] = useState(false);
  const [surfOpen, setSurfOpen] = useState(false);
  const [surfVideos, setSurfVideos] = useState<any[]>([]);
  const playerRef = useRef<any>(null);
  const playerReadyRef = useRef(false);
  
  // Load saved videos from localStorage
  useEffect(() => {
    loadSurfVideos();
  }, []);

  // Handle save mode (when bookmarklet is used)
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
      // Filter out videos older than 1 week
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
    
    // Check if already saved
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
          }
        }
      });
    }
  }, [videoId]);

  // Spacebar control
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.code === 'Space' && playerRef.current && playerReadyRef.current) {
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
  }, []);

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
          minWidth: '250px',
          maxHeight: '500px',
          overflowY: 'auto',
          zIndex: 1000
        }}>
          {/* Spacebar Control */}
          <div style={{ marginBottom: '10px' }}>
            <button
              onClick={() => setSpacebarOpen(!spacebarOpen)}
              style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                color: 'white',
                padding: '8px',
                textAlign: 'left',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <span>Spacebar Control</span>
              <span>{spacebarOpen ? '▼' : '▶'}</span>
            </button>
            {spacebarOpen && (
              <div style={{
                padding: '10px',
                color: '#aaa',
                fontSize: '14px',
                fontStyle: 'italic'
              }}>
                Use the spacebar to start and stop the video
              </div>
            )}
          </div>

          {/* Surf */}
          <div>
            <button
              onClick={() => setSurfOpen(!surfOpen)}
              style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                color: 'white',
                padding: '8px',
                textAlign: 'left',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <span>Surf ({surfVideos.length})</span>
              <span>{surfOpen ? '▼' : '▶'}</span>
            </button>
            {surfOpen && (
              <div style={{ padding: '10px' }}>
                {surfVideos.length === 0 ? (
                  <div style={{ color: '#aaa', fontSize: '14px' }}>
                    No saved videos yet
                  </div>
                ) : (
                  surfVideos.map((video) => (
                    <div
                      key={video.id}
                      style={{
                        padding: '8px',
                        marginBottom: '8px',
                        background: '#0f1626',
                        borderRadius: '6px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '8px'
                      }}
                    >
                      <a
                        href={`/watch?url=${video.url}`}
                        style={{
                          color: '#4A90E2',
                          textDecoration: 'none',
                          fontSize: '13px',
                          flex: 1,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {video.title}
                      </a>
                      <button
                        onClick={() => deleteSurfVideo(video.id)}
                        style={{
                          background: '#ff4444',
                          border: 'none',
                          color: 'white',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          cursor: 'pointer'
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
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