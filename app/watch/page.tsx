'use client';
import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

export default function WatchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawParam = searchParams.get('url');

  const [videoId, setVideoId] = useState<string | null>(null);
  const [videoTitle, setVideoTitle] = useState<string>('');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);

  const playerRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Extract video ID
  useEffect(() => {
    if (!rawParam) return;
    try {
      const decoded = decodeURIComponent(rawParam);
      const match = decoded.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
      if (match) setVideoId(match[1]);
    } catch {
      const match = rawParam.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
      if (match) setVideoId(match[1]);
    }
  }, [rawParam]);

  // Load YouTube IFrame API
  useEffect(() => {
    if (!videoId || !containerRef.current) return;

    const initPlayer = () => {
      if (!window.YT || !window.YT.Player) return;
      playerRef.current = new window.YT.Player(containerRef.current, {
        videoId,
        height: '100%',
        width: '100%',
        playerVars: {
          autoplay: 1,
          controls: 0,
          modestbranding: 1,
          rel: 0,
          fs: 0,
          iv_load_policy: 3,
          disablekb: 1,
        },
        events: {
          onReady: (event: any) => {
            setPlayerReady(true);
            const title = event.target.getVideoData().title;
            setVideoTitle(title);
          },
          onStateChange: (event: any) => {
            setIsPlaying(event.data === 1);
          },
        },
      });
    };

    if (window.YT && window.YT.Player) {
      initPlayer();
    } else {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.body.appendChild(tag);
      window.onYouTubeIframeAPIReady = initPlayer;
    }

    return () => {
      if (playerRef.current && playerRef.current.pauseVideo) {
        playerRef.current.pauseVideo();
      }
    };
  }, [videoId]);

  // Spacebar toggle
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        
        if (playerReady && playerRef.current) {
          if (isPlaying) {
            playerRef.current.pauseVideo();
          } else {
            playerRef.current.playVideo();
          }
        }
      }
    };
    
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [playerReady, isPlaying]);

  return (
    <main className="relative w-screen h-screen bg-black text-white overflow-hidden">
      {/* Exit button */}
      <button
        onClick={() => router.push('/')}
        className="absolute top-4 left-4 z-50 px-3 py-1 bg-gray-800/80 text-white rounded hover:bg-gray-700"
      >
        ✖ Exit
      </button>

      {/* Menu button */}
      <button
        onClick={() => setIsMenuOpen(!isMenuOpen)}
        className="fixed top-4 right-4 z-50 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded shadow-lg"
      >
        Menu
      </button>

      {/* Menu panel */}
      {isMenuOpen && (
        <div className="fixed top-16 right-4 z-50 w-64 bg-gray-800 border border-blue-600 rounded-lg p-4 shadow-lg">
          <h2 className="text-lg font-semibold mb-3 text-blue-400">🎮 Controls</h2>
          <p className="text-sm text-gray-300 mb-2">
            • Press <span className="font-bold text-white">Spacebar</span> to{' '}
            {isPlaying ? 'pause' : 'play'}
          </p>
          <p className="text-sm text-gray-400">Status: {isPlaying ? '▶️ Playing' : '⏸️ Paused'}</p>
        </div>
      )}

      {/* Player container - absolute positioned to fill screen */}
      {videoId ? (
        <div 
          ref={containerRef}
          className="absolute inset-0 w-full h-full"
        />
      ) : (
        <div className="flex items-center justify-center w-full h-full">
          <p className="text-gray-400">No valid YouTube URL detected.</p>
        </div>
      )}

      {/* Bottom-left title bar */}
      {videoTitle && (
        <div className="fixed bottom-4 left-4 bg-gray-900/95 border border-gray-700 rounded-lg px-4 py-1.5 z-40 max-w-md">
          <p className="text-xs text-gray-300 truncate">
            📺 <span className="font-medium text-white">{videoTitle}</span>
          </p>
        </div>
      )}
    </main>
  );
}