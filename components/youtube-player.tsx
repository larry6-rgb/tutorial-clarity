
"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import { YouTubePlayerState } from '@/lib/types';
import { formatTime } from '@/lib/youtube-utils';

interface YouTubePlayerComponentProps {
  videoId: string;
  onStateChange: (state: YouTubePlayerState) => void;
  onReady: (player: any) => void;
  className?: string;
}

export default function YouTubePlayerComponent({
  videoId,
  onStateChange,
  onReady,
  className = ""
}: YouTubePlayerComponentProps) {
  const [player, setPlayer] = useState<any>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isLoaded, setIsLoaded] = useState(false);
  
  const timeUpdateRef = useRef<NodeJS.Timeout>();
  const playerRef = useRef<HTMLDivElement>(null);

  const updatePlayerState = useCallback(() => {
    if (!player || !isLoaded) return;

    try {
      const current = player.getCurrentTime() || 0;
      const total = player.getDuration() || 0;
      const rate = player.getPlaybackRate() || 1;
      const playing = player.getPlayerState() === 1; // 1 = playing

      setCurrentTime(current);
      setDuration(total);
      setPlaybackRate(rate);
      setIsPlaying(playing);

      console.log('⏱️ Updating state - Time:', current.toFixed(1), '/', total.toFixed(1), 'Playing:', playing);

      onStateChange({
        isPlaying: playing,
        currentTime: current,
        duration: total,
        playbackRate: rate
      });
    } catch (error) {
      console.error('Error updating player state:', error);
    }
  }, [player, onStateChange, isLoaded]);

  // Load YouTube API and create player
  useEffect(() => {
    if (!videoId) return;

    const loadYouTubeAPI = () => {
      return new Promise<void>((resolve) => {
        if (window.YT && window.YT.Player) {
          resolve();
          return;
        }

        if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
          const script = document.createElement('script');
          script.src = 'https://www.youtube.com/iframe_api';
          script.async = true;
          document.head.appendChild(script);
        }

        (window as any).onYouTubeIframeAPIReady = () => {
          resolve();
        };
      });
    };

    const initializePlayer = async () => {
      try {
        console.log('🎬 Initializing YouTube player for video:', videoId);
        await loadYouTubeAPI();
        console.log('✅ YouTube API loaded');
        
        if (!playerRef.current) {
          console.log('❌ playerRef.current is null!');
          return;
        }

        console.log('🎮 Creating YT.Player instance...');
        const playerInstance = new (window as any).YT.Player(playerRef.current, {
          videoId: videoId,
          width: '100%',
          height: '100%',
          playerVars: {
            autoplay: 0,
            controls: 0,
            disablekb: 1,
            fs: 1,
            modestbranding: 1,
            rel: 0,
            iv_load_policy: 3
          },
          events: {
               onReady: (event: any) => {
                 setPlayer(event.target);
                 setIsLoaded(true);
                 console.log('✅ Player ready');
 },
            onStateChange: (event: any) => {
              console.log('🔄 Player state changed:', event.data);
            }
          }
        });
        console.log('✅ YT.Player instance created:', playerInstance);

      } catch (error) {
        console.error('❌❌❌ Error initializing YouTube player:', error);
      }
    };

    initializePlayer();

    return () => {
      if (player) {
        try {
          player.destroy();
        } catch (error) {
          console.error('Error destroying player:', error);
        }
      }
    };
  }, [videoId, onReady]);

  // Set up time update interval when player is ready
  useEffect(() => {
    if (!isLoaded || !player) return;

    console.log('⏲️ Setting up time update interval...');
    const interval = setInterval(() => {
      updatePlayerState();
    }, 500);
    timeUpdateRef.current = interval;

    return () => {
      if (timeUpdateRef.current) {
        clearInterval(timeUpdateRef.current);
        console.log('⏲️ Cleared time update interval');
      }
    };
  }, [isLoaded, player, updatePlayerState]);

  // Update player state when player is ready
  useEffect(() => {
    if (player && isLoaded) {
      updatePlayerState();
    }
  }, [player, isLoaded, updatePlayerState]);

  if (!videoId) {
    return (
      <div className={`relative w-full h-full bg-gray-800 rounded-lg flex items-center justify-center ${className}`}>
        <p className="text-white/70">No video selected</p>
      </div>
    );
  }

  return (
    <div className={`relative w-full h-full bg-black rounded-lg overflow-hidden ${className}`}>
      <div 
        ref={playerRef}
        className="w-full h-full"
        style={{ minHeight: '400px' }}
      />
      
      {/* Focus helper - positioned outside video to not interfere */}
      <div 
        className="absolute -top-1 -left-1 w-1 h-1 opacity-0"
        tabIndex={0}
        onFocus={() => {
          console.log('🎯 Focus helper activated');
        }}
      />
      
      {!isLoaded && (
        <div
  className={`absolute inset-0 bg-black/80 flex items-center justify-center z-20 transition-opacity duration-300 ${
    isLoaded ? "opacity-0 pointer-events-none" : "opacity-100 pointer-events-auto"
  }`}
>
  <div className="text-white text-center">
    <div className="animate-spin w-8 h-8 border-2 border-white border-t-transparent rounded-full mx-auto mb-4"></div>
    <p>Loading video player...</p>
  </div>
</div>     )}
      
      {/* Progress overlay */}
      {isLoaded && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-4 z-10">
          <div className="flex items-center gap-3 text-white">
            <span className="text-sm font-mono">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
            <div className="flex-1 h-1 bg-white/20 rounded-full overflow-hidden">
              <div 
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
              />
            </div>
            <span className="text-sm">
              {playbackRate}x
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
