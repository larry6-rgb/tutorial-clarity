'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { ClarifyAudioPanel, SpeakerConfig, previewVoiceAssignments, FEMALE_VOICES, MALE_VOICES } from '../components/ClarifyAudioPanel';

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

    // AI playback speed — persisted to localStorage
    const AI_SPEED_KEY = 'aiPlaybackSpeed';
    const [aiPlaybackSpeed, setAiPlaybackSpeed] = useState(() => {
        if (typeof window === 'undefined') return 1;
        try {
            const saved = localStorage.getItem(AI_SPEED_KEY);
            // Valid range: 0.5 to 3.0
            if (saved) { const v = parseFloat(saved); if (v >= 0.5 && v <= 3) return v; }
        } catch {}
        return 1; // Default: 1x normal speed
    });

    // Speaker voice configuration — persisted per videoId to localStorage
    // NOTE: initialized empty to avoid hydration mismatch, loaded in useEffect below
    const SPEAKER_CONFIG_KEY = `speaker-config-${videoId}`;
    const [speakerConfig, setSpeakerConfig] = useState<SpeakerConfig>({});
    const [detectedSpeakers, setDetectedSpeakers] = useState<string[]>([]);
    const [speakerStateHydrated, setSpeakerStateHydrated] = useState(false);
    const [hasUnsavedVoiceConfig, setHasUnsavedVoiceConfig] = useState(false);
    const [isRegenerating, setIsRegenerating] = useState(false);

    // Clarify bar position/size — persisted to localStorage
    const CLARIFY_BAR_KEY = 'clarifyBarLayout';
    const getInitialClarifyLayout = () => {
        if (typeof window === 'undefined') return { bottom: 0, height: 44 };
        try {
            const saved = localStorage.getItem(CLARIFY_BAR_KEY);
            if (saved) return JSON.parse(saved);
        } catch {}
        return { bottom: 0, height: 44 };
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
    const controlsPositionOnDragStart = useRef<'above' | 'below'>('above');
    // Track whether AI audio was playing when spacebar paused (for resume)
    const aiWasPlayingRef = useRef(false);

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

    // ── YouTube iframe mute status (for robust muting during AI audio) ──
    // 'unmuted' = YT audio is playing normally
    // 'muting' = Mute command sent, waiting for verification
    // 'muted' = Verified muted successfully
    // 'failed' = Mute failed after all retries
    const [ytMuteStatus, setYtMuteStatus] = useState<'unmuted' | 'muting' | 'muted' | 'failed'>('unmuted');
    const ytMuteRetryRef = useRef<NodeJS.Timeout | null>(null);
    const ytMuteAttemptRef = useRef(0);
    const ytMuteVerifiedRef = useRef(false);

    /**
     * ROBUST YouTube iframe mute — with verification and retries.
     * 
     * The YouTube Iframe API sometimes ignores mute commands, especially when
     * sent during state transitions (loading, buffering). This function:
     * 1. Sends both 'mute' AND setVolume(0) commands (belt AND suspenders)
     * 2. Listens for infoDelivery messages to verify the mute worked
     * 3. Retries up to 5 times with 200ms intervals if not verified
     * 4. Shows visual feedback to the user
     */
    const robustMuteYouTube = useCallback((mute: boolean) => {
        const iframe = iframeRef.current?.contentWindow;
        if (!iframe) {
            console.warn('[iframe-mute] No iframe available');
            return;
        }

        // Clear any existing retry timer
        if (ytMuteRetryRef.current) {
            clearInterval(ytMuteRetryRef.current);
            ytMuteRetryRef.current = null;
        }

        if (mute) {
            console.log('[iframe-mute] === MUTING YouTube ===');
            setYtMuteStatus('muting');
            ytMuteAttemptRef.current = 0;
            ytMuteVerifiedRef.current = false;

            // Function to send all mute commands
            const sendMuteCommands = (attempt: number) => {
                console.log(`[iframe-mute] Attempt ${attempt + 1}/5`);
                
                // Method 1: Standard mute command
                iframe.postMessage(
                    JSON.stringify({ event: 'command', func: 'mute', args: [] }), '*'
                );
                
                // Method 2: Set volume to 0 (fallback if mute doesn't work)
                iframe.postMessage(
                    JSON.stringify({ event: 'command', func: 'setVolume', args: [0] }), '*'
                );
                
                // Method 3: Extra mute + volume=0 on retries (no unMute — that causes audio leak)
                if (attempt > 1) {
                    setTimeout(() => {
                        iframe.postMessage(
                            JSON.stringify({ event: 'command', func: 'mute', args: [] }), '*'
                        );
                        iframe.postMessage(
                            JSON.stringify({ event: 'command', func: 'setVolume', args: [0] }), '*'
                        );
                    }, 100);
                }
            };

            // Send initial mute commands
            sendMuteCommands(0);

            // Set up retry loop
            ytMuteRetryRef.current = setInterval(() => {
                ytMuteAttemptRef.current++;
                
                if (ytMuteVerifiedRef.current) {
                    // Mute verified! Stop retrying.
                    console.log('[iframe-mute] ✅ Mute VERIFIED after', ytMuteAttemptRef.current, 'attempts');
                    setYtMuteStatus('muted');
                    if (ytMuteRetryRef.current) clearInterval(ytMuteRetryRef.current);
                    ytMuteRetryRef.current = null;
                    return;
                }

                if (ytMuteAttemptRef.current >= 5) {
                    // Max retries reached
                    console.warn('[iframe-mute] ⚠️ Max retries reached — assuming muted (volume=0 as fallback)');
                    // Final aggressive attempt
                    iframe.postMessage(
                        JSON.stringify({ event: 'command', func: 'setVolume', args: [0] }), '*'
                    );
                    iframe.postMessage(
                        JSON.stringify({ event: 'command', func: 'mute', args: [] }), '*'
                    );
                    setYtMuteStatus('muted'); // Optimistic — volume is 0 at minimum
                    if (ytMuteRetryRef.current) clearInterval(ytMuteRetryRef.current);
                    ytMuteRetryRef.current = null;
                    return;
                }

                // Not yet verified — send commands again
                sendMuteCommands(ytMuteAttemptRef.current);
            }, 200);

        } else {
            // UNMUTING — restore YouTube audio
            console.log('[iframe-mute] === UNMUTING YouTube ===');
            setYtMuteStatus('unmuted');
            ytMuteVerifiedRef.current = false;
            
            // Unmute
            iframe.postMessage(
                JSON.stringify({ event: 'command', func: 'unMute', args: [] }), '*'
            );
            // Restore volume to 100
            iframe.postMessage(
                JSON.stringify({ event: 'command', func: 'setVolume', args: [100] }), '*'
            );
            // Send again after a brief delay for reliability
            setTimeout(() => {
                iframe.postMessage(
                    JSON.stringify({ event: 'command', func: 'unMute', args: [] }), '*'
                );
                iframe.postMessage(
                    JSON.stringify({ event: 'command', func: 'setVolume', args: [100] }), '*'
                );
                console.log('[iframe-mute] ✅ Unmute commands sent (x2)');
            }, 100);
        }
    }, []);

    // ── Ref to ClarifyAudioPanel handlers (for spacebar + video sync control) ──
    const clarifyHandlersRef = useRef<{ play: () => void; pause: () => void; isPlaying: () => boolean; regenerateVoices: (config?: SpeakerConfig) => Promise<void> | void; detectWithAssemblyAI: () => Promise<string[]>; manualDetectSpeakers: () => string[]; testAudioBlobs: () => void; hasAudioBlobs: () => boolean } | null>(null);
    const [assemblyAILoading, setAssemblyAILoading] = useState(false);

    // ── Stable callbacks for ClarifyAudioPanel (prevent re-render unmute bug) ──
    const handleClarifySubtitle = useCallback((subtitle: string | null) => {
        if (subtitle) console.log('[watch] Clarify subtitle:', subtitle);
    }, []);

    const handleClarifyPlayYouTube = useCallback(() => {
        if (iframeRef.current?.contentWindow) {
            iframeRef.current.contentWindow.postMessage(
                JSON.stringify({ event: 'command', func: 'playVideo', args: [] }),
                '*'
            );
            setIsPlaying(true);
        }
    }, []);

    const handleClarifyTranscriptReady = useCallback((segments: any[]) => {
        setClarifyTranscript(segments);
        setClarifySegmentIndex(-1);
    }, []);

    const handleClarifySegmentChange = useCallback((idx: number) => {
        setClarifySegmentIndex(idx);
    }, []);

    const handleClarifyRegisterHandlers = useCallback((handlers: { play: () => void; pause: () => void; isPlaying: () => boolean; regenerateVoices: (config?: SpeakerConfig) => Promise<void> | void; detectWithAssemblyAI: () => Promise<string[]>; manualDetectSpeakers: () => string[]; testAudioBlobs: () => void; hasAudioBlobs: () => boolean }) => {
        clarifyHandlersRef.current = handlers;
        console.log('[watch] ClarifyAudioPanel handlers registered (incl. regenerateVoices, detectWithAssemblyAI, manualDetectSpeakers, testAudioBlobs)');
    }, []);

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
                    // ── Mute verification: check if YouTube actually muted ──
                    if (data.info.muted !== undefined || data.info.volume !== undefined) {
                        const isMutedNow = data.info.muted === true;
                        const volumeNow = data.info.volume ?? -1;
                        
                        // If we're trying to mute, check if it worked
                        if (ytMuteAttemptRef.current > 0 && !ytMuteVerifiedRef.current) {
                            if (isMutedNow || volumeNow === 0) {
                                ytMuteVerifiedRef.current = true;
                                console.log(`[iframe-mute] ✅ VERIFIED: muted=${isMutedNow}, volume=${volumeNow}`);
                            } else {
                                console.log(`[iframe-mute] ⏳ Not yet muted: muted=${isMutedNow}, volume=${volumeNow}`);
                            }
                        }
                    }
                    // ── Video/Audio Sync: detect YouTube play/pause state ──
                    if (data.info.playerState !== undefined) {
                        const state = data.info.playerState;
                        // playerState: -1=unstarted, 0=ended, 1=playing, 2=paused, 3=buffering, 5=cued
                        if (state === 2) {
                            // YouTube PAUSED (user clicked on video or used YT controls)
                            setIsPlaying(false);
                            if (clarifyHandlersRef.current?.isPlaying()) {
                                clarifyHandlersRef.current.pause();
                                console.log('[watch] YouTube paused → auto-paused AI audio');
                            }
                        } else if (state === 1) {
                            // YouTube PLAYING
                            setIsPlaying(true);
                            // Don't auto-resume AI audio — user might have intentionally stopped it
                            // Only log the state change
                            console.log('[watch] YouTube playing');
                        }
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

                console.log(`[watch-spacebar] Pressed. isPlaying=${isPlaying}, aiActive=${clarifyHandlersRef.current?.isPlaying() ?? 'no-ref'}`);

                if (iframeRef.current?.contentWindow) {
                    if (isPlaying) {
                        // ═══ PAUSE everything ═══
                        iframeRef.current.contentWindow.postMessage(
                            JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }),
                            '*'
                        );
                        setIsPlaying(false);

                        // Track if AI audio was playing, then pause it
                        const aiIsPlaying = clarifyHandlersRef.current?.isPlaying() ?? false;
                        aiWasPlayingRef.current = aiIsPlaying;
                        if (aiIsPlaying) {
                            clarifyHandlersRef.current!.pause();
                            console.log('[watch-spacebar] PAUSED: video + AI audio');
                        } else {
                            console.log('[watch-spacebar] PAUSED: video only (AI not active)');
                        }
                    } else {
                        // ═══ PLAY/RESUME everything ═══
                        iframeRef.current.contentWindow.postMessage(
                            JSON.stringify({ event: 'command', func: 'playVideo', args: [] }),
                            '*'
                        );
                        setIsPlaying(true);

                        // Resume AI audio ONLY if it was playing before we paused
                        if (aiWasPlayingRef.current && clarifyHandlersRef.current) {
                            clarifyHandlersRef.current.play();
                            aiWasPlayingRef.current = false;
                            console.log('[watch-spacebar] RESUMED: video + AI audio');
                        } else {
                            console.log('[watch-spacebar] RESUMED: video only');
                        }
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

    // Save AI playback speed to localStorage
    useEffect(() => {
        if (typeof window === 'undefined') return;
        try { localStorage.setItem(AI_SPEED_KEY, String(aiPlaybackSpeed)); } catch {}
    }, [aiPlaybackSpeed]);

    // Hydrate speaker state from localStorage AFTER mount (avoids SSR mismatch)
    useEffect(() => {
        try {
            const savedConfig = localStorage.getItem(`speaker-config-${videoId}`);
            if (savedConfig) {
                const parsed = JSON.parse(savedConfig);
                console.log('[speaker-config] Hydrated from localStorage:', parsed);
                setSpeakerConfig(parsed);
            }
        } catch {}
        try {
            const savedSpeakers = localStorage.getItem(`detected-speakers-${videoId}`);
            if (savedSpeakers) {
                const parsed = JSON.parse(savedSpeakers);
                console.log('[speaker-ui] Hydrated detectedSpeakers from localStorage:', parsed);
                setDetectedSpeakers(parsed);
            }
        } catch {}
        setSpeakerStateHydrated(true);
    }, [videoId]);

    // Save speaker config to localStorage when it changes (skip initial empty state)
    useEffect(() => {
        if (!speakerStateHydrated) return;
        if (Object.keys(speakerConfig).length > 0) {
            try { localStorage.setItem(`speaker-config-${videoId}`, JSON.stringify(speakerConfig)); } catch {}
            console.log('[speaker-config] Saved to localStorage:', speakerConfig);
        }
    }, [speakerConfig, videoId, speakerStateHydrated]);

    // Debug: track detectedSpeakers state changes
    useEffect(() => {
        console.log(`[speaker-ui] detectedSpeakers changed -> ${detectedSpeakers.length} speakers:`, detectedSpeakers);
        console.log(`[speaker-ui] UI visible: ${detectedSpeakers.length > 1}`);
    }, [detectedSpeakers]);

    // Callbacks for speaker config — only GROW the list, never shrink
    const handleSpeakersDetected = useCallback((speakers: string[]) => {
        setDetectedSpeakers(prev => {
            const merged = [...new Set([...prev, ...speakers])].sort();
            console.log(`[speaker-ui] Speakers detected: ${speakers.length} new, ${merged.length} total`, merged);
            // Persist so UI survives remounts / page reload
            try { localStorage.setItem(`detected-speakers-${videoId}`, JSON.stringify(merged)); } catch {}
            return merged;
        });
    }, [videoId]);

    const handleSpeakerGenderChange = useCallback((speakerId: string, gender: 'male' | 'female') => {
        console.log(`[TRACE-1-UI] Radio clicked: ${speakerId} -> ${gender}`);
        setSpeakerConfig(prev => {
            const updated = { ...prev, [speakerId]: gender };
            console.log(`[TRACE-2-STATE] speakerConfig updated:`, updated);
            return updated;
        });
        setHasUnsavedVoiceConfig(true);
    }, []);

    const handleResetSpeakerConfig = useCallback(() => {
        setSpeakerConfig({});
        setHasUnsavedVoiceConfig(false);
        try { localStorage.removeItem(`speaker-config-${videoId}`); } catch {}
        // Keep detectedSpeakers — only clear voice assignments, not speaker list
        console.log('[speaker-config] Reset to default single voice');
        // Also regenerate with default voices
        if (clarifyHandlersRef.current?.regenerateVoices) {
            clarifyHandlersRef.current.regenerateVoices();
        }
    }, [videoId]);

    const handleApplyAndRegenerate = useCallback(async () => {
        console.log('[TRACE-3-APPLY] === APPLY & REGENERATE CLICKED ===');
        console.log('[TRACE-3-APPLY] Current speakerConfig state:', speakerConfig);
        console.log('[TRACE-3-APPLY] Detected speakers:', detectedSpeakers);

        // Build COMPLETE config — alternate male/female by default for distinct voices
        // (Only 2 male voices exist, so 3 males would give duplicate voices)
        const defaultGenders = ['female', 'male', 'female', 'male', 'female', 'male'] as const;
        const fullConfig: SpeakerConfig = {};
        detectedSpeakers.forEach((sid, idx) => {
            fullConfig[sid] = speakerConfig[sid] || defaultGenders[idx % defaultGenders.length];
        });
        console.log('[TRACE-3-APPLY] Full config to save:', fullConfig);

        setIsRegenerating(true);

        // Update React state to the full config so prop flows to ClarifyAudioPanel
        setSpeakerConfig(fullConfig);

        // Save full config to localStorage immediately
        const storageKey = `speaker-config-${videoId}`;
        try {
            localStorage.setItem(storageKey, JSON.stringify(fullConfig));
            // Verify it was saved correctly
            const readBack = localStorage.getItem(storageKey);
            console.log('[TRACE-3-APPLY] Verified localStorage:', readBack);
        } catch (e) {
            console.error('[TRACE-3-APPLY] localStorage save failed:', e);
        }

        // Call ClarifyAudioPanel to clear cache and regenerate — pass config directly
        if (clarifyHandlersRef.current?.regenerateVoices) {
            console.log('[TRACE-4-REGEN] Calling regenerateVoices with:', fullConfig);
            await clarifyHandlersRef.current.regenerateVoices(fullConfig);
            console.log('[TRACE-4-REGEN] Regeneration complete');
        } else {
            console.error('[TRACE-4-REGEN] ERROR: regenerateVoices handler not found!');
        }

        setHasUnsavedVoiceConfig(false);
        setIsRegenerating(false);
        console.log('[TRACE-3-APPLY] Configuration applied successfully');
    }, [speakerConfig, detectedSpeakers, videoId]);

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
                <iframe
                    ref={iframeRef}
                    className="w-full h-full pointer-events-auto"
                    src={`https://www.youtube.com/embed/${videoId}?enablejsapi=1&autoplay=1&controls=1`}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                />

                {duration > 0 && (
                  <div
                    style={{
                      position: "absolute",
                      left: 20,
                      right: 160,
                      bottom: 52,
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
                      title="AI Audio Speed"
                    >
                      {aiPlaybackSpeed.toFixed(aiPlaybackSpeed % 1 === 0 ? 0 : 2)}x
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
                        right: '240px',
                        height: `${clarifyBarHeight}px`,
                        zIndex: 60,
                        backgroundColor: 'rgba(0, 0, 0, 0.92)',
                        borderTop: '3px solid #3b82f6',
                        display: 'flex',
                        flexDirection: 'column',
                    }}>
                        {/* ═══ VISIBLE RESIZE HANDLE (top edge) ═══ */}
                        <div
                            style={{
                                height: '10px', cursor: 'ns-resize', flexShrink: 0,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                backgroundColor: '#1e293b',
                                borderBottom: '1px solid #334155',
                            }}
                            onMouseDown={(e) => {
                                e.preventDefault();
                                clarifyResizeStartY.current = e.clientY;
                                clarifyResizeStartHeight.current = clarifyBarHeight;
                                setIsResizingClarifyBar(true);
                            }}
                            title="Drag up/down to resize"
                        >
                            <span style={{ color: '#64748b', fontSize: '10px', letterSpacing: '3px', userSelect: 'none' }}>
                                ═══════
                            </span>
                        </div>
                        {/* Drag handle + scrollable content */}
                        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                            {/* ⋮⋮ VISIBLE DRAG HANDLE (left edge) ⋮⋮ */}
                            <div
                                style={{
                                    width: '32px', flexShrink: 0, display: 'flex', alignItems: 'center',
                                    justifyContent: 'center', cursor: 'move',
                                    backgroundColor: '#1e40af',
                                    color: '#93c5fd',
                                    fontSize: '16px', userSelect: 'none',
                                    borderRight: '2px solid #2563eb',
                                    transition: 'background-color 0.15s',
                                }}
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    clarifyDragStartY.current = e.clientY;
                                    clarifyDragStartBottom.current = clarifyBarBottom;
                                    setIsDraggingClarifyBar(true);
                                }}
                                onMouseEnter={(e) => { (e.target as HTMLElement).style.backgroundColor = '#1d4ed8'; }}
                                onMouseLeave={(e) => { (e.target as HTMLElement).style.backgroundColor = '#1e40af'; }}
                                title="Drag to move bar up/down"
                            >
                                ⋮⋮
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
                            {/* ═══ AI SPEED DROPDOWN (right end of bar) ═══ */}
                            <div style={{
                                flexShrink: 0,
                                display: 'flex',
                                alignItems: 'center',
                                padding: '0 8px',
                                borderLeft: '2px solid #334155',
                            }}>
                                <select
                                    value={aiPlaybackSpeed}
                                    onChange={(e) => setAiPlaybackSpeed(parseFloat(e.target.value))}
                                    style={{
                                        backgroundColor: '#f97316',
                                        color: '#ffffff',
                                        border: '2px solid #fb923c',
                                        borderRadius: '6px',
                                        padding: '3px 6px',
                                        fontSize: '12px',
                                        fontWeight: 'bold',
                                        cursor: 'pointer',
                                        outline: 'none',
                                        textShadow: '0 1px 2px rgba(0,0,0,0.3)',
                                    }}
                                    title="AI Audio Playback Speed"
                                >
                                    {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3].map(s => (
                                        <option key={s} value={s}>{s}x AI</option>
                                    ))}
                                </select>
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
                                        {/* YouTube mute status indicator */}
                                        {ytMuteStatus !== 'unmuted' && (
                                            <div style={{
                                                padding: '6px 12px',
                                                margin: '4px 8px',
                                                borderRadius: '6px',
                                                fontSize: '12px',
                                                fontWeight: 'bold',
                                                textAlign: 'center',
                                                background: ytMuteStatus === 'muted' ? 'rgba(34, 197, 94, 0.15)'
                                                    : ytMuteStatus === 'muting' ? 'rgba(245, 158, 11, 0.15)'
                                                    : 'rgba(239, 68, 68, 0.15)',
                                                color: ytMuteStatus === 'muted' ? '#22c55e'
                                                    : ytMuteStatus === 'muting' ? '#f59e0b'
                                                    : '#ef4444',
                                                border: `1px solid ${
                                                    ytMuteStatus === 'muted' ? '#22c55e'
                                                    : ytMuteStatus === 'muting' ? '#f59e0b'
                                                    : '#ef4444'
                                                }`,
                                            }}>
                                                {ytMuteStatus === 'muted' && '🔇 YouTube Muted — AI audio playing'}
                                                {ytMuteStatus === 'muting' && '⏳ Muting YouTube...'}
                                                {ytMuteStatus === 'failed' && '⚠️ YouTube mute may have failed — try lowering volume manually'}
                                            </div>
                                        )}
                                        <ClarifyAudioPanel
                                            videoId={videoId}
                                            currentTime={currentTime}
                                            aiPlaybackSpeed={aiPlaybackSpeed}
                                            speakerConfig={Object.keys(speakerConfig).length > 0 ? speakerConfig : undefined}
                                            onSpeakersDetected={handleSpeakersDetected}
                                            onSubtitleChange={handleClarifySubtitle}
                                            onMuteYouTube={robustMuteYouTube}
                                            onPlayYouTube={handleClarifyPlayYouTube}
                                            onTranscriptReady={handleClarifyTranscriptReady}
                                            onSegmentChange={handleClarifySegmentChange}
                                            registerHandlers={handleClarifyRegisterHandlers}
                                        />

                                        {/* ─── SPEAKER VOICE CONFIGURATION (comes first — configure what you want) ─── */}
                                        {detectedSpeakers.length > 1 && (
                                            <div style={{
                                                margin: '10px 8px', padding: '10px',
                                                backgroundColor: '#1e293b', borderRadius: '8px',
                                                border: '1px solid #6366f1',
                                            }}>
                                                <div style={{
                                                    fontSize: '13px', fontWeight: 'bold', color: '#c7d2fe',
                                                    marginBottom: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                                }}>
                                                    <span>{'🎭'} Speaker Voices</span>
                                                    {Object.keys(speakerConfig).length > 0 && (
                                                        <button onClick={handleResetSpeakerConfig} style={{
                                                            background: 'none', border: '1px solid #475569',
                                                            color: '#9ca3af', cursor: 'pointer', fontSize: '10px',
                                                            padding: '2px 6px', borderRadius: '4px',
                                                        }}>Reset</button>
                                                    )}
                                                </div>
                                                <div style={{ fontSize: '10px', color: '#94a3b8', marginBottom: '8px' }}>
                                                    {detectedSpeakers.length} speakers detected.
                                                    {Object.keys(speakerConfig).length === 0
                                                        ? ' Assign male/female for distinct voices.'
                                                        : hasUnsavedVoiceConfig
                                                            ? ' Click Apply to regenerate audio with new voices.'
                                                            : ' Each speaker has a distinct voice.'}
                                                </div>
                                                {detectedSpeakers.length > 3 && (
                                                    <div style={{
                                                        fontSize: '10px', color: '#fbbf24', marginBottom: '8px',
                                                        padding: '5px 8px', backgroundColor: 'rgba(251,191,36,0.1)',
                                                        borderRadius: '4px', lineHeight: '1.4',
                                                        border: '1px solid rgba(251,191,36,0.2)',
                                                    }}>
                                                        {'ℹ️'} <strong>{detectedSpeakers.length} speakers detected.</strong>
                                                        {' '}Configure the first 3 speakers below.
                                                        Speakers 3+ automatically use remaining voices for variety.
                                                    </div>
                                                )}
                                                {(() => {
                                                    const defaultGenders = ['female', 'male', 'female', 'male', 'female', 'male'] as const;
                                                    const previewConfig: SpeakerConfig = {};
                                                    detectedSpeakers.forEach((sid, i) => {
                                                        previewConfig[sid] = speakerConfig[sid] || defaultGenders[i % defaultGenders.length];
                                                    });
                                                    const voiceMap = previewVoiceAssignments(previewConfig);

                                                    return detectedSpeakers.map((speakerId, idx) => {
                                                        const currentGender = previewConfig[speakerId];
                                                        const assignedVoice = voiceMap[speakerId] || 'onyx';
                                                        const isConfigured = !!speakerConfig[speakerId];

                                                        const altGender = currentGender === 'male' ? 'female' : 'male';
                                                        const altConfig = { ...previewConfig, [speakerId]: altGender as 'male' | 'female' };
                                                        const altMap = previewVoiceAssignments(altConfig);
                                                        const maleVoice = currentGender === 'male' ? assignedVoice : altMap[speakerId];
                                                        const femaleVoice = currentGender === 'female' ? assignedVoice : altMap[speakerId];

                                                        // Speakers 3+ are auto-assigned — show read-only label
                                                        const isAutoAssigned = idx >= 3;

                                                        return (
                                                            <div key={speakerId} style={{
                                                                display: 'flex', alignItems: 'center', gap: '8px',
                                                                marginBottom: idx < detectedSpeakers.length - 1 ? '6px' : '0',
                                                                padding: '5px 6px', borderRadius: '4px',
                                                                backgroundColor: isAutoAssigned
                                                                    ? 'rgba(251,191,36,0.08)'
                                                                    : isConfigured ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.03)',
                                                            }}>
                                                                <span style={{
                                                                    fontSize: '11px', color: '#e2e8f0',
                                                                    minWidth: '62px', fontWeight: isConfigured || isAutoAssigned ? 'bold' : 'normal',
                                                                }}>
                                                                    Speaker {idx}
                                                                </span>
                                                                {isAutoAssigned ? (
                                                                    /* Auto-assigned: show voice name with auto label */
                                                                    <span style={{
                                                                        fontSize: '11px', color: '#fbbf24',
                                                                        fontStyle: 'italic',
                                                                    }}>
                                                                        {'🔄'} auto → {assignedVoice}
                                                                    </span>
                                                                ) : (
                                                                    /* Speakers 0-2: user picks male/female */
                                                                    <>
                                                                        <label style={{
                                                                            display: 'flex', alignItems: 'center', gap: '3px',
                                                                            fontSize: '11px', color: currentGender === 'male' ? '#93c5fd' : '#9ca3af',
                                                                            cursor: 'pointer',
                                                                        }}>
                                                                            <input
                                                                                type="radio"
                                                                                name={`speaker-voice-${idx}`}
                                                                                checked={currentGender === 'male'}
                                                                                onChange={() => handleSpeakerGenderChange(speakerId, 'male')}
                                                                                style={{ accentColor: '#6366f1', width: '12px', height: '12px' }}
                                                                            />
                                                                            {'♂'} ({maleVoice})
                                                                        </label>
                                                                        <label style={{
                                                                            display: 'flex', alignItems: 'center', gap: '3px',
                                                                            fontSize: '11px', color: currentGender === 'female' ? '#f9a8d4' : '#9ca3af',
                                                                            cursor: 'pointer',
                                                                        }}>
                                                                            <input
                                                                                type="radio"
                                                                                name={`speaker-voice-${idx}`}
                                                                                checked={currentGender === 'female'}
                                                                                onChange={() => handleSpeakerGenderChange(speakerId, 'female')}
                                                                                style={{ accentColor: '#ec4899', width: '12px', height: '12px' }}
                                                                            />
                                                                            {'♀'} ({femaleVoice})
                                                                        </label>
                                                                    </>
                                                                )}
                                                            </div>
                                                        );
                                                    });
                                                })()}

                                                {/* ── Apply & Regenerate Button ── */}
                                                {hasUnsavedVoiceConfig && (
                                                    <button
                                                        onClick={handleApplyAndRegenerate}
                                                        disabled={isRegenerating}
                                                        style={{
                                                            width: '100%', marginTop: '10px', padding: '8px 16px',
                                                            backgroundColor: isRegenerating ? '#4b5563' : '#10b981',
                                                            color: 'white', border: 'none', borderRadius: '6px',
                                                            fontWeight: 600, fontSize: '12px', cursor: isRegenerating ? 'wait' : 'pointer',
                                                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                                                        }}
                                                    >
                                                        {isRegenerating ? '⏳ Regenerating...' : '🔄 Apply & Regenerate Audio'}
                                                    </button>
                                                )}

                                                {/* ── Test Audio Blobs (diagnostic) ── */}
                                                <button
                                                    onClick={() => {
                                                        if (!clarifyHandlersRef.current?.testAudioBlobs) {
                                                            alert('Test function not available yet. Generate audio first.');
                                                            return;
                                                        }
                                                        if (!clarifyHandlersRef.current.hasAudioBlobs()) {
                                                            alert('No audio blobs in cache yet! Click "Apply & Regenerate Audio" first, then try again.');
                                                            return;
                                                        }
                                                        alert('Playing first 5 audio blobs with 4-second gaps.\n\nOpen browser console (F12) for detailed voice info.\n\nListen carefully — does each blob match its expected voice?');
                                                        clarifyHandlersRef.current.testAudioBlobs();
                                                    }}
                                                    style={{
                                                        width: '100%', marginTop: '6px', padding: '6px 12px',
                                                        backgroundColor: '#7c3aed',
                                                        color: 'white', border: 'none', borderRadius: '6px',
                                                        fontWeight: 600, fontSize: '11px', cursor: 'pointer',
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                                                    }}
                                                >
                                                    {'🧪'} Test Audio Blobs (Play First 5)
                                                </button>

                                                {/* ── Nuclear Clear & Regenerate (diagnostic) ── */}
                                                <button
                                                    onClick={() => {
                                                        console.log('[NUCLEAR] ==========================================');
                                                        console.log('[NUCLEAR] Nuclear Clear button clicked');
                                                        console.log('[NUCLEAR] speakerConfig BEFORE:', JSON.stringify(speakerConfig));
                                                        console.log('[NUCLEAR] detectedSpeakers:', JSON.stringify(detectedSpeakers));

                                                        // Clear all storage
                                                        try { localStorage.clear(); } catch (e) { console.warn('[NUCLEAR] localStorage.clear failed:', e); }
                                                        try { sessionStorage.clear(); } catch (e) { console.warn('[NUCLEAR] sessionStorage.clear failed:', e); }
                                                        console.log('[NUCLEAR] Storage cleared');

                                                        // ★ VISIBLY reset speaker config to alternating defaults
                                                        const nuclearDefaults = ['female', 'male', 'female', 'male', 'female', 'male'] as const;
                                                        const resetConfig: Record<string, 'male' | 'female'> = {};
                                                        detectedSpeakers.forEach((sid, i) => {
                                                            resetConfig[sid] = nuclearDefaults[i % nuclearDefaults.length];
                                                        });
                                                        setSpeakerConfig(resetConfig);
                                                        console.log('[NUCLEAR] ★ Speaker config RESET to:', JSON.stringify(resetConfig));

                                                        const fullConfig = { ...resetConfig };
                                                        console.log('[NUCLEAR] Config to apply:', JSON.stringify(fullConfig));
                                                        if (clarifyHandlersRef.current?.regenerateVoices) {
                                                            console.log('[NUCLEAR] Handler found, calling regenerateVoices...');
                                                            setIsRegenerating(true);
                                                            Promise.resolve(clarifyHandlersRef.current.regenerateVoices(fullConfig)).then(() => {
                                                                console.log('[NUCLEAR] Regeneration complete');
                                                                setIsRegenerating(false);
                                                            }).catch((err: Error) => {
                                                                console.error('[NUCLEAR] Regeneration failed:', err);
                                                                setIsRegenerating(false);
                                                            });
                                                        } else {
                                                            console.error('[NUCLEAR] ERROR: regenerateVoices handler NOT FOUND!');
                                                            console.error('[NUCLEAR] clarifyHandlersRef.current:', clarifyHandlersRef.current);
                                                        }
                                                        console.log('[NUCLEAR] ==========================================');
                                                    }}
                                                    disabled={isRegenerating}
                                                    style={{
                                                        width: '100%', marginTop: '6px', padding: '6px 12px',
                                                        backgroundColor: isRegenerating ? '#4b5563' : '#dc2626',
                                                        color: 'white', border: 'none', borderRadius: '6px',
                                                        fontWeight: 600, fontSize: '11px', cursor: isRegenerating ? 'wait' : 'pointer',
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                                                    }}
                                                >
                                                    {'☢️'} Nuclear Clear & Regenerate
                                                </button>

                                                {/* ── Confirmation when applied ── */}
                                                {!hasUnsavedVoiceConfig && Object.keys(speakerConfig).length > 0 && (
                                                    <div style={{
                                                        fontSize: '10px', color: '#10b981', marginTop: '8px',
                                                        padding: '4px 8px', backgroundColor: 'rgba(16,185,129,0.1)',
                                                        borderRadius: '4px', textAlign: 'center', fontWeight: 600,
                                                    }}>
                                                        {'✅'} Voice configuration applied
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* ─── divider ─── */}
                                        <div style={{ margin: '4px 8px', borderTop: '1px solid #334155' }} />

                                        {/* ─── ASSEMBLYAI SPEAKER DETECTION (optional — re-detect with AI) ─── */}
                                        <div style={{
                                            margin: '10px 8px', padding: '10px',
                                            backgroundColor: '#0f172a', borderRadius: '8px',
                                            border: '1px solid #3b82f6',
                                        }}>
                                            <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#93c5fd', marginBottom: '6px' }}>
                                                {'🎯'} Advanced Speaker Detection
                                            </div>
                                            <p style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '8px', lineHeight: '1.4' }}>
                                                Not satisfied with automatic detection? Use AI to analyze voice
                                                characteristics for more accurate speaker identification.
                                            </p>
                                            <button
                                                onClick={async () => {
                                                    console.log('[UI] AssemblyAI detection button clicked');
                                                    if (!clarifyHandlersRef.current?.detectWithAssemblyAI) {
                                                        console.error('[UI] detectWithAssemblyAI handler not registered');
                                                        return;
                                                    }
                                                    setAssemblyAILoading(true);
                                                    try {
                                                        const speakers = await clarifyHandlersRef.current.detectWithAssemblyAI();
                                                        console.log('[UI] AssemblyAI detection complete:', speakers);
                                                        if (speakers && speakers.length > 1) {
                                                            setDetectedSpeakers(speakers);
                                                        }
                                                    } catch (err: any) {
                                                        console.error('[UI] AssemblyAI detection error:', err);
                                                        alert(`Speaker detection failed: ${err.message || 'Unknown error'}`);
                                                    } finally {
                                                        setAssemblyAILoading(false);
                                                    }
                                                }}
                                                disabled={assemblyAILoading}
                                                style={{
                                                    width: '100%',
                                                    padding: '8px 12px',
                                                    backgroundColor: assemblyAILoading ? '#475569' : '#2563eb',
                                                    color: 'white',
                                                    border: 'none',
                                                    borderRadius: '6px',
                                                    fontSize: '12px',
                                                    fontWeight: 'bold',
                                                    cursor: assemblyAILoading ? 'wait' : 'pointer',
                                                    opacity: assemblyAILoading ? 0.7 : 1,
                                                }}
                                            >
                                                {assemblyAILoading ? (
                                                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ animation: 'spin 1s linear infinite' }}>
                                                            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25" />
                                                            <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" fill="currentColor" opacity="0.75" />
                                                        </svg>
                                                        Analyzing Audio…
                                                    </span>
                                                ) : '🎯 Detect Speakers with AI'}
                                            </button>

                                            {/* ── Manual (Gap-Based) Detection Button ── */}
                                            <button
                                                onClick={() => {
                                                    console.log('[MANUAL] Manual detection button clicked');
                                                    if (!clarifyHandlersRef.current?.manualDetectSpeakers) {
                                                        console.error('[MANUAL] manualDetectSpeakers handler not registered');
                                                        return;
                                                    }
                                                    const speakers = clarifyHandlersRef.current.manualDetectSpeakers();
                                                    console.log('[MANUAL] Detected speakers:', speakers);
                                                    if (speakers && speakers.length > 0) {
                                                        setDetectedSpeakers(speakers);
                                                    }
                                                }}
                                                style={{
                                                    width: '100%',
                                                    marginTop: '6px',
                                                    padding: '6px 12px',
                                                    backgroundColor: '#475569',
                                                    color: 'white',
                                                    border: 'none',
                                                    borderRadius: '6px',
                                                    fontSize: '11px',
                                                    fontWeight: 'bold',
                                                    cursor: 'pointer',
                                                }}
                                            >
                                                {'🔧'} Manual Detection (Gap-Based)
                                            </button>
                                            <p style={{ fontSize: '10px', color: '#64748b', marginTop: '4px', lineHeight: '1.3' }}>
                                                Manual detection uses time gaps to identify speakers (less accurate but faster, no API needed)
                                            </p>
                                        </div>
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