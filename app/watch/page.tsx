'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { ClarifyAudioPanel } from '../components/ClarifyAudioPanel';

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

const DEVELOPMENT_MODE = true;

function WatchPageContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const rawUrl = searchParams.get('url');
    const extractId = (url: string | null): string | null => {
        if (!url) return null;
        const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/);
        if (match) return match[1];
        const idMatch = url.match(/^([a-zA-Z0-9_-]{11})$/);
        if (idMatch) return idMatch[1];
        return url;
    };
    const videoId = extractId(rawUrl);
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const transcriptRef = useRef<HTMLDivElement>(null);
    const [showNudge, setShowNudge] = useState(false);
    const [showMenu, setShowMenu] = useState(false);
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
    const [transcriptLanguage, setTranscriptLanguage] = useState('de');
    const [transcriptOpacity, setTranscriptOpacity] = useState(90);
    const [transcriptHeight, setTranscriptHeight] = useState(54);
    const [transcriptBottom, setTranscriptBottom] = useState(0);
    const [transcriptWidth, setTranscriptWidth] = useState(100);
    const [transcriptCenterOffset, setTranscriptCenterOffset] = useState(0);
    const [isDraggingHeight, setIsDraggingHeight] = useState(false);
    const [isDraggingPosition, setIsDraggingPosition] = useState(false);

    // Clarify Audio transcript bar (rendered below video)
    const [clarifyTranscript, setClarifyTranscript] = useState<{text: string; start: number; end: number}[]>([]);
    const [clarifySegmentIndex, setClarifySegmentIndex] = useState(-1);
    const clarifyScrollRef = useRef<HTMLDivElement>(null);

    // Clarify bar position/size — persisted to localStorage
    const CLARIFY_BAR_KEY = 'clarifyBarLayout';
    const getInitialClarifyLayout = () => {
        if (typeof window === 'undefined') return { bottom: 60, height: 44 };
        try {
            const saved = localStorage.getItem(CLARIFY_BAR_KEY);
            if (saved) return JSON.parse(saved);
        } catch {}
        return { bottom: 60, height: 44 };
    };
    const [clarifyBarBottom, setClarifyBarBottom] = useState(() => getInitialClarifyLayout().bottom);
    const [clarifyBarHeight, setClarifyBarHeight] = useState(() => getInitialClarifyLayout().height);
    const [isDraggingClarifyBar, setIsDraggingClarifyBar] = useState(false);
    const [isResizingClarifyBar, setIsResizingClarifyBar] = useState(false);
    const clarifyDragStartY = useRef(0);
    const clarifyDragStartBottom = useRef(0);
    const clarifyResizeStartY = useRef(0);
    const clarifyResizeStartHeight = useRef(0);
    const dragStartY = useRef(0);
    const dragStartX = useRef(0);
    const dragStartHeight = useRef(0);
    const dragStartBottom = useRef(0);
    const dragStartCenterOffset = useRef(0);
    const lastScrollLeft = useRef(0);
    const firstPauseRef = useRef(false);
    const nudgeDismissedRef = useRef(false);
    const nudgeTimerRef = useRef<NodeJS.Timeout | null>(null);
    const controlsPositionOnDragStart = useRef<'above' | 'below'>('above');

    const [definitionPopup, setDefinitionPopup] = useState<{
        text: string;
        definition: string;
        x: number;
        y: number;
        loading: boolean;
    } | null>(null);
    const [popupDragOffset, setPopupDragOffset] = useState<{ x: number; y: number } | null>(null);
    const [isDraggingPopup, setIsDraggingPopup] = useState(false);
    const popupDragStart = useRef<{ mouseX: number; mouseY: number; popupX: number; popupY: number } | null>(null);
    const [userTier] = useState<'free' | 'premium'>('free');


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

    // Derive a primitive boolean so React can reliably detect changes
    const transcriptSectionOpen = expandedSections.has('scroll') || expandedSections.has('definitions');

    useEffect(() => {
        if (!videoId || !transcriptSectionOpen) return;

        const fetchTranscript = async () => {
            setTranscriptLoading(true);
            setTranscriptError('');
            setTranscript([]); // Clear old transcript immediately for visual feedback

            try {
                // Add cache-busting timestamp to prevent browser/Next.js from serving stale responses
                const cacheBust = Date.now();
                console.log(`[watch] Fetching transcript: videoId=${videoId}, lang=${transcriptLanguage}, t=${cacheBust}`);
                const response = await fetch(
                    `/api/transcript?videoId=${videoId}&lang=${transcriptLanguage}&_t=${cacheBust}`,
                    {
                        cache: 'no-store',
                        headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
                    }
                );

                if (!response.ok) {
                    throw new Error('Transcript not available');
                }

                const data = await response.json();
                console.log(`[watch] Transcript response: lang=${data.language}, switched=${data.languageSwitched}, segments=${data.count}, available=[${(data.availableLanguages || []).join(', ')}]`);

                if (data.transcript && data.transcript.length > 0) {
                    setTranscript(data.transcript);
                    // If the requested language wasn't available, show a note
                    if (data.languageSwitched === false && data.language !== transcriptLanguage) {
                        const langNames: Record<string, string> = { de: 'German', en: 'English', es: 'Spanish', fr: 'French', it: 'Italian', pt: 'Portuguese' };
                        const requestedName = langNames[transcriptLanguage] || transcriptLanguage;
                        const availableStr = (data.availableLanguages || []).join(', ');
                        setTranscriptError(`"${requestedName}" not available for this video. Available: ${availableStr || 'unknown'}. Showing default.`);
                    } else {
                        setTranscriptError('');
                    }
                } else {
                    setTranscriptError('No transcript available for this video');
                }
            } catch (error) {
                console.error('[watch] Transcript error:', error);
                setTranscriptError('Transcript not available for this video');
            } finally {
                setTranscriptLoading(false);
            }
        };

        fetchTranscript();
    }, [videoId, transcriptSectionOpen, transcriptLanguage]);

    useEffect(() => {
        if (!transcriptRef.current || transcript.length === 0 || (!expandedSections.has('scroll') && !expandedSections.has('definitions'))) return;

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

    useEffect(() => {
        if (savedVideos.length > 0) {
            localStorage.setItem('tutorialClaritySavedVideos', JSON.stringify(savedVideos));
        }
    }, [savedVideos]);

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

    useEffect(() => {
        const interval = setInterval(() => {
            const active = document.activeElement;
            const tag = active?.tagName?.toLowerCase();
            // Don't steal focus from INPUT or TEXTAREA elements
            if (tag === 'input' || tag === 'textarea' || tag === 'select') {
                return;
            }
            if (containerRef.current && active !== containerRef.current) {
                containerRef.current.focus();
            }
        }, 100);

        return () => clearInterval(interval);
    }, []);

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
            // Don't intercept keyboard events when user is typing in input fields
            const activeTag = (document.activeElement?.tagName || '').toLowerCase();
            if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') {
                return;
            }
            if (e.code === 'Space') {
                e.preventDefault();
                e.stopPropagation();

                if (iframeRef.current?.contentWindow) {
                    if (isPlaying) {
                        iframeRef.current.contentWindow.postMessage(
                            JSON.stringify({
                                event: 'command',
                                func: 'pauseVideo',
                                args: []
                            }),
                            '*'
                        );
                        setIsPlaying(false);

                        if (!firstPauseRef.current && !nudgeDismissedRef.current) {
                            firstPauseRef.current = true;
                            setShowNudge(true);
                        }
                    } else {
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

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (isDraggingPopup) return; // Don't close while dragging
            if (definitionPopup && !(e.target as HTMLElement).closest('.definition-popup')) {
                setDefinitionPopup(null);
                setPopupDragOffset(null);
                window.getSelection()?.removeAllRanges();
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [definitionPopup, isDraggingPopup]);

    // Popup drag handlers
    useEffect(() => {
        if (!isDraggingPopup) return;

        const handleMouseMove = (e: MouseEvent) => {
            if (!popupDragStart.current) return;
            e.preventDefault();
            const dx = e.clientX - popupDragStart.current.mouseX;
            const dy = e.clientY - popupDragStart.current.mouseY;
            setPopupDragOffset({
                x: popupDragStart.current.popupX + dx,
                y: popupDragStart.current.popupY + dy
            });
        };

        const handleMouseUp = () => {
            setIsDraggingPopup(false);
            popupDragStart.current = null;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };

        document.body.style.cursor = 'move';
        document.body.style.userSelect = 'none';
        window.addEventListener('mousemove', handleMouseMove, true);
        window.addEventListener('mouseup', handleMouseUp, true);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove, true);
            window.removeEventListener('mouseup', handleMouseUp, true);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
    }, [isDraggingPopup]);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (isDraggingHeight) {
                e.preventDefault();
                e.stopPropagation();
                const deltaY = dragStartY.current - e.clientY;
                const newHeight = Math.max(54, Math.min(400, dragStartHeight.current + deltaY));
                setTranscriptHeight(newHeight);
            } else if (isDraggingPosition) {
                e.preventDefault();
                e.stopPropagation();
                const deltaY = e.clientY - dragStartY.current;
                const deltaX = e.clientX - dragStartX.current;
                const windowHeight = window.innerHeight;
                const windowWidth = window.innerWidth - 240;
                
                const newBottom = Math.max(0, Math.min(windowHeight - transcriptHeight, dragStartBottom.current - deltaY));
                
                // Check if controls WOULD flip based on current position
                const transcriptTopPosition = windowHeight - newBottom - transcriptHeight;
                const controlHandleHeight = 40;
                const shouldShowControlsBelow = transcriptTopPosition < controlHandleHeight;
                
                // If controls would flip from their starting position, release the drag
                if (shouldShowControlsBelow !== (controlsPositionOnDragStart.current === 'below')) {
                    setIsDraggingPosition(false);
                    document.body.style.cursor = '';
                    document.body.style.userSelect = '';
                    return;
                }
                
                setTranscriptBottom(newBottom);
                
                // Calculate new horizontal offset from center
                const transcriptPixelWidth = (windowWidth * transcriptWidth) / 100;
                const maxOffset = (windowWidth - transcriptPixelWidth) / 2;
                const newOffset = Math.max(-maxOffset, Math.min(maxOffset, dragStartCenterOffset.current + deltaX));
                setTranscriptCenterOffset(newOffset);
            }
        };

        const handleMouseUp = (e: MouseEvent) => {
            if (isDraggingHeight || isDraggingPosition) {
                e.preventDefault();
                e.stopPropagation();
                setIsDraggingHeight(false);
                setIsDraggingPosition(false);
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            }
        };

        if (isDraggingHeight || isDraggingPosition) {
            document.body.style.cursor = isDraggingHeight ? 'ns-resize' : 'move';
            document.body.style.userSelect = 'none';
            window.addEventListener('mousemove', handleMouseMove, true);
            window.addEventListener('mouseup', handleMouseUp, true);
            return () => {
                window.removeEventListener('mousemove', handleMouseMove, true);
                window.removeEventListener('mouseup', handleMouseUp, true);
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            };
        }
    }, [isDraggingHeight, isDraggingPosition, transcriptHeight, transcriptWidth, transcriptBottom, transcriptCenterOffset]);

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

    const handleTranscriptClick = (startTime: number) => {
        if (iframeRef.current?.contentWindow) {
            iframeRef.current.contentWindow.postMessage(
                JSON.stringify({ event: 'command', func: 'seekTo', args: [startTime, true] }),
                '*'
            );
        }
    };

    const showDefinition = (popup: typeof definitionPopup) => {
        setDefinitionPopup(popup);
        if (popup) setPopupDragOffset(null); // Reset drag position for new popups
    };

    const handleTextSelection = async (e: React.MouseEvent) => {
        if (isDraggingHeight || isDraggingPosition) {
            return;
        }

        const target = e.target as HTMLElement;
        if (target.closest('.control-arrows') || target.closest('button')) {
            return;
        }

        const selection = window.getSelection();
        const text = selection?.toString().trim();

        if (!text || text.length < 2) {
            showDefinition(null);
            window.getSelection()?.removeAllRanges();
            return;
        }

        showDefinition({
            text,
            definition: '',
            x: e.clientX,
            y: e.clientY,
            loading: true
        });

        try {
            const context = transcript.map(seg => seg.text).join(' ').slice(0, 500);
            const videoTitle = document.title || 'Tutorial Video';

            const response = await fetch('/api/define', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    term: text,
                    context,
                    videoTitle,
                    userTier,
                    developmentMode: DEVELOPMENT_MODE
                })
            });

            const data = await response.json();

            if (data.requiresUpgrade) {
                setDefinitionPopup({
                    text,
                    definition: `🔒 ${data.message}`,
                    x: e.clientX,
                    y: e.clientY,
                    loading: false
                });
            } else {
                setDefinitionPopup({
                    text,
                    definition: data.definition,
                    x: e.clientX,
                    y: e.clientY,
                    loading: false
                });
            }
        } catch (error) {
            console.error('Definition error:', error);
            setDefinitionPopup({
                text,
                definition: '❌ Definition not available. Please try again.',
                x: e.clientX,
                y: e.clientY,
                loading: false
            });
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
            alert('Invalid YouTube URL. Please enter a valid YouTube URL or ID.');
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
        setShowMenu(false);
        window.location.href = `/watch?url=${videoId}`;
    };

    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    const handleHeightDragStart = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDraggingHeight(true);
        dragStartY.current = e.clientY;
        dragStartHeight.current = transcriptHeight;
    };

    const handlePositionDragStart = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDraggingPosition(true);
        dragStartY.current = e.clientY;
        dragStartX.current = e.clientX;
        dragStartBottom.current = transcriptBottom;
        dragStartCenterOffset.current = transcriptCenterOffset;
        
        const windowHeight = window.innerHeight;
        const transcriptTopPosition = windowHeight - transcriptBottom - transcriptHeight;
        const controlHandleHeight = 40;
        controlsPositionOnDragStart.current = transcriptTopPosition >= controlHandleHeight ? 'above' : 'below';
    };

    // Auto-scroll clarify transcript bar to current segment
    useEffect(() => {
        if (clarifySegmentIndex < 0 || !clarifyScrollRef.current) return;
        const el = clarifyScrollRef.current.querySelector(`[data-clarify-bar-idx="${clarifySegmentIndex}"]`) as HTMLElement;
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
    }, [clarifySegmentIndex]);

    // Save clarify bar layout to localStorage
    useEffect(() => {
        if (typeof window === 'undefined') return;
        try { localStorage.setItem('clarifyBarLayout', JSON.stringify({ bottom: clarifyBarBottom, height: clarifyBarHeight })); } catch {}
    }, [clarifyBarBottom, clarifyBarHeight]);

    // Clarify bar drag handler
    useEffect(() => {
        if (!isDraggingClarifyBar) return;
        const handleMove = (e: MouseEvent) => {
            const delta = clarifyDragStartY.current - e.clientY;
            const newBottom = Math.max(0, Math.min(window.innerHeight - 80, clarifyDragStartBottom.current + delta));
            setClarifyBarBottom(newBottom);
        };
        const handleUp = () => setIsDraggingClarifyBar(false);
        window.addEventListener('mousemove', handleMove);
        window.addEventListener('mouseup', handleUp);
        return () => { window.removeEventListener('mousemove', handleMove); window.removeEventListener('mouseup', handleUp); };
    }, [isDraggingClarifyBar]);

    // Clarify bar resize handler
    useEffect(() => {
        if (!isResizingClarifyBar) return;
        const handleMove = (e: MouseEvent) => {
            const delta = clarifyResizeStartY.current - e.clientY;
            const newHeight = Math.max(30, Math.min(200, clarifyResizeStartHeight.current + delta));
            setClarifyBarHeight(newHeight);
        };
        const handleUp = () => setIsResizingClarifyBar(false);
        window.addEventListener('mousemove', handleMove);
        window.addEventListener('mouseup', handleUp);
        return () => { window.removeEventListener('mousemove', handleMove); window.removeEventListener('mouseup', handleUp); };
    }, [isResizingClarifyBar]);

    const fontSize = Math.max(14, Math.min(32, (transcriptHeight / 54) * 14));
    const showTranscriptBar = expandedSections.has('scroll') || expandedSections.has('definitions');
