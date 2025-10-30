'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';

interface SavedVideo {
  id: string;
  url: string;
  title: string;
  dateSaved: string;
  isPersistent: boolean;
}

function WatchPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const videoId = searchParams.get('url');
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [showNudge, setShowNudge] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [volume, setVolume] = useState(100);
  const [isMuted, setIsMuted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [savedVideos, setSavedVideos] = useState<SavedVideo[]>([]);
  const [newVideoUrl, setNewVideoUrl] = useState('');
  const firstPauseRef = useRef(false);
  const nudgeDismissedRef = useRef(false);

  const nudgeTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Load saved videos from localStorage
  useEffect(() => {
    const stored = localStorage.getItem('tutorialClaritySavedVideos');
    if (stored) {
      const videos: SavedVideo[] = JSON.parse(stored);
      // Clean up videos older than 7 days (unless persistent)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      const filtered = videos.filter(video => {
        if (video.isPersistent) return true;
        const savedDate = new Date(video.dateSaved);
        return savedDate > sevenDaysAgo;
      });
      
      setSavedVideos(filtered);
      if (filtered.length !== videos.length) {
        localStorage.setItem('tutorialClaritySavedVideos', JSON.stringify(filtered));
      }
    }
  }, []);

  // Save videos to localStorage whenever they change
  useEffect(() => {
    if (savedVideos.length > 0) {
      localStorage.setItem('tutorialClaritySavedVideos', JSON.stringify(savedVideos));
    }
  }, [savedVideos]);

  // Auto-hide nudge after 5 seconds
  useEffect(() => {
    if (showNudge) {
      nudgeTimerRef.current = setTimeout(() => {
        setShowNudge(false);
        nudgeDismissedRef.current = true;
      }, 5000);
    }

    return () => {
      if (nudgeTimerRef.current) {
        clearTimeout(nudgeTimerRef.current);
        nudgeTimerRef.current = null;
      }
    };
  }, [showNudge]);

  // Keep focus on container to capture spacebar
  useEffect(() => {
    const interval = setInterval(() => {
      if (containerRef.current && document.activeElement !== containerRef.current) {
        containerRef.current.focus();
      }
    }, 100);

    return () => clearInterval(interval);
  }, []);

  // Listen for YouTube player state updates
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== 'https://www.youtube.com') return;
      
      try {
        const data = JSON.parse(event.data);
        if (data.event === 'infoDelivery' && data.info) {
          if (data.info.currentTime !== undefined) {
            setCurrentTime(data.info.currentTime);
          }
          if (data.info.duration !== undefined) {
            setDuration(data.info.duration);
          }
        }
      } catch (e) {
        // Ignore parsing errors
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Request player info periodically
  useEffect(() => {
    const interval = setInterval(() => {
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage(
          JSON.stringify({
            event: 'listening',
            id: 1,
            channel: 'widget'
          }),
          '*'
        );
      }
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        e.stopPropagation();

        if (iframeRef.current?.contentWindow) {
          if (isPlaying) {
            console.log('Pausing video');
            iframeRef.current.contentWindow.postMessage(
              JSON.stringify({
                event: 'command',
                func: 'pauseVideo',
                args: []
              }),
              '*'
            );
            setIsPlaying(false);

            // Show nudge only on first pause and if not previously dismissed
            if (!firstPauseRef.current && !nudgeDismissedRef.current) {
              firstPauseRef.current = true;
              setShowNudge(true);
            }
          } else {
            console.log('Playing video');
            iframeRef.current.contentWindow.postMessage(
              JSON.stringify({
                event: 'command',
                func: 'playVideo',
                args: []
              }),
              '*'
            );
            setIsPlaying(true);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyPress, true);
    return () => {
      window.removeEventListener('keydown', handleKeyPress, true);
    };
  }, [isPlaying]);

  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const newSet = new Set(prev);
      if (newSet.has(section)) {
        newSet.delete(section);
      } else {
        newSet.add(section);
      }
      return newSet;
    });
  };

  const toggleMute = () => {
    if (iframeRef.current?.contentWindow) {
      if (isMuted) {
        iframeRef.current.contentWindow.postMessage(
          JSON.stringify({ event: 'command', func: 'unMute', args: [] }),
          '*'
        );
      } else {
        iframeRef.current.contentWindow.postMessage(
          JSON.stringify({ event: 'command', func: 'mute', args: [] }),
          '*'
        );
      }
      setIsMuted(!isMuted);
    }
  };

  const handleVolumeChange = (newVolume: number) => {
    setVolume(newVolume);
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        JSON.stringify({ event: 'command', func: 'setVolume', args: [newVolume] }),
        '*'
      );
    }
  };

  const handlePlaybackSpeedChange = (speed: number) => {
    setPlaybackSpeed(speed);
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        JSON.stringify({ event: 'command', func: 'setPlaybackRate', args: [speed] }),
        '*'
      );
    }
  };

  const handleProgressBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = clickX / rect.width;
    const newTime = percentage * duration;
    
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        JSON.stringify({ event: 'command', func: 'seekTo', args: [newTime, true] }),
        '*'
      );
    }
  };

  const extractVideoId = (url: string): string | null => {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/,
      /^([a-zA-Z0-9_-]{11})$/
    ];
    
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }
    return null;
  };

  const fetchVideoTitle = async (videoId: string): Promise<string> => {
    try {
      // Using oEmbed API to get video title
      const response = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
      const data = await response.json();
      return data.title || 'Unknown Title';
    } catch (error) {
      console.error('Error fetching video title:', error);
      return 'Unknown Title';
    }
  };

  const handleAddVideo = async () => {
    if (!newVideoUrl.trim()) return;
    
    const videoId = extractVideoId(newVideoUrl);
    if (!videoId) {
      alert('Invalid YouTube URL. Please enter a valid YouTube video URL or ID.');
      return;
    }

    // Check if already saved
    if (savedVideos.some(v => v.id === videoId)) {
      alert('This video is already saved!');
      setNewVideoUrl('');
      return;
    }

    const title = await fetchVideoTitle(videoId);
    
    const newVideo: SavedVideo = {
      id: videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      title,
      dateSaved: new Date().toISOString(),
      isPersistent: false
    };

    // If we have 20 non-persistent videos, remove the oldest non-persistent one
    const nonPersistent = savedVideos.filter(v => !v.isPersistent);
    if (nonPersistent.length >= 20) {
      const oldestNonPersistent = nonPersistent.sort((a, b) => 
        new Date(a.dateSaved).getTime() - new Date(b.dateSaved).getTime()
      )[0];
      setSavedVideos(prev => [...prev.filter(v => v.id !== oldestNonPersistent.id), newVideo]);
    } else {
      setSavedVideos(prev => [...prev, newVideo]);
    }

    setNewVideoUrl('');
  };

  const handleDeleteVideo = (videoId: string) => {
    setSavedVideos(prev => {
      const updated = prev.filter(v => v.id !== videoId);
      localStorage.setItem('tutorialClaritySavedVideos', JSON.stringify(updated));
      return updated;
    });
  };

  const handleTogglePersistent = (videoId: string) => {
    setSavedVideos(prev => prev.map(v => 
      v.id === videoId ? { ...v, isPersistent: !v.isPersistent } : v
    ));
  };

  const handleLoadVideo = (videoId: string) => {
    setMenuOpen(false);
    window.location.href = `/watch?url=${videoId}`;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const timeRemaining = duration - currentTime;
  const progressPercentage = duration > 0 ? (currentTime / duration) * 100 : 0;

  if (!videoId) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <p className="text-xl text-gray-600">No YouTube URL selected yet</p>
      </div>
    );
  }

  return (
    <div className="flex w-full h-screen bg-black">
      {/* Video Section */}
      <div 
        ref={containerRef}
        tabIndex={0}
        className="relative flex-1 outline-none flex flex-col"
      >
        {/* Pink Nudge */}
        {showNudge && (
          <div className="absolute bottom-20 right-4 z-40 bg-pink-500 text-white px-4 py-3 rounded-lg shadow-2xl max-w-xs">
            <p className="text-sm font-semibold">
              ⚠️ Be sure to click the X within the overlay to ensure it does not reappear when using the spacebar.
            </p>
          </div>
        )}

        {/* YouTube iframe */}
        <div className="flex-1">
          <iframe
            ref={iframeRef}
            className="w-full h-full pointer-events-auto"
            src={`https://www.youtube.com/embed/${videoId}?enablejsapi=1&autoplay=1&disablekb=1&controls=0`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>

        {/* Custom Progress Bar */}
        <div className="bg-gray-900 px-4 py-2">
          <div className="flex items-center gap-3 text-white text-sm mb-2">
            <span className="font-mono">-{formatTime(timeRemaining)}</span>
            <div 
              className="flex-1 h-2 bg-gray-700 rounded-full cursor-pointer relative"
              onClick={handleProgressBarClick}
            >
              <div 
                className="h-full bg-blue-500 rounded-full transition-all"
                style={{ width: `${progressPercentage}%` }}
              />
            </div>
            <span className="font-mono">{playbackSpeed}x</span>
          </div>
        </div>
      </div>

      {/* Right Sidebar */}
      <div className="w-80 bg-black flex flex-col">
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="m-4 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
        >
          Menu
        </button>

        {menuOpen && (
          <div className="mx-4 mb-4 bg-white rounded-lg shadow-xl p-6 overflow-y-auto max-h-[calc(100vh-120px)]">
            {/* 1. SPACEBAR */}
            <div className="mb-4">
              <h3 
                onClick={() => toggleSection('spacebar')}
                className="text-lg font-bold mb-2 text-gray-800 cursor-pointer hover:text-blue-600 transition-colors"
              >
                1. SPACEBAR {expandedSections.has('spacebar') ? '▼' : '▶'}
              </h3>
              {expandedSections.has('spacebar') && (
                <p className="text-sm text-gray-700 mt-2">
                  In addition to using the standard YouTube controls, the spacebar can be used to start and pause the video.
                </p>
              )}
            </div>

            {/* 2. AUDIO CONTROLS */}
            <div className="mb-4">
              <h3 
                onClick={() => toggleSection('audio')}
                className="text-lg font-bold mb-2 text-gray-800 cursor-pointer hover:text-blue-600 transition-colors"
              >
                2. AUDIO CONTROLS {expandedSections.has('audio') ? '▼' : '▶'}
              </h3>
              {expandedSections.has('audio') && (
                <div className="mt-2">
                  <div className="mb-4">
                    <button
                      onClick={toggleMute}
                      className={`w-full py-2 px-4 rounded-lg font-semibold transition-colors ${
                        isMuted
                          ? 'bg-red-500 hover:bg-red-600 text-white'
                          : 'bg-green-500 hover:bg-green-600 text-white'
                      }`}
                    >
                      {isMuted ? '🔇 Unmute' : '🔊 Mute'}
                    </button>
                  </div>

                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Volume: {volume}%
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={volume}
                      onChange={(e) => handleVolumeChange(Number(e.target.value))}
                      className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* 3. PLAYBACK SPEED CONTROL */}
            <div className="mb-4">
              <h3 
                onClick={() => toggleSection('playback')}
                className="text-lg font-bold mb-2 text-gray-800 cursor-pointer hover:text-blue-600 transition-colors"
              >
                3. PLAYBACK SPEED CONTROL {expandedSections.has('playback') ? '▼' : '▶'}
              </h3>
              {expandedSections.has('playback') && (
                <div className="mt-2 grid grid-cols-4 gap-2">
                  {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((speed) => (
                    <button
                      key={speed}
                      onClick={() => handlePlaybackSpeedChange(speed)}
                      className={`py-2 px-3 rounded-lg font-semibold transition-colors ${
                        playbackSpeed === speed
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
                      }`}
                    >
                      {speed}x
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 4. SAVED SURFS */}
            <div className="mb-4">
              <h3 
                onClick={() => toggleSection('saved')}
                className="text-lg font-bold mb-2 text-gray-800 cursor-pointer hover:text-blue-600 transition-colors"
              >
                4. SAVED SURFS {expandedSections.has('saved') ? '▼' : '▶'}
              </h3>
              {expandedSections.has('saved') && (
                <div className="mt-2">
                  {/* Add Video Input */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Add YouTube Video
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newVideoUrl}
                        onChange={(e) => setNewVideoUrl(e.target.value)}
                        placeholder="Paste YouTube URL or ID"
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        onKeyPress={(e) => e.key === 'Enter' && handleAddVideo()}
                      />
                      <button
                        onClick={handleAddVideo}
                        className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-semibold"
                      >
                        Add
                      </button>
                    </div>
                  </div>

                  {/* Saved Videos List */}
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {savedVideos.length === 0 ? (
                      <p className="text-sm text-gray-500 text-center py-4">
                        No saved videos yet. Add one above!
                      </p>
                    ) : (
                      savedVideos.map((video) => (
                        <div
                          key={video.id}
                          className="bg-gray-50 p-3 rounded-lg border border-gray-200"
                        >
                          <div className="flex items-start gap-2">
                            <img
                              src={`https://img.youtube.com/vi/${video.id}/default.jpg`}
                              alt={video.title}
                              className="w-20 h-15 object-cover rounded cursor-pointer"
                              onClick={() => handleLoadVideo(video.id)}
                            />
                            <div className="flex-1 min-w-0">
                              <h4
                                className="text-sm font-semibold text-gray-800 cursor-pointer hover:text-blue-600 line-clamp-2"
                                onClick={() => handleLoadVideo(video.id)}
                              >
                                {video.title}
                              </h4>
                              <p className="text-xs text-gray-500 mt-1">
                                {formatDate(video.dateSaved)}
                              </p>
                              <div className="flex gap-2 mt-2">
                                <button
                                  onClick={() => handleTogglePersistent(video.id)}
                                  className={`text-xs px-2 py-1 rounded ${
                                    video.isPersistent
                                      ? 'bg-yellow-500 text-white'
                                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                  }`}
                                  title={video.isPersistent ? 'Persistent' : 'Make Persistent'}
                                >
                                  {video.isPersistent ? '📌 Pinned' : '📌 Pin'}
                                </button>
                                <button
                                  onClick={() => handleDeleteVideo(video.id)}
                                  className="text-xs px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600"
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
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