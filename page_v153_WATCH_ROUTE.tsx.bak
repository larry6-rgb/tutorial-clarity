// [v153] Tutorial Clarity — Watch Route (page.tsx) — Sync Fix #1: Global Player Exposure
// Install to: app/watch/page.tsx
'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import ClarifyAudioPanel from '@/components/ClarifyAudioPanel';

// v153 FIX #1: Declare global so George (useAudioTranslation) can read the YT player
declare global {
  interface Window {
    __TC_ACTIVE_YT_PLAYER__: any;
  }
}

interface SavedVideo {
    id: string;
    url: string;
    title: string;
    dateSaved: string;
    isPersistent: boolean;
}

interface TranscriptSegment {
    start: number;
    duration: number;
    text: string;
}

interface WatchHistory {
    videoId: string;
    title: string;
    thumbnail: string;
    lastWatchedTimestamp: number;
    lastWatchedDate: string;
    duration: number;
}

function WatchPageContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const urlParam = searchParams.get('url');
    
    const extractVideoIdFromParam = (url: string | null): string | null => {
        if (!url) return null;
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
    
    const videoId = extractVideoIdFromParam(urlParam);
   
    const containerRef = useRef<HTMLDivElement>(null);
    const transcriptRef = useRef<HTMLDivElement>(null);
    const playerRef = useRef<any>(null);
    const playerReadyRef = useRef(false);
    const overlayManuallyClosedRef = useRef(false);
    const nudgeTimerRef = useRef<NodeJS.Timeout | null>(null);
    const previousStateRef = useRef(-1);
    const focusIntervalRef = useRef<any>(null);
    const progressSaveIntervalRef = useRef<any>(null);
    
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
    const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
    const [transcriptLoading, setTranscriptLoading] = useState(false);
    const [transcriptError, setTranscriptError] = useState('');
    const [transcriptOpacity, setTranscriptOpacity] = useState(90);
    const [transcriptHeight, setTranscriptHeight] = useState(54);
    const [transcriptBottom, setTranscriptBottom] = useState(0);
    const [transcriptWidth, setTranscriptWidth] = useState(100);
    const [isResizingTranscript, setIsResizingTranscript] = useState(false);
    const [isDraggingHeight, setIsDraggingHeight] = useState(false);
    const [isDraggingPosition, setIsDraggingPosition] = useState(false);
    const dragStartY = useRef(0);
    const dragStartHeight = useRef(0);
    const dragStartBottom = useRef(0);
    const lastScrollLeft = useRef(0);
    
    // Resume Session states
    const [watchHistory, setWatchHistory] = useState<WatchHistory[]>([]);
    const [showResumeNotification, setShowResumeNotification] = useState(false);
    const [resumeTimestamp, setResumeTimestamp] = useState(0);
    const resumeNotificationTimerRef = useRef<NodeJS.Timeout | null>(null);

    // Load watch history from localStorage
    useEffect(() => {
        const stored = localStorage.getItem('tutorialClarityWatchHistory');
        if (stored) {
            try {
                const history: WatchHistory[] = JSON.parse(stored);
                const thirtyDaysAgo = new Date();
                thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

                const filtered = history.filter(item => {
                    const watchedDate = new Date(item.lastWatchedDate);
                    return watchedDate > thirtyDaysAgo;
                }).slice(0, 10);

                setWatchHistory(filtered);
                if (filtered.length !== history.length) {
                    localStorage.setItem('tutorialClarityWatchHistory', JSON.stringify(filtered));
                }
            } catch (e) {
                console.error('Error loading watch history:', e);
            }
        }
    }, []);

    // Check for resume on video load - ONLY ONCE
    useEffect(() => {
        if (!videoId) return;

        const stored = localStorage.getItem('tutorialClarityWatchHistory');
        if (!stored) return;

        try {
            const history: WatchHistory[] = JSON.parse(stored);
            const historyItem = history.find(item => item.videoId === videoId);
            
            if (historyItem && historyItem.lastWatchedTimestamp > 30) {
                setResumeTimestamp(historyItem.lastWatchedTimestamp);
                setShowResumeNotification(true);
                
                resumeNotificationTimerRef.current = setTimeout(() => {
                    setShowResumeNotification(false);
                }, 10000);
            }
        } catch (e) {
            console.error('Error checking resume:', e);
        }
    }, [videoId]);

    // Save progress periodically
    useEffect(() => {
        if (!videoId || !playerReadyRef.current) return;

        const saveProgress = async () => {
            if (!isPlaying || currentTime < 5) return;

            try {
                const title = await fetchVideoTitle(videoId);
                const thumbnail = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;

                const newHistoryItem: WatchHistory = {
                    videoId,
                    title,
                    thumbnail,
                    lastWatchedTimestamp: currentTime,
                    lastWatchedDate: new Date().toISOString(),
                    duration: duration || 0
                };

                setWatchHistory(prev => {
                    const filtered = prev.filter(item => item.videoId !== videoId);
                    const updated = [newHistoryItem, ...filtered].slice(0, 10);
                    localStorage.setItem('tutorialClarityWatchHistory', JSON.stringify(updated));
                    return updated;
                });
            } catch (e) {
                console.error('Error saving progress:', e);
            }
        };

        progressSaveIntervalRef.current = setInterval(saveProgress, 20000);

        return () => {
            if (progressSaveIntervalRef.current) {
                clearInterval(progressSaveIntervalRef.current);
            }
            saveProgress();
        };
    }, [videoId, isPlaying, currentTime, duration]);

    const handleResumeVideo = () => {
        if (playerRef.current && playerReadyRef.current) {
            playerRef.current.seekTo(resumeTimestamp, true);
            setShowResumeNotification(false);
            if (resumeNotificationTimerRef.current) {
                clearTimeout(resumeNotificationTimerRef.current);
            }
        }
    };
const pauseVideo = () => {
  if (playerRef.current && playerRef.current.pauseVideo) {
    playerRef.current.pauseVideo();
  }
};

const playVideo = () => {
  if (playerRef.current && playerRef.current.playVideo) {
    playerRef.current.playVideo();
  }
};
    const handleStartOver = () => {
        setShowResumeNotification(false);
        if (resumeNotificationTimerRef.current) {
            clearTimeout(resumeNotificationTimerRef.current);
        }
    };

    const handleRemoveFromHistory = (videoId: string) => {
        setWatchHistory(prev => {
            const updated = prev.filter(item => item.videoId !== videoId);
            localStorage.setItem('tutorialClarityWatchHistory', JSON.stringify(updated));
            return updated;
        });
    };

    const handleLoadHistoryVideo = (videoId: string) => {
        setMenuOpen(false);
        window.location.href = `/watch?url=${videoId}`;
    };

    // Load saved videos from localStorage
    useEffect(() => {
        const stored = localStorage.getItem('tutorialClaritySavedVideos');
        if (stored) {
            const videos: SavedVideo[] = JSON.parse(stored);
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

    // Initialize YouTube Player
    useEffect(() => {
        if (!videoId) return;

        if (playerRef.current) {
            try {
                playerRef.current.destroy();
            } catch (e) {
                console.log('Error destroying player:', e);
            }
            playerRef.current = null;
            playerReadyRef.current = false;
        }

        const initPlayer = () => {
            playerRef.current = new (window as any).YT.Player('youtube-player', {
                videoId: videoId,
                playerVars: {
                    autoplay: 0,
                    controls: 0,
                    modestbranding: 1,
                    rel: 0,
                    iv_load_policy: 3,
                    fs: 0,
                    disablekb: 1,
                },
                events: {
                    onReady: (event: any) => {
                        playerReadyRef.current = true;
                        setDuration(event.target.getDuration());
                        // v153 FIX #1: Expose player to global scope so George's
                        // getVideoTime() can find it via window.__TC_ACTIVE_YT_PLAYER__
                        window.__TC_ACTIVE_YT_PLAYER__ = event.target;
                        console.log('[v153] Player ready — exposed to window.__TC_ACTIVE_YT_PLAYER__');
                    },
                    onStateChange: (event: any) => {
                        const currentState = event.data;
                        const prevState = previousStateRef.current;
                        
                        console.log('State change:', currentState, 'Previous:', prevState);
                        
                        setIsPlaying(currentState === 1);
                        
                        if (currentState === 1 && prevState === 2) {
                            if (!overlayManuallyClosedRef.current) {
                                setShowNudge(true);
                                startNudgeTimer();
                            }
                        } else if (currentState === 1) {
                            setShowNudge(false);
                            clearNudgeTimer();
                        } else if (currentState === 2 && prevState === 1) {
                            if (!overlayManuallyClosedRef.current) {
                                setShowNudge(true);
                                startNudgeTimer();
                            }
                        }
                        
                        previousStateRef.current = currentState;
                    }
                }
            });
        };

        if ((window as any).YT && (window as any).YT.Player) {
            initPlayer();
        } else {
            const tag = document.createElement('script');
            tag.src = 'https://www.youtube.com/iframe_api';
            const firstScriptTag = document.getElementsByTagName('script')[0];
            firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);

            (window as any).onYouTubeIframeAPIReady = () => {
                initPlayer();
            };
        }

        return () => {
            clearNudgeTimer();
            // v153 FIX #1: Clean up global player ref on unmount
            if (window.__TC_ACTIVE_YT_PLAYER__) {
                window.__TC_ACTIVE_YT_PLAYER__ = null;
            }
        };
    }, [videoId]);

    const startNudgeTimer = () => {
        clearNudgeTimer();
        nudgeTimerRef.current = setTimeout(() => {
            setShowNudge(false);
            overlayManuallyClosedRef.current = true;
        }, 5000);
    };

    const clearNudgeTimer = () => {
        if (nudgeTimerRef.current) {
            clearTimeout(nudgeTimerRef.current);
            nudgeTimerRef.current = null;
        }
    };

    // Track current time
    useEffect(() => {
        const interval = setInterval(() => {
            if (playerRef.current && playerReadyRef.current) {
                try {
                    setCurrentTime(playerRef.current.getCurrentTime());
                } catch (e) {
                    // Ignore errors
                }
            }
        }, 100);

        return () => clearInterval(interval);
    }, []);

    // Aggressive focus management
    useEffect(() => {
        const maintainFocus = () => {
            if (document.activeElement?.tagName === 'IFRAME') {
                window.focus();
            }
        };

        focusIntervalRef.current = setInterval(maintainFocus, 100);

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
        const handleKeyPress = (e: KeyboardEvent) => {
            if (e.code === 'Space') {
                e.preventDefault();
                e.stopPropagation();

                if (playerRef.current && playerReadyRef.current) {
                    if (isPlaying) {
                        playerRef.current.pauseVideo();
                        setIsPlaying(false);
                    } else {
                        playerRef.current.playVideo();
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

    const handleVideoAreaClick = () => {
        console.log('Video area clicked');
        overlayManuallyClosedRef.current = true;
        setShowNudge(false);
        clearNudgeTimer();
        setTimeout(() => window.focus(), 0);
    };

    // Fetch transcript
    useEffect(() => {
        if (!videoId || !expandedSections.has('scroll')) return;

        const fetchTranscript = async () => {
            setTranscriptLoading(true);
            setTranscriptError('');

            try {
                const response = await fetch(`/api/transcript?videoId=${videoId}`);
                const data = await response.json();

                if (response.ok) {
                    setTranscript(data.transcript);
                } else {
                    setTranscriptError(data.error || 'Failed to load transcript');
                }
            } catch (error) {
                setTranscriptError('Failed to load transcript');
            } finally {
                setTranscriptLoading(false);
            }
        };

        fetchTranscript();
    }, [videoId, expandedSections]);

    // Auto-scroll transcript
    useEffect(() => {
        if (!transcriptRef.current || transcript.length === 0 || !expandedSections.has('scroll')) return;

        const currentSegmentIndex = transcript.findIndex((seg, idx) => {
            const nextSeg = transcript[idx + 1];
            return currentTime >= seg.start && (!nextSeg || currentTime < nextSeg.start);
        });

        if (currentSegmentIndex >= 0) {
            const segmentElement = transcriptRef.current.querySelector(`[data-index="${currentSegmentIndex}"]`) as HTMLElement;
            if (segmentElement && transcriptRef.current) {
                const container = transcriptRef.current;
                const segmentLeft = segmentElement.offsetLeft;
                const segmentWidth = segmentElement.offsetWidth;
                const containerWidth = container.offsetWidth;

                const targetScroll = segmentLeft - (containerWidth / 2) + (segmentWidth / 2);
                const currentScroll = container.scrollLeft;
                const scrollDiff = Math.abs(currentScroll - targetScroll);

                if (scrollDiff > 5) {
                    const newScroll = currentScroll + (targetScroll - currentScroll) * 0.1;
                    container.scrollLeft = newScroll;
                    lastScrollLeft.current = newScroll;
                }
            }
        }
    }, [currentTime, transcript, expandedSections]);

    // Save videos to localStorage
    useEffect(() => {
        if (savedVideos.length > 0) {
            localStorage.setItem('tutorialClaritySavedVideos', JSON.stringify(savedVideos));
        }
    }, [savedVideos]);

    // Transcript resize handler
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (isResizingTranscript) {
                const windowHeight = window.innerHeight;
                const newHeight = windowHeight - e.clientY;
                setTranscriptHeight(Math.max(54, Math.min(400, newHeight)));
            }
        };

        const handleMouseUp = () => {
            setIsResizingTranscript(false);
        };

        if (isResizingTranscript) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isResizingTranscript]);

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
        if (playerRef.current && playerReadyRef.current) {
            if (isMuted) {
                playerRef.current.unMute();
            } else {
                playerRef.current.mute();
            }
            setIsMuted(!isMuted);
        }
    };

    const handleVolumeChange = (newVolume: number) => {
        setVolume(newVolume);
        if (playerRef.current && playerReadyRef.current) {
            playerRef.current.setVolume(newVolume);
        }
    };

    const handlePlaybackSpeedChange = (speed: number) => {
        setPlaybackSpeed(speed);
        if (playerRef.current && playerReadyRef.current) {
            playerRef.current.setPlaybackRate(speed);
        }
    };

    const handleTranscriptClick = (startTime: number) => {
        if (playerRef.current && playerReadyRef.current) {
            playerRef.current.seekTo(startTime, true);
        }
    };

    const formatTime = (seconds: number): string => {
        if (!seconds || isNaN(seconds)) return "0:00";
        
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        
        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    };

    const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!playerRef.current || !playerReadyRef.current || !duration) return;
        
        const rect = e.currentTarget.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const percentage = clickX / rect.width;
        const newTime = percentage * duration;
        
        playerRef.current.seekTo(newTime, true);
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

    const handleHeightDragStart = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsDraggingHeight(true);
        dragStartY.current = e.clientY;
        dragStartHeight.current = transcriptHeight;
    };

    const handlePositionDragStart = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsDraggingPosition(true);
        dragStartY.current = e.clientY;
        dragStartBottom.current = transcriptBottom;
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (isDraggingHeight) {
                const deltaY = dragStartY.current - e.clientY;
                const newHeight = Math.max(54, Math.min(400, dragStartHeight.current + deltaY));
                setTranscriptHeight(newHeight);
            } else if (isDraggingPosition) {
                const deltaY = dragStartY.current - e.clientY;
                const maxBottom = window.innerHeight - transcriptHeight - 50;
                const newBottom = Math.max(0, Math.min(maxBottom, dragStartBottom.current + deltaY));
                setTranscriptBottom(newBottom);
            }
        };

        const handleMouseUp = () => {
            setIsDraggingHeight(false);
            setIsDraggingPosition(false);
        };

        if (isDraggingHeight || isDraggingPosition) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
            return () => {
                window.removeEventListener('mousemove', handleMouseMove);
                window.removeEventListener('mouseup', handleMouseUp);
            };
        }
    }, [isDraggingHeight, isDraggingPosition, transcriptHeight]);

    const fontSize = Math.max(14, Math.min(32, (transcriptHeight / 54) * 14));
    const showTranscriptBar = expandedSections.has('scroll');
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
                onClick={handleVideoAreaClick}
            >
                {/* Resume Notification */}
                {showResumeNotification && (
                    <div style={{
                        position: 'absolute',
                        top: '20px',
                        right: '20px',
                        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                        color: 'white',
                        padding: '20px 28px',
                        borderRadius: '16px',
                        fontSize: '18px',
                        fontWeight: 'bold',
                        boxShadow: '0 8px 32px rgba(102, 126, 234, 0.4)',
                        zIndex: 1000,
                        maxWidth: '400px',
                        border: '2px solid rgba(255, 255, 255, 0.3)'
                    }}>
                        <div className="mb-3 text-xl">Resume from {formatTime(resumeTimestamp)}?</div>
                        <div className="flex gap-3">
                            <button
                                onClick={handleResumeVideo}
                                className="flex-1 bg-white text-purple-700 px-6 py-3 rounded-lg font-bold hover:bg-gray-100 transition-colors text-base"
                            >
                                ▶ Resume
                            </button>
                            <button
                                onClick={handleStartOver}
                                className="flex-1 bg-purple-900 bg-opacity-50 text-white px-6 py-3 rounded-lg font-bold hover:bg-opacity-70 transition-colors text-base"
                            >
                                ↻ Start Over
                            </button>
                        </div>
                    </div>
                )}

                {/* Pink Nudge */}
                {showNudge && (
                    <div style={{
                        position: 'absolute',
                        bottom: '60px',
                        right: '120px',
                        background: '#FF1493',
                        color: 'white',
                        padding: '16px 24px',
                        borderRadius: '12px',
                        fontSize: '24px',
                        fontWeight: 'bold',
                        boxShadow: '0 4px 20px rgba(255, 20, 147, 0.6)',
                        zIndex: 999,
                        animation: 'flash 1s ease-in-out infinite',
                        maxWidth: '400px',
                        textAlign: 'center',
                        lineHeight: '1.3',
                        pointerEvents: 'none'
                    }}>
                        Click the X to close overlay
                    </div>
                )}

                {/* YouTube Player */}
                <div className="flex-1 relative">
                    <div
                        id="youtube-player"
                        style={{
                            width: '100%',
                            height: '100%'
                        }}
                    />
 
                </div>

                {/* Progress Bar */}
                <div className="bg-gray-800 bg-opacity-90 px-4 py-2 z-10">
                    <div className="flex items-center gap-3">
                        <span className="text-white text-sm font-mono min-w-[60px]">
                            {formatTime(currentTime)}
                        </span>

                        <div
                            className="flex-1 h-2 bg-gray-600 rounded-full cursor-pointer relative group"
                            onClick={handleProgressClick}
                        >
                            <div
                                className="h-full bg-red-600 rounded-full transition-all duration-100"
                                style={{ width: `${progressPercentage}%` }}
                            />
                            
                            <div
                                className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-red-600 rounded-full shadow-lg transition-all duration-100 group-hover:scale-125"
                                style={{ left: `${progressPercentage}%`, transform: 'translate(-50%, -50%)' }}
                            />
                        </div>

                        <span className="text-white text-sm font-mono min-w-[60px] text-right">
                            {formatTime(duration)}
                        </span>
                    </div>
                </div>

                {/* Transcript Bar */}
                {showTranscriptBar && (
                    <div
                        style={{
                            position: 'fixed',
                            bottom: `${transcriptBottom}px`,
                            left: '50%',
                            transform: 'translateX(-50%)',
                            width: `${transcriptWidth}%`,
                            height: `${transcriptHeight}px`,
                            backgroundColor: `rgba(0, 0, 0, ${transcriptOpacity / 100})`,
                            zIndex: 50
                        }}
                        className="border-t-4 border-blue-500 flex flex-col"
                    >
                        <div
                            className="w-full h-2 bg-blue-600 cursor-ns-resize hover:bg-blue-400 transition-colors"
                            onMouseDown={() => setIsResizingTranscript(true)}
                            title="Drag to resize"
                        />

                        <div className="flex-1 relative">
                            <div
                                ref={transcriptRef}
                                className="absolute inset-0 overflow-x-auto overflow-y-hidden px-4 text-white flex items-center whitespace-nowrap"
                                style={{ fontSize: `${fontSize}px` }}
                            >
                                {transcriptLoading && (
                                    <span className="text-gray-400">⏳ Loading transcript...</span>
                                )}
                                {!transcriptLoading && transcript.length === 0 && (
                                    <span className="text-gray-400">
                                        {transcriptError || 'No transcript available for this video'}
                                    </span>
                                )}
                                {!transcriptLoading && transcript.length > 0 && transcript.map((segment, idx) => {
                                    const isActive = currentTime >= segment.start &&
                                        (idx === transcript.length - 1 || currentTime < transcript[idx + 1].start);

                                    return (
                                        <span
                                            key={idx}
                                            data-index={idx}
                                            onClick={() => handleTranscriptClick(segment.start)}
                                            className={`cursor-pointer hover:text-blue-300 px-1 transition-colors ${
                                                isActive ? 'text-white font-bold' : ''
                                            }`}
                                            style={isActive ? {
                                                backgroundColor: `rgba(37, 99, 235, ${transcriptOpacity / 100})`
                                            } : {}}
                                        >
                                            {segment.text}
                                        </span>
                                    );
                                })}
                            </div>

                            <div
                                className="absolute left-1/2 -translate-x-1/2 flex gap-1 pointer-events-auto"
                                style={{
                                    zIndex: 100,
                                    top: '-40px'
                                }}
                            >
                                <div
                                    className="rounded-lg p-1 shadow-lg flex gap-1"
                                    style={{
                                        backgroundColor: 'rgba(37, 99, 235, 0.9)',
                                        backdropFilter: 'blur(4px)'
                                    }}
                                >
                                    <div
                                        className="cursor-move hover:bg-white/20 transition-colors rounded px-2 py-1"
                                        onMouseDown={handlePositionDragStart}
                                        title="Drag to move transcript bar up/down"
                                    >
                                        <div className="flex flex-col items-center">
                                            <div className="text-white text-lg leading-none">↕</div>
                                        </div>
                                    </div>

                                    <div
                                        className="cursor-ns-resize hover:bg-white/20 transition-colors rounded px-2 py-1"
                                        onMouseDown={handleHeightDragStart}
                                        title="Drag to adjust transcript bar height"
                                    >
                                        <div className="flex flex-col items-center">
                                            <div className="text-white text-lg leading-none">⇕</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                <style jsx>{`
                    @keyframes flash {
                        0%, 100% { opacity: 1; }
                        50% { opacity: 0.7; }
                    }
                `}</style>
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
                        {/* Audio Clarification Button */}
<ClarifyAudioPanel
  videoId={videoId}
  currentTime={currentTime}
  duration={duration}
  isPlaying={isPlaying}
  
  onPauseVideo={pauseVideo}
  onResumeVideo={playVideo}
/>
                        {/* Return to YouTube Button */}
                        <button
                            onClick={() => window.open('https://www.youtube.com', '_blank')}
                            className="w-full mb-6 bg-red-600 text-white px-6 py-4 rounded-lg hover:bg-red-700 transition-colors font-bold text-lg flex items-center justify-center gap-2"
                        >
                            <span className="text-2xl">▶</span>
                            Return to YouTube
                        </button>

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
                                            {isMuted ? '🔇 Unmute' : '🔈 Mute'}
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
                                        <p className="text-sm text-gray-600 mt-2 italic">
                                            If the slider is already maximized and the volume is still not loud enough for you, check the settings within your computer because that limits the maximum volume we can provide.
                                        </p>
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

                        {/* 5. SCROLL */}
                        <div className="mb-4">
                            <h3
                                onClick={() => toggleSection('scroll')}
                                className="text-lg font-bold mb-2 text-gray-800 cursor-pointer hover:text-blue-600 transition-colors"
                            >
                                5. SCROLL {expandedSections.has('scroll') ? '▼' : '▶'}
                            </h3>
                            {expandedSections.has('scroll') && (
                                <div className="mt-2">
                                    <div className="mb-4">
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            Opacity: {transcriptOpacity}%
                                        </label>
                                        <input
                                            type="range"
                                            min="10"
                                            max="100"
                                            value={transcriptOpacity}
                                            onChange={(e) => setTranscriptOpacity(Number(e.target.value))}
                                            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                                        />
                                    </div>

                                    <div className="mb-4">
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            Width: {transcriptWidth}%
                                        </label>
                                        <input
                                            type="range"
                                            min="30"
                                            max="100"
                                            value={transcriptWidth}
                                            onChange={(e) => setTranscriptWidth(Number(e.target.value))}
                                            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                                        />
                                    </div>

                                    <div className="text-xs text-gray-600 space-y-1">
                                        <p>• Transcript bar appears at bottom of screen</p>
                                        <p>• Drag blue top edge to resize height</p>
                                        <p>• Click any word to jump to that time</p>
                                        <p>• Current word is highlighted in blue</p>
                                        <p>• Adjust opacity to see video behind text</p>
                                        {transcriptLoading && <p className="text-blue-600">⏳ Loading transcript...</p>}
                                        {transcriptError && <p className="text-red-600">• {transcriptError}</p>}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* 6. CONTINUE WATCHING */}
                        <div className="mb-4">
                            <h3
                                onClick={() => toggleSection('continue')}
                                className="text-lg font-bold mb-2 text-gray-800 cursor-pointer hover:text-blue-600 transition-colors"
                            >
                                6. CONTINUE WATCHING {expandedSections.has('continue') ? '▼' : '▶'}
                            </h3>
                            {expandedSections.has('continue') && (
                                <div className="mt-2">
                                    {watchHistory.length === 0 ? (
                                        <p className="text-sm text-gray-500 text-center py-4">
                                            No watch history yet. Start watching videos!
                                        </p>
                                    ) : (
                                        <div className="space-y-3 max-h-96 overflow-y-auto">
                                            {watchHistory.map((item) => {
                                                const progressPercent = item.duration > 0
                                                    ? Math.round((item.lastWatchedTimestamp / item.duration) * 100)
                                                    : 0;
                                                const timeRemaining = item.duration - item.lastWatchedTimestamp;

                                                return (
                                                    <div
                                                        key={item.videoId}
                                                        className="bg-gray-50 rounded-lg border border-gray-200 overflow-hidden"
                                                    >
                                                        <div className="relative cursor-pointer" onClick={() => handleLoadHistoryVideo(item.videoId)}>
                                                            <img
                                                                src={item.thumbnail}
                                                                alt={item.title}
                                                                className="w-full h-32 object-cover"
                                                            />
                                                            <div
                                                                className="absolute bottom-0 left-0 h-1 bg-red-600"
                                                                style={{ width: `${progressPercent}%` }}
                                                            />
                                                            <div className="absolute bottom-1 right-1 bg-black bg-opacity-75 text-white text-xs px-2 py-1 rounded">
                                                                {progressPercent}%
                                                            </div>
                                                        </div>
                                                        <div className="p-3">
                                                            <h4
                                                                className="text-sm font-semibold text-gray-800 cursor-pointer hover:text-blue-600 line-clamp-2 mb-2"
                                                                onClick={() => handleLoadHistoryVideo(item.videoId)}
                                                            >
                                                                {item.title}
                                                            </h4>
                                                            <div className="flex items-center justify-between text-xs text-gray-600 mb-2">
                                                                <span>{formatTime(item.lastWatchedTimestamp)} / {formatTime(item.duration)}</span>
                                                                <span>{formatTime(timeRemaining)} left</span>
                                                            </div>
                                                            <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
                                                                <div
                                                                    className="bg-blue-600 h-2 rounded-full transition-all"
                                                                    style={{ width: `${progressPercent}%` }}
                                                                />
                                                            </div>
                                                            <div className="flex gap-2">
                                                                <button
                                                                    onClick={() => handleLoadHistoryVideo(item.videoId)}
                                                                    className="flex-1 bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-semibold"
                                                                >
                                                                    ▶ Resume
                                                                </button>
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        handleRemoveFromHistory(item.videoId);
                                                                    }}
                                                                    className="bg-gray-200 text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-300 transition-colors text-sm"
                                                                    title="Remove from history"
                                                                >
                                                                    ✕
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
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
