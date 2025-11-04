"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ArrowLeft, 
  Settings, 
  Volume2,
  Bookmark as BookmarkIcon,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  Home
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import YouTubePlayerComponent from '@/components/youtube-player';
import ControlPanel from '@/components/control-panel';
import BookmarkPanel from '@/components/bookmark-panel';
import SessionManager from '@/components/session-manager';
import KeyboardHandler from '@/components/keyboard-handler';
import { extractVideoId, isValidYouTubeUrl } from '@/lib/youtube-utils';
import { YouTubePlayerState, TutorialSession, Bookmark } from '@/lib/types';
import { storage } from '@/lib/storage';

function WatchPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();
  
  const videoUrl = searchParams.get('url') || '';
  const [videoId, setVideoId] = useState('');
  const [player, setPlayer] = useState<any>(null);
  const [playerState, setPlayerState] = useState<YouTubePlayerState>({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    playbackRate: 1
  });
  
  const [session, setSession] = useState<TutorialSession | null>(null);
  const [showControls, setShowControls] = useState(true);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  
  const hideControlsTimeoutRef = useRef<NodeJS.Timeout>();

  // Initialize video
  useEffect(() => {
    console.log('🎥 Watch page initializing with URL:', videoUrl);
    
    if (!videoUrl) {
      console.log('❌ No video URL provided');
      return;
    }
    
    const isValid = isValidYouTubeUrl(videoUrl);
    if (!isValid) {
      console.log('❌ Invalid YouTube URL:', videoUrl);
      return;
    }

    const id = extractVideoId(videoUrl);
    if (id) {
      setVideoId(id);
      
      // Load or create session
      const existingSessions = storage.getSessions();
      const existingSession = existingSessions.find(s => s.videoId === id);
      
      if (existingSession) {
        setSession(existingSession);
        console.log('Restored existing session');
      } else {
        const newSession: TutorialSession = {
          id: Date.now().toString(),
          videoId: id,
          videoUrl: videoUrl,
          videoTitle: '',
          currentTime: 0,
          playbackRate: 1,
          bookmarks: [],
          notes: '',
          createdAt: new Date(),
          lastViewed: new Date()
        };
        setSession(newSession);
        storage.saveSession(newSession);
        console.log('Created new session');
      }
    } else {
      console.log('Could not extract video ID from URL');
    }
  }, [videoUrl]);

  // Auto-hide controls
  const resetHideControlsTimer = useCallback(() => {
    if (hideControlsTimeoutRef.current) {
      clearTimeout(hideControlsTimeoutRef.current);
    }
    
    setShowControls(true);
    hideControlsTimeoutRef.current = setTimeout(() => {
      setShowControls(false);
    }, 3000);
  }, []); // Remove dependencies to prevent infinite loops

  // Show controls on mouse movement
  useEffect(() => {
    const handleMouseMove = () => {
      if (hideControlsTimeoutRef.current) {
        clearTimeout(hideControlsTimeoutRef.current);
      }
      
      setShowControls(true);
      hideControlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false);
      }, 3000);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      if (hideControlsTimeoutRef.current) {
        clearTimeout(hideControlsTimeoutRef.current);
      }
    };
  }, []);

  // YouTube player event handlers
  const handlePlayerReady = useCallback((playerInstance: any) => {
    setPlayer(playerInstance);
    setIsLoaded(true);
    console.log('Player ready');
  }, []);

  const handlePlayerStateChange = useCallback((state: YouTubePlayerState) => {
    setPlayerState(state);
    
    if (session) {
      const updatedSession: TutorialSession = {
        ...session,
        currentTime: state.currentTime,
        playbackRate: state.playbackRate,
        lastViewed: new Date()
      };
      setSession(updatedSession);
      
      // Save session periodically (every 5 seconds when playing)
      if (state.isPlaying && Math.floor(state.currentTime) % 5 === 0) {
        storage.saveSession(updatedSession);
      }
    }
  }, [session]);

  // Keyboard handlers
  const handleSpaceBar = useCallback(() => {
    if (!player) return;
    
    try {
      if (playerState.isPlaying) {
        player.pauseVideo();
      } else {
        player.playVideo();
      }
      setShowControls(true);
    } catch (error) {
      console.error('Error controlling playback:', error);
    }
  }, [player, playerState.isPlaying]);

  const handleSeek = useCallback((seconds: number) => {
    if (!player) return;
    
    try {
      const newTime = Math.max(0, Math.min(playerState.duration, playerState.currentTime + seconds));
      player.seekTo(newTime, true);
      setShowControls(true);
    } catch (error) {
      console.error('Error seeking:', error);
    }
  }, [player, playerState.currentTime, playerState.duration]);

  const handleSpeedChange = useCallback((speed: number) => {
    if (!player) return;
    
    try {
      player.setPlaybackRate(speed);
      setShowControls(true);
    } catch (error) {
      console.error('Error changing speed:', error);
    }
  }, [player]);

  const handleBookmark = useCallback(() => {
    if (!session) return;
    
    const bookmark: Bookmark = {
      id: Date.now().toString(),
      timestamp: playerState.currentTime,
      title: `Bookmark at ${Math.floor(playerState.currentTime / 60)}:${String(Math.floor(playerState.currentTime % 60)).padStart(2, '0')}`,
      notes: '',
      createdAt: new Date()
    };
    
    const updatedSession: TutorialSession = {
      ...session,
      bookmarks: [...session.bookmarks, bookmark]
    };
    
    setSession(updatedSession);
    storage.saveSession(updatedSession);
    
    setShowControls(true);
  }, [session, playerState.currentTime]);

  const handleJumpToBookmark = useCallback((time: number) => {
    if (!player) return;
    
    try {
      player.seekTo(time, true);
      setShowControls(true);
    } catch (error) {
      console.error('Error jumping to bookmark:', error);
    }
  }, [player]);

  if (!videoId) {
    console.log('No video ID available, current videoUrl:', videoUrl);
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 flex items-center justify-center">
        <div className="text-center text-white">
          <div className="animate-spin w-8 h-8 border-2 border-white border-t-transparent rounded-full mx-auto mb-4"></div>
          <p>Loading video...</p>
          <p className="text-sm text-gray-400 mt-2">URL: {videoUrl || 'No URL provided'}</p>
          <p className="text-sm text-gray-400">Check console for details</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black flex flex-col">
      {/* Keyboard Handler */}
      <KeyboardHandler
        onSpaceBar={handleSpaceBar}
        onLeftArrow={() => handleSeek(-10)}
        onRightArrow={() => handleSeek(10)}
        onShiftLeftArrow={() => handleSeek(-30)}
        onShiftRightArrow={() => handleSeek(30)}
        onUpArrow={() => handleSpeedChange(Math.min(2, playerState.playbackRate + 0.25))}
        onDownArrow={() => handleSpeedChange(Math.max(0.25, playerState.playbackRate - 0.25))}
        onBookmark={handleBookmark}
        isEnabled={isLoaded && !showBookmarks}
      />

      {/* Header */}
      <AnimatePresence>
        {showControls && (
          <motion.header
            initial={{ y: -100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -100, opacity: 0 }}
            className="absolute top-0 left-0 right-0 z-30 bg-gradient-to-b from-black/80 to-transparent p-6"
          >
            <div className="flex items-center justify-between max-w-6xl mx-auto">
              <div className="flex items-center gap-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => router.push('/')}
                  className="text-white hover:bg-white/20"
                >
                  <Home size={20} />
                </Button>
                <div>
                  <h1 className="text-white font-semibold text-lg line-clamp-1">
                    {session?.videoTitle || 'Tutorial Video'}
                  </h1>
                  <p className="text-gray-300 text-sm">
                    Tutorial Clarity Enhanced Player
                  </p>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowBookmarks(!showBookmarks)}
                  className="text-white hover:bg-white/20"
                >
                  <BookmarkIcon size={20} />
                  <span className="ml-2">{session?.bookmarks.length || 0}</span>
                </Button>
              </div>
            </div>
          </motion.header>
        )}
      </AnimatePresence>

      {/* Main Video Area */}
      <div className="flex-1 relative">
        <YouTubePlayerComponent
          videoId={videoId}
          onStateChange={handlePlayerStateChange}
          onReady={handlePlayerReady}
          className="w-full h-full"
        />

        {/* Control Panel */}
        <AnimatePresence>
          {showControls && isLoaded && (
            <motion.div
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 100, opacity: 0 }}
              className="absolute bottom-6 left-6 right-6 z-20"
            >
              <ControlPanel
                playerState={playerState}
                onPlayPause={() => handleSpaceBar()}
                onSpeedChange={handleSpeedChange}
                onSeek={handleSeek}
                onBookmark={handleBookmark}
                className="mx-auto max-w-4xl"
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Bookmark Panel */}
        <AnimatePresence>
          {showBookmarks && session && (
            <motion.div
              initial={{ x: 300, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 300, opacity: 0 }}
              className="absolute top-0 right-0 bottom-0 z-40 w-80"
            >
              <BookmarkPanel
                bookmarks={session.bookmarks}
                currentTime={playerState.currentTime}
                onSeekTo={handleJumpToBookmark}
                onAddBookmark={(title: string, notes: string) => {
                  const bookmark: Bookmark = {
                    id: Date.now().toString(),
                    timestamp: playerState.currentTime,
                    title,
                    notes,
                    createdAt: new Date()
                  };
                  
                  const updatedSession: TutorialSession = {
                    ...session,
                    bookmarks: [...session.bookmarks, bookmark]
                  };
                  
                  setSession(updatedSession);
                  storage.saveSession(updatedSession);
                }}
                onEditBookmark={(bookmark: Bookmark) => {
                  if (!session) return;
                  
                  const updatedBookmarks = session.bookmarks.map(b =>
                    b.id === bookmark.id ? bookmark : b
                  );
                  
                  const updatedSession: TutorialSession = {
                    ...session,
                    bookmarks: updatedBookmarks
                  };
                  
                  setSession(updatedSession);
                  storage.saveSession(updatedSession);
                }}
                onDeleteBookmark={(bookmarkId: string) => {
                  if (!session) return;
                  
                  const updatedBookmarks = session.bookmarks.filter(b => b.id !== bookmarkId);
                  const updatedSession: TutorialSession = {
                    ...session,
                    bookmarks: updatedBookmarks
                  };
                  
                  setSession(updatedSession);
                  storage.saveSession(updatedSession);
                  
                  toast({
                    title: "Bookmark deleted",
                    description: "Bookmark removed successfully"
                  });
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Click to show controls overlay */}
        {!showControls && isLoaded && (
          <div 
            className="absolute inset-0 z-10 cursor-none"
            onClick={resetHideControlsTimer}
          />
        )}
      </div>
    </div>
  );
}

export default function WatchPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-white text-center">
          <div className="animate-spin w-8 h-8 border-2 border-white border-t-transparent rounded-full mx-auto mb-4"></div>
          <p>Loading video player...</p>
        </div>
      </div>
    }>
      <WatchPageContent />
    </Suspense>
  );
}