const windowHeight = typeof window !== 'undefined' ? window.innerHeight : 800;
const windowWidth = typeof window !== 'undefined' ? window.innerWidth - 200 : 1200;
    const transcriptTopPosition = windowHeight - transcriptBottom - transcriptHeight;
    const controlHandleHeight = 40;
    const shouldShowControlsBelow = transcriptTopPosition < controlHandleHeight;
    const transcriptPixelWidth = (windowWidth * transcriptWidth) / 100;
    const transcriptLeft = (windowWidth - transcriptPixelWidth) / 2 + transcriptCenterOffset;
    const controlHandlesLeft = transcriptLeft;

    const formatHMS = (seconds: number) => {
        const s = Math.max(0, Math.floor(seconds));
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
        const ss = String(sec).padStart(2, '0');
        return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
    };

    const remaining = Math.max(0, duration - currentTime);

    if (!videoId) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-100">
                <p className="text-xl text-gray-600">No YouTube URL selected yet</p>
            </div>
        );
    }

    return (
        <>
            <style dangerouslySetInnerHTML={{
                __html: `
                input[type="range"] {
                    -webkit-appearance: none;
                    appearance: none;
                    background: white;
                    outline: none;
                    height: 6px;
                    border-radius: 3px;
                }

                input[type="range"]::-webkit-slider-thumb {
                    -webkit-appearance: none;
                    appearance: none;
                    width: 16px;
                    height: 16px;
                    background: black;
                    cursor: pointer;
                    border-radius: 50%;
                    border: 2px solid white;
                }

                input[type="range"]::-moz-range-thumb {
                    width: 16px;
                    height: 16px;
                    background: black;
                    cursor: pointer;
                    border-radius: 50%;
                    border: 2px solid white;
                }

                input[type="range"]::-moz-range-track {
                    background: white;
                    height: 6px;
                    border-radius: 3px;
                }

                .transcript-scroll::-webkit-scrollbar {
                    height: 8px;
                }
                .transcript-scroll::-webkit-scrollbar-track {
                    background: white;
                    border-radius: 4px;
                }
                .transcript-scroll::-webkit-scrollbar-thumb {
                    background: black;
                    border-radius: 4px;
                    border: 1px solid white;
                }
                .transcript-scroll::-webkit-scrollbar-thumb:hover {
                    background: #333;
                }
            `}} />
            <div className="flex w-full h-screen bg-black">
            <div
                ref={containerRef}
                tabIndex={0}
                className="flex-1 outline-none relative"
                style={{ marginRight: '240px' }}
            >
                {showNudge && (
                    <div className="absolute bottom-20 right-4 z-40 bg-pink-500 text-white px-4 py-3 rounded-lg shadow-2xl max-w-xs">
                        <p className="text-sm font-semibold">
                            👍 Be sure to click the X within the overlay to ensure it does not reappear when using the spacebar.
                        </p>
                    </div>
                )}

                <iframe
                    ref={iframeRef}
                    className="w-full h-full pointer-events-auto"
                    src={`https://www.youtube.com/embed/${videoId}?enablejsapi=1&autoplay=1&disablekb=1&controls=0`}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                />

                {duration > 0 && (
                  <div
                    style={{
                      position: "absolute",
                      left: 20,
                      right: 160,
                      bottom: 14,
                      height: 22,
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "4px 10px",
                      background: "rgba(0,0,0,0.6)",
                      border: "1px solid rgba(255,255,255,0.25)",
                      borderRadius: 10,
                      color: "#fff",
                      zIndex: 40,
                      backdropFilter: "blur(2px)",
                      pointerEvents: "auto",
                      fontSize: 12,
                      lineHeight: 1,
                    }}
                    aria-label="Playback progress"
                  >
                    <div
                      style={{
                        minWidth: 60,
                        textAlign: "left",
                        color: "#ffffff",
                        opacity: 0.9,
                        fontVariantNumeric: "tabular-nums",
                      }}
                      title="Time remaining"
                    >
                      -{formatHMS(remaining)}
                    </div>

                    <div
                      style={{
                        position: "relative",
                        flex: 1,
                        height: 6,
                        background: "#ffffff",
                        borderRadius: 4,
                        overflow: "hidden",
                      }}
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={duration}
                      aria-valuenow={currentTime}
                    >
                      <div
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          bottom: 0,
                          width: `${Math.min(100, (currentTime / duration) * 100)}%`,
                          background:
                            "linear-gradient(90deg, #5a8cff 0%, #2f6df7 60%, #2f6df7 100%)",
                        }}
                      />
                    </div>

                    <div
                      style={{
                        minWidth: 36,
                        textAlign: "right",
                        color: "#a5c0ff",
                        opacity: 0.95,
                        fontWeight: 700,
                        fontVariantNumeric: "tabular-nums",
                      }}
                      title="Playback speed"
                    >
                      {playbackSpeed.toFixed(playbackSpeed % 1 === 0 ? 0 : 2)}x
                    </div>
                  </div>
                )}

                {definitionPopup && (() => {
                    const popupX = popupDragOffset ? popupDragOffset.x : Math.min(definitionPopup.x, window.innerWidth - 400);
                    const popupY = popupDragOffset ? popupDragOffset.y : Math.max(10, definitionPopup.y - 100);
                    return (
                    <div
                        className="definition-popup fixed rounded-lg max-w-md border-2 border-blue-500 z-[9999]"
                        style={{
                            left: `${popupX}px`,
                            top: `${popupY}px`,
                            backgroundColor: 'rgba(255, 255, 255, 0.75)',
                            backdropFilter: 'blur(12px)',
                            WebkitBackdropFilter: 'blur(12px)',
                            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.2)'
                        }}
                    >
                        {/* Draggable header area */}
                        <div
                            className="flex justify-between items-start px-4 pt-3 pb-1 cursor-move select-none"
                            style={{ borderBottom: '1px solid rgba(59,130,246,0.3)' }}
                            onMouseDown={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setIsDraggingPopup(true);
                                popupDragStart.current = {
                                    mouseX: e.clientX,
                                    mouseY: e.clientY,
                                    popupX: popupX,
                                    popupY: popupY
                                };
                            }}
                        >
                            <h4 className="font-bold text-gray-800 text-lg">{definitionPopup.text}</h4>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setDefinitionPopup(null);
                                    setPopupDragOffset(null);
                                    window.getSelection()?.removeAllRanges();
                                }}
                                className="text-gray-500 hover:text-gray-700 text-2xl leading-none ml-2 cursor-pointer"
                            >
                                ×
                            </button>
                        </div>
                        <div className="px-4 pb-3 pt-2">
                            {definitionPopup.loading ? (
                                <p className="text-gray-600 text-sm">⏳ Loading definition...</p>
                            ) : (
                                <p className="text-gray-700 text-sm whitespace-pre-line">{definitionPopup.definition}</p>
                            )}
                        </div>
                    </div>
                    );
                })()}

                {showTranscriptBar && (
                    <>
                        <div
                            className="control-arrows"
                            style={{
                                position: 'fixed',
                                bottom: shouldShowControlsBelow 
                                    ? `${transcriptBottom - 40}px` 
                                    : `${transcriptHeight + transcriptBottom}px`,
                                left: `${controlHandlesLeft}px`,
                                zIndex: 52,
                                display: 'flex',
                                gap: '8px',
                                padding: '4px 12px',
                                backgroundColor: 'white',
                                borderRadius: shouldShowControlsBelow ? '0 0 8px 8px' : '8px 8px 0 0',
                                border: '2px solid black',
                                borderTop: shouldShowControlsBelow ? 'none' : '2px solid black',
                                borderBottom: shouldShowControlsBelow ? '2px solid black' : 'none',
                                boxShadow: shouldShowControlsBelow 
                                    ? '0 2px 4px rgba(0,0,0,0.2)' 
                                    : '0 -2px 4px rgba(0,0,0,0.2)'
                            }}
                        >
                            <div
                                className="cursor-move hover:bg-gray-200 transition-colors rounded px-2 py-1"
                                onMouseDown={handlePositionDragStart}
                                title="Drag to move transcript bar"
                                style={{
                                    border: '2px solid black',
                                    borderRadius: '4px'
                                }}
                            >
                                <div className="text-black text-lg leading-none">↕</div>
                            </div>

                            <div
                                className="cursor-ns-resize hover:bg-gray-200 transition-colors rounded px-2 py-1"
                                onMouseDown={handleHeightDragStart}
                                title="Drag to adjust transcript bar height"
                                style={{
                                    border: '2px solid black',
                                    borderRadius: '4px'
                                }}
                            >
                                <div className="text-black text-lg leading-none">⇕</div>
                            </div>
                        </div>

                        <div
                            style={{
                                position: 'fixed',
                                bottom: `${transcriptBottom}px`,
                                left: `${transcriptLeft}px`,
                                width: `${transcriptPixelWidth}px`,
                                height: `${transcriptHeight}px`,
                                backgroundColor: `rgba(0, 0, 0, ${transcriptOpacity / 100})`,
                                zIndex: 51,
                                borderTop: '4px solid #3b82f6',
                                borderBottom: '3px solid white'
                            }}
                        >
                            <div
                                ref={transcriptRef}
                                className="transcript-scroll w-full h-full overflow-x-auto overflow-y-hidden px-4 text-white flex items-center whitespace-nowrap"
                                style={{
                                    fontSize: `${fontSize}px`,
                                    scrollbarWidth: 'thin',
                                    scrollbarColor: '#000000 #ffffff',
                                    userSelect: 'text'
                                }}
                                onMouseUp={handleTextSelection}
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
                                                isActive ? 'font-bold' : ''
                                            }`}
                                        >
                                            {segment.text}
                                        </span>
                                    );
                                })}
                            </div>
                        </div>
                    </>
                )}

                {/* Clarify Audio Transcript Bar — fixed position, draggable & resizable */}
                {clarifyTranscript.length > 0 && (
                    <div style={{
                        position: 'fixed',
                        bottom: `${clarifyBarBottom}px`,
                        left: 0,
                        right: '240px', /* don't overlap sidebar */
                        height: `${clarifyBarHeight}px`,
                        zIndex: 60,
                        backgroundColor: 'rgba(0, 0, 0, 0.88)',
                        borderTop: '3px solid #3b82f6',
                        display: 'flex',
                        flexDirection: 'column',
                    }}>
                        {/* Resize handle (top edge) */}
                        <div
                            style={{ height: '5px', cursor: 'ns-resize', flexShrink: 0 }}
                            onMouseDown={(e) => {
                                e.preventDefault();
                                clarifyResizeStartY.current = e.clientY;
                                clarifyResizeStartHeight.current = clarifyBarHeight;
                                setIsResizingClarifyBar(true);
                            }}
                        />
                        {/* Drag handle + scrollable content */}
                        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                            {/* Drag handle */}
                            <div
                                style={{
                                    width: '28px', flexShrink: 0, display: 'flex', alignItems: 'center',
                                    justifyContent: 'center', cursor: 'move', color: '#6b7280',
                                    fontSize: '14px', userSelect: 'none', borderRight: '1px solid #374151',
                                }}
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    clarifyDragStartY.current = e.clientY;
                                    clarifyDragStartBottom.current = clarifyBarBottom;
                                    setIsDraggingClarifyBar(true);
                                }}
                                title="Drag to reposition"
                            >
                                ↕
                            </div>
                            {/* Scrollable transcript segments */}
                            <div
                                ref={clarifyScrollRef}
                                style={{
                                    flex: 1,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '2px',
                                    overflowX: 'auto',
                                    overflowY: 'hidden',
                                    whiteSpace: 'nowrap',
                                    padding: '0 8px',
                                    scrollbarWidth: 'thin',
                                    scrollbarColor: '#4b5563 transparent',
                                }}
                            >
                                {clarifyTranscript.map((seg, idx) => {
                                    const isActive = idx === clarifySegmentIndex;
                                    const ts = `${Math.floor(seg.start / 60)}:${String(Math.floor(seg.start % 60)).padStart(2, '0')}`;
                                    return (
                                        <span
                                            key={idx}
                                            data-clarify-bar-idx={idx}
                                            onClick={() => {
                                                if (iframeRef.current?.contentWindow) {
                                                    iframeRef.current.contentWindow.postMessage(
                                                        JSON.stringify({ event: 'command', func: 'seekTo', args: [seg.start, true] }),
                                                        '*'
                                                    );
                                                }
                                            }}
                                            style={{
                                                display: 'inline-block',
                                                padding: '3px 8px',
                                                borderRadius: '4px',
                                                fontSize: '12px',
                                                cursor: 'pointer',
                                                flexShrink: 0,
                                                backgroundColor: isActive ? '#2563eb' : 'transparent',
                                                color: isActive ? '#ffffff' : '#9ca3af',
                                                fontWeight: isActive ? 'bold' : 'normal',
                                                borderBottom: isActive ? '2px solid #22c55e' : '2px solid transparent',
                                                transition: 'background-color 0.15s',
                                            }}
                                            title={`[${ts}] ${seg.text}`}
                                        >
                                            <span style={{
                                                color: isActive ? '#93c5fd' : '#60a5fa',
                                                fontSize: '10px',
                                                marginRight: '4px',
                                                fontWeight: 'bold',
                                            }}>
                                                [{ts}]
                                            </span>
                                            {seg.text.length > 40 ? seg.text.substring(0, 40) + '…' : seg.text}
                                        </span>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Right Panel - Menu */}
            <div style={{
                position: 'fixed',
                right: 0,
                top: 0,
                width: '240px',
                height: '100vh',
                backgroundColor: 'black',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                paddingTop: '20px',
                zIndex: 1000,
                overflowY: 'auto'
            }}>
                <button
                    onClick={() => setShowMenu(!showMenu)}
                    style={{
                        backgroundColor: 'blue',
                        color: 'white',
                        border: 'none',
                        padding: '10px 20px',
                        borderRadius: '5px',
                        cursor: 'pointer',
                        fontSize: '16px',
                        marginBottom: '20px'
                    }}
                >
                    {showMenu ? 'Hide Menu' : 'Show Menu'}
                </button>

                {showMenu && (
                    <div style={{
                        color: 'white',
                        width: '90%',
                        paddingBottom: '20px'
                    }}>
                        <div style={{ backgroundColor: '#1f2937', borderRadius: '8px' }}>
                            {/* 1. SPACEBAR */}
                            <div style={{ borderBottom: '1px solid #374151' }}>
                                <h3
                                    onClick={() => toggleSection('spacebar')}
                                    style={{
                                        fontSize: '16px',
                                        fontWeight: 'bold',
                                        padding: '12px',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center'
                                    }}
                                >
                                    <span>1. SPACEBAR</span>
                                    <span>{expandedSections.has('spacebar') ? '▼' : '▶'}</span>
                                </h3>
                                {expandedSections.has('spacebar') && (
                                    <div style={{ padding: '12px', backgroundColor: '#111827', fontSize: '12px' }}>
                                        <p>In addition to using the standard YouTube controls, the spacebar can be used to start and pause the video.</p>
                                    </div>
                                )}
                            </div>

                            {/* 2. AUDIO CONTROLS */}
                            <div style={{ borderBottom: '1px solid #374151' }}>
                                <h3
                                    onClick={() => toggleSection('audio')}
                                    style={{
                                        fontSize: '16px',
                                        fontWeight: 'bold',
                                        padding: '12px',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center'
                                    }}
                                >
                                    <span>2. AUDIO CONTROLS</span>
                                    <span>{expandedSections.has('audio') ? '▼' : '▶'}</span>
                                </h3>
                                {expandedSections.has('audio') && (
                                    <div style={{ padding: '12px', backgroundColor: '#111827' }}>
                                        <button
                                            onClick={toggleMute}
                                            style={{
                                                width: '100%',
                                                padding: '8px',
                                                borderRadius: '5px',
                                                border: 'none',
                                                cursor: 'pointer',
                                                fontWeight: 'bold',
                                                marginBottom: '12px',
                                                backgroundColor: isMuted ? '#ef4444' : '#22c55e',
                                                color: 'white'
                                            }}
                                        >
                                            {isMuted ? '🔇 Unmute' : '🔊 Mute'}
                                        </button>

                                        <div>
                                            <label style={{ fontSize: '12px', marginBottom: '8px', display: 'block' }}>
                                                Volume: {volume}%
                                            </label>
                                            <input
                                                type="range"
                                                min="0"
                                                max="100"
                                                value={volume}
                                                onChange={(e) => handleVolumeChange(Number(e.target.value))}
                                                style={{ width: '100%' }}
                                            />
                                        </div>

                                        {/* Guidance message for max volume */}
                                        <p style={{ marginTop: '10px', fontSize: '11px', color: '#9ca3af' }}>
                                            If the volume is still not loud enough when the slider is all the way to the 100%, check the audio settings on your computer as they control the maximum value.
                                        </p>
                                    </div>
                                )}
                            </div>

                            {/* 3. PLAYBACK SPEED */}
                            <div style={{ borderBottom: '1px solid #374151' }}>
                                <h3
                                    onClick={() => toggleSection('playback')}
                                    style={{
                                        fontSize: '16px',
                                        fontWeight: 'bold',
                                        padding: '12px',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center'
                                    }}
                                >
                                    <span>3. PLAYBACK SPEED</span>
                                    <span>{expandedSections.has('playback') ? '▼' : '▶'}</span>
                                </h3>
                                {expandedSections.has('playback') && (
                                    <div style={{ padding: '12px', backgroundColor: '#111827' }}>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px' }}>
                                            {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((speed) => (
                                                <button
                                                    key={speed}
                                                    onClick={() => handlePlaybackSpeedChange(speed)}
                                                    style={{
                                                        padding: '6px',
                                                        borderRadius: '5px',
                                                        border: 'none',
                                                        cursor: 'pointer',
                                                        fontSize: '11px',
                                                        fontWeight: 'bold',
                                                        backgroundColor: playbackSpeed === speed ? '#2563eb' : '#374151',
                                                        color: 'white'
                                                    }}
                                                >
                                                    {speed}x
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* 4. SAVED SURFS */}
                            <div style={{ borderBottom: '1px solid #374151' }}>
                                <h3
                                    onClick={() => toggleSection('saved')}
                                    style={{
                                        fontSize: '16px',
                                        fontWeight: 'bold',
                                        padding: '12px',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center'
                                    }}
                                >
                                    <span>4. SAVED SURFS</span>
                                    <span>{expandedSections.has('saved') ? '▼' : '▶'}</span>
                                </h3>
                                {expandedSections.has('saved') && (
                                    <div style={{ padding: '12px', backgroundColor: '#111827', fontSize: '12px' }}>
                                        <div style={{ marginBottom: '12px' }}>
                                            <label style={{ display: 'block', marginBottom: '8px' }}>
                                                Add YouTube Video
                                            </label>
                                            <div style={{ display: 'flex', gap: '4px' }}>
                                                <input
                                                    type="text"
                                                    value={newVideoUrl}
                                                    onChange={(e) => setNewVideoUrl(e.target.value)}
                                                    placeholder="Paste YouTube URL or ID"
                                                    style={{
                                                        flex: 1,
                                                        padding: '6px',
                                                        backgroundColor: '#1f2937',
                                                        border: '1px solid #374151',
                                                        borderRadius: '5px',
                                                        color: 'white',
                                                        fontSize: '11px'
                                                    }}
                                                    onKeyPress={(e) => e.key === 'Enter' && handleAddVideo()}
                                                />
                                                <button
                                                    onClick={handleAddVideo}
                                                    style={{
                                                        padding: '6px 12px',
                                                        backgroundColor: '#2563eb',
                                                        color: 'white',
                                                        border: 'none',
                                                        borderRadius: '5px',
                                                        cursor: 'pointer',
                                                        fontSize: '11px',
                                                        fontWeight: 'bold'
                                                    }}
                                                >
                                                    Add
                                                </button>
                                            </div>
                                        </div>

                                        <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                                            {savedVideos.length === 0 ? (
                                                <p style={{ textAlign: 'center', padding: '12px', color: '#9ca3af' }}>
                                                    No saved videos yet. Add one above!
                                                </p>
                                            ) : (
                                                savedVideos.map((video) => (
                                                    <div
                                                        key={video.id}
                                                        style={{
                                                            backgroundColor: '#1f2937',
                                                            padding: '8px',
                                                            borderRadius: '5px',
                                                            border: '1px solid #374151',
                                                            marginBottom: '8px'
                                                        }}
                                                    >
                                                        <div style={{ display: 'flex', gap: '8px' }}>
                                                            <img
                                                                src={`https://img.youtube.com/vi/${video.id}/default.jpg`}
                                                                alt={video.title}
                                                                style={{
                                                                    width: '60px',
                                                                    height: '45px',
                                                                    objectFit: 'cover',
                                                                    borderRadius: '3px',
                                                                    cursor: 'pointer'
                                                                }}
                                                                onClick={() => handleLoadVideo(video.id)}
                                                            />
                                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                                <h4
                                                                    style={{
                                                                        fontSize: '11px',
                                                                        fontWeight: 'bold',
                                                                        cursor: 'pointer',
                                                                        marginBottom: '4px',
                                                                        overflow: 'hidden',
                                                                        textOverflow: 'ellipsis',
                                                                        display: '-webkit-box',
                                                                        WebkitLineClamp: 2,
                                                                        WebkitBoxOrient: 'vertical'
                                                                    }}
                                                                    onClick={() => handleLoadVideo(video.id)}
                                                                >
                                                                    {video.title}
                                                                </h4>
                                                                <p style={{ fontSize: '10px', color: '#9ca3af', marginBottom: '4px' }}>
                                                                    {formatDate(video.dateSaved)}
                                                                </p>
                                                                <div style={{ display: 'flex', gap: '4px' }}>
                                                                    <button
                                                                        onClick={() => handleTogglePersistent(video.id)}
                                                                        style={{
                                                                            fontSize: '10px',
                                                                            padding: '3px 6px',
                                                                            borderRadius: '3px',
                                                                            border: 'none',
                                                                            cursor: 'pointer',
                                                                            backgroundColor: video.isPersistent ? '#eab308' : '#374151',
                                                                            color: 'white'
                                                                        }}
                                                                    >
                                                                        {video.isPersistent ? '📌 Pinned' : '📌 Pin'}
                                                                    </button>
                                                                    <button
                                                                        onClick={() => handleDeleteVideo(video.id)}
                                                                        style={{
                                                                            fontSize: '10px',
                                                                            padding: '3px 6px',
                                                                            borderRadius: '3px',
                                                                            border: 'none',
                                                                            cursor: 'pointer',
                                                                            backgroundColor: '#ef4444',
                                                                            color: 'white'
                                                                        }}
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
                            <div style={{ borderBottom: '1px solid #374151' }}>
                                <h3
                                    onClick={() => toggleSection('scroll')}
                                    style={{
                                        fontSize: '16px',
                                        fontWeight: 'bold',
                                        padding: '12px',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center'
                                    }}
                                >
                                    <span>5. SCROLL</span>
                                    <span>{expandedSections.has('scroll') ? '▼' : '▶'}</span>
                                </h3>
                                {expandedSections.has('scroll') && (
                                    <div style={{ padding: '12px', backgroundColor: '#111827' }}>
                                        <div style={{ marginBottom: '12px' }}>
                                            <label style={{ fontSize: '12px', marginBottom: '8px', display: 'block' }}>
                                                Opacity: {transcriptOpacity}%
                                            </label>
                                            <input
                                                type="range"
                                                min="10"
                                                max="100"
                                                value={transcriptOpacity}
                                                onChange={(e) => setTranscriptOpacity(Number(e.target.value))}
                                                style={{ width: '100%' }}
                                            />
                                        </div>

                                        <div style={{ marginBottom: '12px' }}>
                                            <label style={{ fontSize: '12px', marginBottom: '8px', display: 'block' }}>
                                                Width: {transcriptWidth}%
                                            </label>
                                            <input
                                                type="range"
                                                min="30"
                                                max="100"
                                                value={transcriptWidth}
                                                onChange={(e) => setTranscriptWidth(Number(e.target.value))}
                                                style={{ width: '100%' }}
                                            />
                                        </div>

                                        <div style={{ fontSize: '11px', color: '#9ca3af' }}>
                                            <p>• Transcript bar appears at bottom of screen</p>
                                            <p>• Use ↕ control to move up/down and left/right</p>
                                            <p>• Use ⇕ control to adjust height</p>
                                            <p>• Click any word to jump to that time</p>
                                            <p>• <strong>Drag across words/phrases in the transcript to see definitions</strong></p>
                                            <p>• Current word is highlighted in blue</p>
                                            <p>• Adjust opacity to see video behind text</p>
                                            {transcriptLoading && <p style={{ color: '#60a5fa' }}>⏳ Loading transcript...</p>}
                                            {transcriptError && <p style={{ color: '#f87171' }}>• {transcriptError}</p>}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* 6. DEFINITIONS */}
                            <div>
                                <h3
                                    onClick={() => toggleSection('definitions')}
                                    style={{
                                        fontSize: '16px',
                                        fontWeight: 'bold',
                                        padding: '12px',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center'
                                    }}
                                >
                                    <span>6. DEFINITIONS</span>
                                    <span>{expandedSections.has('definitions') ? '▼' : '▶'}</span>
                                </h3>
                                {expandedSections.has('definitions') && (
                                    <div style={{ padding: '12px', backgroundColor: '#111827', fontSize: '11px' }}>
                                        <div style={{
                                            backgroundColor: 'rgba(30, 58, 138, 0.3)',
                                            padding: '8px',
                                            borderRadius: '5px',
                                            border: '1px solid #1e40af',
                                            marginBottom: '8px'
                                        }}>
                                            <h4 style={{ fontWeight: 'bold', marginBottom: '6px' }}>📖 How to Get a Definition</h4>
                                            <p style={{ marginBottom: '6px', fontSize: '12px', color: '#93c5fd' }}>
                                                Drag across words/phrases in the transcript below to see definitions
                                            </p>
                                            <ol style={{ paddingLeft: '16px' }}>
                                                <li>Pause the video (spacebar)</li>
                                                <li><strong>Drag across any word or phrase in the transcript below</strong></li>
                                                <li>Definition appears in a popup overlay</li>
                                                <li>Click X to close the definition</li>
                                            </ol>
                                        </div>

                                        <div style={{
                                            backgroundColor: 'rgba(20, 83, 45, 0.3)',
                                            padding: '8px',
                                            borderRadius: '5px',
                                            border: '1px solid #15803d',
                                            marginBottom: '12px'
                                        }}>
                                            <h4 style={{ fontWeight: 'bold', marginBottom: '6px' }}>✨ Features</h4>
                                            <ul style={{ paddingLeft: '16px' }}>
                                                <li>• Dictionary definitions (free)</li>
                                                <li>• Wikipedia summaries (free)</li>
                                                <li>• AI-powered technical definitions</li>
                                                <li>• Context-aware explanations</li>
                                            </ul>
                                        </div>

                                        {/* Language Selector */}
                                        <div style={{
                                            backgroundColor: 'rgba(124, 58, 237, 0.2)',
                                            padding: '8px',
                                            borderRadius: '5px',
                                            border: '1px solid #7c3aed',
                                            marginBottom: '8px'
                                        }}>
                                            <h4 style={{ fontWeight: 'bold', marginBottom: '6px' }}>🌐 Transcript Language</h4>
                                            <select
                                                value={transcriptLanguage}
                                                onChange={(e) => setTranscriptLanguage(e.target.value)}
                                                style={{
                                                    width: '100%',
                                                    padding: '6px 8px',
                                                    backgroundColor: '#1f2937',
                                                    border: '1px solid #374151',
                                                    borderRadius: '5px',
                                                    color: 'white',
                                                    fontSize: '12px',
                                                    cursor: 'pointer'
                                                }}
                                            >
                                                <option value="de">🇩🇪 German (Deutsch)</option>
                                                <option value="en">🇬🇧 English</option>
                                                <option value="es">🇪🇸 Spanish (Español)</option>
                                                <option value="fr">🇫🇷 French (Français)</option>
                                                <option value="it">🇮🇹 Italian (Italiano)</option>
                                                <option value="pt">🇵🇹 Portuguese (Português)</option>
                                            </select>
                                            <p style={{ fontSize: '10px', color: '#a78bfa', marginTop: '4px' }}>
                                                Select the language for the transcript captions. Availability depends on the video.
                                            </p>
                                        </div>

                                        <div style={{
                                            backgroundColor: 'rgba(59, 130, 246, 0.2)',
                                            padding: '8px',
                                            borderRadius: '5px',
                                            border: '1px solid #3b82f6'
                                        }}>
                                            <h4 style={{ fontWeight: 'bold', marginBottom: '6px' }}>📝 Transcript</h4>
                                            <p style={{ marginBottom: '6px', fontSize: '10px', color: '#93c5fd' }}>
                                                The scrolling transcript bar appears at the bottom of the video. Drag across any words or phrases to get instant definitions.
                                            </p>
                                            <p style={{ fontSize: '10px', color: '#9ca3af' }}>
                                                • Use ↕ and ⇕ controls to adjust position and height<br/>
                                                • Click words to jump to that timestamp<br/>
                                                • Current word is highlighted in bold
                                            </p>
                                            {transcriptLoading && <p style={{ color: '#60a5fa', marginTop: '6px' }}>⏳ Loading transcript...</p>}
                                            {transcriptError && <p style={{ color: '#f87171', marginTop: '6px' }}>• {transcriptError}</p>}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* 7. CLARIFY AUDIO */}
                            <div style={{ borderTop: '1px solid #374151' }}>
                                <h3
                                    onClick={() => toggleSection('clarify')}
                                    style={{
                                        fontSize: '16px',
                                        fontWeight: 'bold',
                                        padding: '12px',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center'
                                    }}
                                >
                                    <span>7. CLARIFY AUDIO 🔊</span>
                                    <span>{expandedSections.has('clarify') ? '▼' : '▶'}</span>
                                </h3>
                                {expandedSections.has('clarify') && (
                                    <div style={{ padding: '0', backgroundColor: '#111827' }}>
                                        <ClarifyAudioPanel
                                            videoId={videoId}
                                            currentTime={currentTime}
                                            onSubtitleChange={(subtitle) => {
                                                if (DEVELOPMENT_MODE && subtitle) {
                                                    console.log('[watch] Clarify subtitle:', subtitle);
                                                }
                                            }}
                                            onMuteYouTube={(mute) => {
                                                if (iframeRef.current?.contentWindow) {
                                                    iframeRef.current.contentWindow.postMessage(
                                                        JSON.stringify({ event: 'command', func: mute ? 'mute' : 'unMute' }),
                                                        '*'
                                                    );
                                                    // Only toggle the mute flag — don't destroy volume
                                                    setIsMuted(mute);
                                                    if (!mute) {
                                                        // Restore volume when unmuting
                                                        const restoreVol = volume > 0 ? volume : 100;
                                                        setVolume(restoreVol);
                                                        iframeRef.current.contentWindow.postMessage(
                                                            JSON.stringify({ event: 'command', func: 'setVolume', args: [restoreVol] }),
                                                            '*'
                                                        );
                                                    }
                                                }
                                            }}
                                            onTranscriptReady={(segments) => {
                                                setClarifyTranscript(segments);
                                                setClarifySegmentIndex(-1);
                                            }}
                                            onSegmentChange={(idx) => setClarifySegmentIndex(idx)}
                                        />
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
        </>
    );
}

export default function WatchPage() {
    return (
        <Suspense fallback={<div>Loading...</div>}>
            <WatchPageContent />
        </Suspense>
    );
}