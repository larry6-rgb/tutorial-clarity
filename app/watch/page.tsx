'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { ClarifyAudioPanel, SpeakerConfig } from '../components/ClarifyAudioPanel';

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

// ── TUTORIAL VIDEO ──
// When the tutorial video is ready, paste its YouTube video ID here.
// Example: 'dQw4w9WgXcQ'  (the part after ?v= in the YouTube URL)
// Leave empty to show the "Coming soon" placeholder.
const TUTORIAL_VIDEO_ID = '';

function WatchPageContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const rawUrl = searchParams.get('url');
    const resumeTimestamp = parseInt(searchParams.get('t') || '0', 10);
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
    const openSection = searchParams.get('open') || '';
    const [showMenu, setShowMenu] = useState(!!openSection);
    const [expandedSections, setExpandedSections] = useState<Set<string>>(
        openSection ? new Set([openSection]) : new Set()
    );
    const [volume, setVolume] = useState(100);
    const [isMuted, setIsMuted] = useState(false);
    const [isPlaying, setIsPlaying] = useState(true);
    const [playbackSpeed, setPlaybackSpeed] = useState(1);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [savedVideos, setSavedVideos] = useState<SavedVideo[]>([]);
    const savedVideosLoaded = useRef(false); // prevents sync wiping data before initial load
    const [newVideoUrl, setNewVideoUrl] = useState('');

    // ── RESUME PREVIOUS VIDEO ──
    const RESUME_KEY = 'tc_resume_sessions';
    interface ResumeSession {
        videoId: string;
        title: string;
        timestamp: number;
        duration: number;
        lastWatched: string;
        isPinned?: boolean;
    }
    const [resumeSessions, setResumeSessions] = useState<ResumeSession[]>(() => {
        try {
            const saved = localStorage.getItem(RESUME_KEY);
            return saved ? JSON.parse(saved) : [];
        } catch { return []; }
    });
    // Refs so the interval always has current values without restarting
    const currentTimeRef = useRef(0);
    const durationRef = useRef(0);
    const pinnedResumeRef = useRef<Set<string>>(new Set()); // tracks pinned videoIds reliably
    useEffect(() => { currentTimeRef.current = currentTime; }, [currentTime]);
    useEffect(() => { durationRef.current = duration; }, [duration]);
    // Keep pinnedResumeRef in sync with state
    useEffect(() => {
        pinnedResumeRef.current = new Set(resumeSessions.filter(s => s.isPinned).map(s => s.videoId));
    }, [resumeSessions]);
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
    const [speakerFirstSeen, setSpeakerFirstSeen] = useState<Record<string, number>>({});
    const [speakerStateHydrated, setSpeakerStateHydrated] = useState(false);
    const [hasUnsavedVoiceConfig, setHasUnsavedVoiceConfig] = useState(false);
    const [isRegenerating, setIsRegenerating] = useState(false);

    // ── SUMMARY STATE ──
    const [summaryText, setSummaryText] = useState<string>('');
    const [summaryLoading, setSummaryLoading] = useState(false);
    const [summaryError, setSummaryError] = useState('');
    const [summaryFetched, setSummaryFetched] = useState(false);

    const handleFetchSummary = async () => {
        if (summaryLoading) return;
        setSummaryLoading(true);
        setSummaryError('');
        setSummaryText('');
        try {
            const pageTitle = videoId ? await fetchVideoTitle(videoId) : '';
            const res = await fetch('/api/summarize-video', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ videoId, title: pageTitle }),
            });
            const data = await res.json();
            if (!res.ok || data.error) {
                setSummaryError(data.error || 'Could not generate summary.');
            } else {
                setSummaryText(data.summary);
                setSummaryFetched(true);
            }
        } catch {
            setSummaryError('Network error. Please try again.');
        } finally {
            setSummaryLoading(false);
        }
    };

    // ── TRANSCRIPT DOCUMENT STATE ──
    const [transcriptDoc, setTranscriptDoc] = useState('');
    const [transcriptDocTitle, setTranscriptDocTitle] = useState('');
    const [transcriptDocLoading, setTranscriptDocLoading] = useState(false);
    const [transcriptDocError, setTranscriptDocError] = useState('');
    const [transcriptDocFetched, setTranscriptDocFetched] = useState(false);

    const handleFetchTranscriptDoc = async () => {
        if (transcriptDocLoading) return;
        setTranscriptDocLoading(true);
        setTranscriptDocError('');
        setTranscriptDoc('');
        try {
            const pageTitle = videoId ? await fetchVideoTitle(videoId) : '';
            const res = await fetch('/api/transcript-document', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ videoId, title: pageTitle }),
            });
            const data = await res.json();
            if (!res.ok || data.error) {
                setTranscriptDocError(data.error || 'Could not generate transcript.');
            } else {
                setTranscriptDoc(data.transcript);
                setTranscriptDocTitle(data.title);
                setTranscriptDocFetched(true);
            }
        } catch {
            setTranscriptDocError('Network error. Please try again.');
        } finally {
            setTranscriptDocLoading(false);
        }
    };

    const handleDownloadTranscript = () => {
        const header = `TRANSCRIPT\n${transcriptDocTitle}\n${'─'.repeat(60)}\n\n`;
        const blob = new Blob([header + transcriptDoc], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${transcriptDocTitle.replace(/[^a-z0-9]/gi, '_').slice(0, 60)}_transcript.txt`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handlePrintTranscript = () => {
        const header = `<h2 style="font-family:Georgia,serif;margin-bottom:4px">${transcriptDocTitle}</h2><hr/>`;
        const body = transcriptDoc
            .split('\n\n')
            .map(p => `<p style="font-family:Georgia,serif;font-size:13pt;line-height:1.8;margin-bottom:1em">${p.replace(/\n/g, ' ')}</p>`)
            .join('');
        const win = window.open('', '_blank');
        if (!win) return;
        win.document.write(`<!DOCTYPE html><html><head><title>${transcriptDocTitle}</title><style>body{margin:40px;max-width:800px}</style></head><body>${header}${body}</body></html>`);
        win.document.close();
        win.print();
    };

    // ── ZOOM STATE ──
    const [zoomBase, setZoomBase] = useState<{ sx: number; sy: number; tx: number; ty: number } | null>(null);
    const [zoomSize, setZoomSize] = useState(100);
    const [zoomMode, setZoomMode] = useState(false); // true = draw-box mode active
    const [zoomDrawing, setZoomDrawing] = useState(false);
    const zoomStartRef = useRef<{ x: number; y: number } | null>(null);
    const [zoomRect, setZoomRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
    const videoContainerRef = useRef<HTMLDivElement>(null);
    // Ref so keyboard handler always sees current zoom state without stale closure
    const zoomBaseRef = useRef<{ sx: number; sy: number; tx: number; ty: number } | null>(null);
    useEffect(() => { zoomBaseRef.current = zoomBase; }, [zoomBase]);

    // ── SHERLOCK SPYGLASS STATE ──
    const [spyglassMode, setSpyglassMode] = useState(false);
    const [spyglassPos, setSpyglassPos] = useState<{ x: number; y: number } | null>(null);
    const [spyglassZoom, setSpyglassZoom] = useState(2.5);
    const [spyglassRadius, setSpyglassRadius] = useState(120); // px — lens circle radius
    const spyglassModeRef = useRef(false);
    useEffect(() => { spyglassModeRef.current = spyglassMode; }, [spyglassMode]);
    const lensIframeRef = useRef<HTMLIFrameElement>(null);
    // Build lens src with start= baked in when spyglass activates — most reliable sync method
    const [lensIframeSrc, setLensIframeSrc] = useState<string | null>(null);
    useEffect(() => {
        if (spyglassMode) {
            const t = Math.floor(currentTimeRef.current);
            setLensIframeSrc(`https://www.youtube.com/embed/${videoId}?enablejsapi=1&autoplay=1&controls=0&mute=1&start=${t}`);
            // autoplay=1 gets us to the right frame, then we freeze it
            const pauseTimer = setTimeout(() => {
                lensIframeRef.current?.contentWindow?.postMessage(
                    JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }), '*'
                );
            }, 800);
            return () => clearTimeout(pauseTimer);
        } else {
            setLensIframeSrc(null);
        }
    }, [spyglassMode, videoId]);

    // Derive CSS transform from base + size slider
    const zoomTransform = zoomBase ? (() => {
        const f = zoomSize / 100;
        const sx = zoomBase.sx * f;
        const sy = zoomBase.sy * f;
        const container = videoContainerRef.current;
        const W = container?.offsetWidth ?? 0;
        const H = container?.offsetHeight ?? 0;
        const tx = zoomBase.tx * f + (W * (1 - f)) / 2;
        const ty = zoomBase.ty * f + (H * (1 - f)) / 2;
        return { scale: `${sx}, ${sy}`, translate: `${tx}px, ${ty}px` };
    })() : null;

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
    // Captures auto-detected genders from the onSpeakersDetected callback so the button handler can apply them
    const detectedGenderMapRef = useRef<Record<string, 'male' | 'female'>>({});
    const [assemblyAILoading, setAssemblyAILoading] = useState(false);
    const [detectionRun, setDetectionRun] = useState(false);
    const [unknownSpeakerPrompt, setUnknownSpeakerPrompt] = useState<{ speakerId: string; assign: (gender: 'male' | 'female' | null) => void } | null>(null);

    // ── Stable callbacks for ClarifyAudioPanel (prevent re-render unmute bug) ──
    const fmtTime = (sec: number) => { const m = Math.floor(sec / 60); const s = Math.floor(sec % 60); return `${m}:${s.toString().padStart(2, '0')}`; };
    const [clarifySubtitle, setClarifySubtitle] = useState<string | null>(null);
    const handleClarifySubtitle = useCallback((subtitle: string | null) => {
        setClarifySubtitle(subtitle);
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

    const handleUnknownSpeaker = useCallback((speakerId: string, assign: (gender: 'male' | 'female' | null) => void) => {
        setUnknownSpeakerPrompt({ speakerId, assign });
    }, []);

    // Load saved videos — API file is the source of truth (written by extension),
    // localStorage is a fallback for videos added via the paste box before extension was set up.
    useEffect(() => {
        async function loadSavedVideos() {
            let apiVideos: SavedVideo[] = [];
            try {
                const res = await fetch('/api/save-video');
                if (res.ok) apiVideos = await res.json();
            } catch {
                console.log('[saved-videos] API not available, using localStorage only');
            }

            // Merge with any localStorage videos (backward compat)
            const stored = localStorage.getItem('tutorialClaritySavedVideos');
            const localVideos: SavedVideo[] = stored ? JSON.parse(stored) : [];

            // Combine — API videos take precedence, add any local-only ones
            const merged = [...apiVideos];
            localVideos.forEach(lv => {
                if (!merged.some(v => v.id === lv.id)) merged.push(lv);
            });

            setSavedVideos(merged);
            savedVideosLoaded.current = true; // now safe to sync changes back

            // If we had local-only videos, clear them (now stored in API)
            if (localVideos.length > 0) {
                localStorage.removeItem('tutorialClaritySavedVideos');
            }
        }
        loadSavedVideos();
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

    // Sync savedVideos state to API file whenever it changes
    // Guard: don't run until initial load is complete (prevents wiping data on mount)
    useEffect(() => {
        if (!savedVideosLoaded.current) return;
        fetch('/api/save-video', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(savedVideos),
        }).catch(() => {
            // Fallback to localStorage if API unavailable
            if (savedVideos.length > 0) {
                localStorage.setItem('tutorialClaritySavedVideos', JSON.stringify(savedVideos));
            }
        });
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
            // Ignore messages from the lens iframe — only process main player events
            if (lensIframeRef.current && event.source === lensIframeRef.current.contentWindow) return;

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
            // Exception: always allow spacebar to exit zoom mode
            const activeTag = (document.activeElement?.tagName || '').toLowerCase();
            if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') {
                if (!(e.code === 'Space' && zoomBaseRef.current)) return;
            }
            if (e.code === 'Space') {
                e.preventDefault();
                e.stopPropagation();

                // Exit spyglass mode and resume play
                if (spyglassModeRef.current) {
                    setSpyglassMode(false);
                    setSpyglassPos(null);
                    if (iframeRef.current?.contentWindow) {
                        iframeRef.current.contentWindow.postMessage(
                            JSON.stringify({ event: 'command', func: 'playVideo', args: [] }), '*'
                        );
                    }
                    setIsPlaying(true);
                    return;
                }

                // Exit zoom mode and resume play
                if (zoomBaseRef.current) {
                    setZoomBase(null);
                    setZoomMode(false);
                    setZoomRect(null);
                    if (iframeRef.current?.contentWindow) {
                        iframeRef.current.contentWindow.postMessage(
                            JSON.stringify({ event: 'command', func: 'playVideo', args: [] }), '*'
                        );
                    }
                    setIsPlaying(true);
                    return;
                }

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

            // ── Shortcut: M — Toggle mute ──
            if (e.key === 'm' || e.key === 'M') {
                e.preventDefault();
                toggleMute();
            }

            // ── Shortcut: , / . — Speed down / up ──
            const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
            if (e.key === ',') {
                e.preventDefault();
                const idx = speeds.indexOf(playbackSpeed);
                if (idx > 0) handlePlaybackSpeedChange(speeds[idx - 1]);
            }
            if (e.key === '.') {
                e.preventDefault();
                const idx = speeds.indexOf(playbackSpeed);
                if (idx < speeds.length - 1) handlePlaybackSpeedChange(speeds[idx + 1]);
            }

            // ── Navigation shortcuts — open menu and jump to section ──
            const navKey = e.key.toUpperCase();
            const sectionMap: Record<string, string> = {
                'S': 'saved',
                'A': 'clarify',
                'V': 'clarify',   // Speaker Voices lives inside the Clarify Audio section
                'T': 'scroll',
                'Z': 'zoom',
                'R': 'resume',
                'U': 'summary',
                'X': 'transcriptdoc',
                'K': 'shortcuts',
                '?': 'tutorial',
            };
            if (sectionMap[navKey]) {
                e.preventDefault();
                setShowMenu(true);
                setExpandedSections(prev => {
                    const newSet = new Set(prev);
                    newSet.add(sectionMap[navKey]);
                    return newSet;
                });
            }

        };

        window.addEventListener('keydown', handleKeyPress, true);
        return () => {
            window.removeEventListener('keydown', handleKeyPress, true);
        };
    }, [isPlaying, zoomTransform, playbackSpeed, isMuted]);

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
        // Slave AI audio speed to video speed — both must move together
        // so the translated voice stays in sync with the video pace.
        setAiPlaybackSpeed(speed);
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

    const formatTimestamp = (seconds: number) => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    const handleResumeVideo = (session: ResumeSession) => {
        setShowMenu(false);
        window.location.href = `/watch?url=${session.videoId}&t=${session.timestamp}`;
    };

    const handleClearResume = (videoId: string) => {
        setResumeSessions(prev => {
            const updated = prev.filter(s => s.videoId !== videoId);
            try { localStorage.setItem(RESUME_KEY, JSON.stringify(updated)); } catch {}
            return updated;
        });
    };

    const handleToggleResumePin = (videoId: string) => {
        setResumeSessions(prev => {
            const updated = prev.map(s =>
                s.videoId === videoId ? { ...s, isPinned: !s.isPinned } : s
            );
            try { localStorage.setItem(RESUME_KEY, JSON.stringify(updated)); } catch {}
            return updated;
        });
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
        // Do NOT restore speakerConfig — user must always assign genders fresh after detection
        // Load detected speakers list only (so the panel shows the right speakers)
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
    const handleSpeakersDetected = useCallback((speakers: string[], firstSeenAt?: Record<string, number>, genderMap?: Record<string, 'male' | 'female'>) => {
        // Store auto-detected genders in ref so button handler can apply them
        detectedGenderMapRef.current = genderMap || {};
        console.log('[speaker-ui] Auto-detected genders stored:', genderMap);
        setSpeakerConfig({});
        setHasUnsavedVoiceConfig(false);
        try { localStorage.removeItem(`speaker-config-${videoId}`); } catch {}

        if (firstSeenAt) setSpeakerFirstSeen(firstSeenAt);

        setDetectedSpeakers(prev => {
            const merged = [...new Set([...prev, ...speakers])].sort();
            console.log(`[speaker-ui] Speakers detected: ${speakers.length} new, ${merged.length} total`, merged);
            try { localStorage.setItem(`detected-speakers-${videoId}`, JSON.stringify(merged)); } catch {}
            return merged;
        });
    }, [videoId]);

    // Reset zoom and spyglass when navigating to a new video
    useEffect(() => {
        setZoomBase(null);
        setZoomSize(100);
        setZoomMode(false);
        setZoomRect(null);
        setSpyglassMode(false);
        setSpyglassPos(null);
        setSpyglassZoom(2.5);
        setSpyglassRadius(120);
    }, [videoId]);

    // ── SEEK to resume timestamp once video is ready ──
    useEffect(() => {
        if (!resumeTimestamp || resumeTimestamp < 1) return;
        // Wait for iframe to be ready, then seek
        const timer = setTimeout(() => {
            if (iframeRef.current?.contentWindow) {
                iframeRef.current.contentWindow.postMessage(
                    JSON.stringify({ event: 'command', func: 'seekTo', args: [resumeTimestamp, true] }),
                    '*'
                );
                console.log(`[resume] Seeked to ${resumeTimestamp}s`);
            }
        }, 3000); // give YouTube 3s to load before seeking
        return () => clearTimeout(timer);
    }, [resumeTimestamp]);

    // ── AUTO-SAVE resume session every 10 seconds while watching ──
    // Uses refs for currentTime/duration so interval never restarts mid-countdown
    useEffect(() => {
        if (!videoId) return;
        const interval = setInterval(() => {
            const t = Math.floor(currentTimeRef.current);
            if (t < 5) return; // don't save until 5s in
            const title = document.title.replace(' - YouTube', '').trim() || 'Untitled Video';
            const session: ResumeSession = {
                videoId,
                title,
                timestamp: t,
                duration: Math.floor(durationRef.current),
                lastWatched: new Date().toISOString(),
            };
            setResumeSessions(prev => {
                const existing = prev.find(s => s.videoId === videoId);
                const isPinned = pinnedResumeRef.current.has(videoId);

                // Auto-remove if finished (within 30s of end) — unless pinned
                const isFinished = session.duration > 0 && (session.duration - t) < 30;
                if (isFinished && !isPinned) {
                    const updated = prev.filter(s => s.videoId !== videoId);
                    try { localStorage.setItem(RESUME_KEY, JSON.stringify(updated)); } catch {}
                    return updated;
                }

                // Preserve pin status when updating
                const updatedSession = { ...session, isPinned: isPinned || existing?.isPinned || false };
                const filtered = prev.filter(s => s.videoId !== videoId);
                const updated = [updatedSession, ...filtered].slice(0, 10);
                try { localStorage.setItem(RESUME_KEY, JSON.stringify(updated)); } catch {}
                return updated;
            });
        }, 10000);
        return () => clearInterval(interval);
    }, [videoId]);

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
                {/* ── Video wrapper — clips zoomed iframe ── */}
                <div
                    ref={videoContainerRef}
                    style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}
                >
                    {/* Background iframe — always unzoomed, dimmed during spyglass */}
                    <iframe
                        ref={iframeRef}
                        className="w-full h-full"
                        style={{
                            pointerEvents: (zoomTransform || spyglassMode) ? 'none' : 'auto',
                            transformOrigin: '0 0',
                            transform: zoomTransform && !spyglassMode
                                ? `translate(${zoomTransform.translate}) scale(${zoomTransform.scale})`
                                : 'none',
                            transition: (zoomTransform && !spyglassMode) ? 'transform 0.2s ease' : 'none',
                            filter: zoomTransform && !spyglassMode
                                ? 'contrast(1.35) saturate(1.15) brightness(1.04)'
                                : spyglassMode ? 'brightness(0.35)' : 'none',
                        }}
                        src={`https://www.youtube.com/embed/${videoId}?enablejsapi=1&autoplay=1&controls=1`}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                    />

                    {/* Spyglass lens iframe — zoomed, clipped to lens circle */}
                    {spyglassMode && (
                        <iframe
                            ref={lensIframeRef}
                            className="w-full h-full"
                            style={{
                                position: 'absolute', inset: 0,
                                pointerEvents: 'none',
                                transformOrigin: '0 0',
                                transform: spyglassPos ? (() => {
                                    const tx = spyglassPos.x * (1 - spyglassZoom);
                                    const ty = spyglassPos.y * (1 - spyglassZoom);
                                    return `translate(${tx}px, ${ty}px) scale(${spyglassZoom})`;
                                })() : 'none',
                                clipPath: spyglassPos
                                    ? `circle(${spyglassRadius}px at ${spyglassPos.x}px ${spyglassPos.y}px)`
                                    : 'circle(0px at 0px 0px)',
                                filter: 'contrast(1.35) saturate(1.15) brightness(1.04)',
                            }}
                            src={lensIframeSrc ?? ''}
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        />
                    )}

                    {/* ── Zoom + Spyglass buttons — appear when paused and not in any mode ── */}
                    {!isPlaying && !zoomBase && !zoomMode && !spyglassMode && (
                        <div style={{ position: 'absolute', bottom: 12, right: 12, zIndex: 10, display: 'flex', gap: '8px' }}>
                            <button
                                onClick={(e) => { e.stopPropagation(); setZoomMode(true); }}
                                style={{
                                    backgroundColor: 'rgba(0,0,0,0.75)', color: '#facc15',
                                    border: '1px solid #facc15', borderRadius: '6px',
                                    padding: '6px 12px', fontSize: '13px', fontWeight: 'bold',
                                    cursor: 'pointer',
                                }}
                            >
                                🔍 Zoom
                            </button>
                            <button
                                onClick={(e) => { e.stopPropagation(); setSpyglassMode(true); }}
                                style={{
                                    backgroundColor: 'rgba(0,0,0,0.75)', color: '#a78bfa',
                                    border: '1px solid #a78bfa', borderRadius: '6px',
                                    padding: '6px 12px', fontSize: '13px', fontWeight: 'bold',
                                    cursor: 'pointer',
                                }}
                            >
                                🕵️ Spyglass
                            </button>
                        </div>
                    )}

                    {/* ── Spyglass overlay — active when spyglassMode is on ── */}
                    {spyglassMode && (
                        <div
                            style={{ position: 'absolute', inset: 0, cursor: 'none', zIndex: 10 }}
                            onMouseMove={e => {
                                const rect = videoContainerRef.current!.getBoundingClientRect();
                                setSpyglassPos({
                                    x: e.clientX - rect.left,
                                    y: e.clientY - rect.top,
                                });
                            }}
                            onMouseLeave={() => setSpyglassPos(null)}
                        >
                            {/* Golden lens ring */}
                            {spyglassPos && (
                                <div style={{
                                    position: 'absolute', pointerEvents: 'none',
                                    left: spyglassPos.x - spyglassRadius,
                                    top: spyglassPos.y - spyglassRadius,
                                    width: spyglassRadius * 2,
                                    height: spyglassRadius * 2,
                                    borderRadius: '50%',
                                    border: '3px solid #facc15',
                                    boxShadow: '0 0 0 1px rgba(250,204,21,0.3), inset 0 0 12px rgba(250,204,21,0.08)',
                                }} />
                            )}
                            {/* Zoom level controls */}
                            <div style={{
                                position: 'absolute', top: 12, left: '50%',
                                transform: 'translateX(-50%)',
                                backgroundColor: 'rgba(0,0,0,0.8)', color: '#a78bfa',
                                padding: '8px 16px', borderRadius: '8px',
                                fontSize: '13px', fontWeight: 'bold',
                                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px',
                                whiteSpace: 'nowrap', pointerEvents: 'auto',
                            }}
                            onMouseMove={e => e.stopPropagation()}>
                                <span>🕵️ Spyglass — move mouse to explore · Spacebar to resume</span>
                                {/* Lens size slider */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'normal', fontSize: '12px' }}>
                                    <span>🔍 Size:</span>
                                    <input
                                        type="range" min={60} max={240} step={10} value={spyglassRadius}
                                        onChange={e => setSpyglassRadius(Number(e.target.value))}
                                        style={{ width: '120px', cursor: 'pointer' }}
                                    />
                                    <span>{spyglassRadius}px</span>
                                </div>
                                {/* Zoom level buttons */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'normal', fontSize: '12px' }}>
                                    <span>🔎 Zoom:</span>
                                    <button onClick={() => setSpyglassZoom(z => Math.max(1.5, z - 0.5))}
                                        style={{ background: '#374151', color: 'white', border: 'none', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer', fontSize: '14px' }}>−</button>
                                    <span style={{ minWidth: '30px', textAlign: 'center' }}>{spyglassZoom}x</span>
                                    <button onClick={() => setSpyglassZoom(z => Math.min(5, z + 0.5))}
                                        style={{ background: '#374151', color: 'white', border: 'none', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer', fontSize: '14px' }}>+</button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ── Zoom draw overlay — visible when zoomMode is active ── */}
                    {zoomMode && !zoomBase && (
                        <div
                            style={{ position: 'absolute', inset: 0, cursor: 'crosshair', zIndex: 10 }}
                            onMouseDown={e => {
                                const rect = videoContainerRef.current!.getBoundingClientRect();
                                zoomStartRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
                                setZoomDrawing(true);
                                setZoomRect(null);
                            }}
                            onMouseMove={e => {
                                if (!zoomDrawing || !zoomStartRef.current) return;
                                const rect = videoContainerRef.current!.getBoundingClientRect();
                                const cx = e.clientX - rect.left;
                                const cy = e.clientY - rect.top;
                                setZoomRect({
                                    x: Math.min(zoomStartRef.current.x, cx),
                                    y: Math.min(zoomStartRef.current.y, cy),
                                    w: Math.abs(cx - zoomStartRef.current.x),
                                    h: Math.abs(cy - zoomStartRef.current.y),
                                });
                            }}
                            onMouseUp={() => {
                                setZoomDrawing(false);
                                if (!zoomRect || zoomRect.w < 20 || zoomRect.h < 20) {
                                    setZoomRect(null);
                                    return;
                                }
                                const container = videoContainerRef.current!;
                                const W = container.offsetWidth;
                                const H = container.offsetHeight;
                                const sx = W / zoomRect.w;
                                const sy = H / zoomRect.h;
                                setZoomBase({ sx, sy, tx: -zoomRect.x * sx, ty: -zoomRect.y * sy });
                                setZoomSize(100);
                                setZoomRect(null);
                            }}
                        >
                            {/* Draw the selection rectangle as user drags */}
                            {zoomRect && zoomRect.w > 4 && zoomRect.h > 4 && (
                                <div style={{
                                    position: 'absolute',
                                    left: zoomRect.x, top: zoomRect.y,
                                    width: zoomRect.w, height: zoomRect.h,
                                    border: '2px solid #facc15',
                                    backgroundColor: 'rgba(250,204,21,0.1)',
                                    pointerEvents: 'none',
                                }} />
                            )}
                            {/* Hint text */}
                            <div style={{
                                position: 'absolute', bottom: 12, left: '50%',
                                transform: 'translateX(-50%)',
                                backgroundColor: 'rgba(0,0,0,0.7)', color: '#facc15',
                                padding: '4px 12px', borderRadius: '4px',
                                fontSize: '13px', fontWeight: 'bold', pointerEvents: 'none',
                                whiteSpace: 'nowrap',
                            }}>
                                🔍 Draw a box to zoom — Spacebar to resume
                            </div>
                        </div>
                    )}

                    {/* ── Zoom active indicator + size slider ── */}
                    {zoomTransform && (
                        <div style={{
                            position: 'absolute', bottom: 12, left: '50%',
                            transform: 'translateX(-50%)',
                            backgroundColor: 'rgba(0,0,0,0.8)', color: '#facc15',
                            padding: '8px 16px', borderRadius: '8px',
                            fontSize: '13px', fontWeight: 'bold',
                            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px',
                            whiteSpace: 'nowrap',
                        }}>
                            <span>🔍 Zoomed — Press Spacebar to exit and resume</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'normal', fontSize: '12px' }}>
                                <span>Smaller</span>
                                <input
                                    type="range" min={40} max={100} value={zoomSize}
                                    onChange={e => setZoomSize(Number(e.target.value))}
                                    style={{ width: '140px', cursor: 'pointer' }}
                                />
                                <span>Larger</span>
                            </div>
                        </div>
                    )}
                </div>

                {/* ── AI subtitle overlay ── */}
                {clarifySubtitle && (
                    <div style={{
                        position: 'absolute', bottom: '80px', left: '50%', transform: 'translateX(-50%)',
                        maxWidth: '80%', padding: '6px 16px', borderRadius: '4px',
                        backgroundColor: 'rgba(0,0,0,0.75)', color: 'white',
                        fontSize: '18px', fontWeight: 500, textAlign: 'center',
                        pointerEvents: 'none', lineHeight: 1.4,
                        textShadow: '0 1px 3px rgba(0,0,0,0.9)',
                    }}>
                        {clarifySubtitle}
                    </div>
                )}

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

                {/* ── UNKNOWN SPEAKER POPUP ── */}
                {unknownSpeakerPrompt && (
                    <div style={{
                        position: 'fixed', inset: 0, zIndex: 99999,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        backgroundColor: 'rgba(0,0,0,0.7)',
                    }}>
                        <div style={{
                            backgroundColor: '#1e293b', borderRadius: '12px',
                            padding: '24px', maxWidth: '340px', width: '100%',
                            border: '1px solid #6366f1', boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                            textAlign: 'center',
                        }}>
                            <div style={{ fontSize: '28px', marginBottom: '10px' }}>🎤</div>
                            <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#e2e8f0', marginBottom: '4px' }}>
                                New Speaker Detected
                            </div>
                            <div style={{ fontSize: '12px', color: '#6366f1', fontWeight: 'bold', marginBottom: '8px' }}>
                                {`Speaker ${parseInt(unknownSpeakerPrompt.speakerId.replace('speaker_', ''))}`} is speaking right now
                            </div>
                            <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '20px', lineHeight: '1.5' }}>
                                Would you like to assign them a gender going forward?
                            </div>
                            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                                <button onClick={() => { unknownSpeakerPrompt.assign('male'); setUnknownSpeakerPrompt(null); }} style={{
                                    padding: '10px 20px', backgroundColor: '#3b82f6', color: 'white',
                                    border: 'none', borderRadius: '8px', cursor: 'pointer',
                                    fontSize: '14px', fontWeight: 'bold',
                                }}>♂ Male</button>
                                <button onClick={() => { unknownSpeakerPrompt.assign('female'); setUnknownSpeakerPrompt(null); }} style={{
                                    padding: '10px 20px', backgroundColor: '#ec4899', color: 'white',
                                    border: 'none', borderRadius: '8px', cursor: 'pointer',
                                    fontSize: '14px', fontWeight: 'bold',
                                }}>♀ Female</button>
                                <button onClick={() => { unknownSpeakerPrompt.assign(null); setUnknownSpeakerPrompt(null); }} style={{
                                    padding: '10px 20px', backgroundColor: '#475569', color: '#e2e8f0',
                                    border: 'none', borderRadius: '8px', cursor: 'pointer',
                                    fontSize: '14px',
                                }}>Skip</button>
                            </div>
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

                            {/* 4. SAVED FOR FUTURE VIEWING */}
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
                                    <span>4. SAVED FOR FUTURE VIEWING</span>
                                    <span>{expandedSections.has('saved') ? '▼' : '▶'}</span>
                                </h3>
                                {expandedSections.has('saved') && (
                                    <div style={{ padding: '12px', backgroundColor: '#111827', fontSize: '12px' }}>

                                        {/* ── Extension setup instructions ── */}
                                        <div style={{
                                            backgroundColor: 'rgba(37,99,235,0.12)', border: '1px solid #2563eb',
                                            borderRadius: '8px', padding: '10px 12px', marginBottom: '14px',
                                        }}>
                                            <div style={{ fontWeight: 'bold', color: '#60a5fa', marginBottom: '6px', fontSize: '13px' }}>
                                                🧩 One-Click Saving from YouTube
                                            </div>
                                            <p style={{ margin: '0 0 8px 0', color: '#d1d5db', lineHeight: '1.6' }}>
                                                Install the Tutorial Clarity browser extension once, and you can save any YouTube video with a double-tap of the <strong>Alt key</strong> — without ever leaving YouTube.
                                            </p>
                                            <div style={{ color: '#d1d5db', lineHeight: '1.8', marginBottom: '8px' }}>
                                                <strong style={{ color: '#facc15' }}>One-time setup:</strong>
                                                <ol style={{ margin: '4px 0 0 0', paddingLeft: '18px' }}>
                                                    <li>Open Chrome and go to <strong>chrome://extensions</strong></li>
                                                    <li>Turn on <strong>Developer mode</strong> (toggle in the top-right corner)</li>
                                                    <li>Click <strong>Load unpacked</strong></li>
                                                    <li>Navigate to your Tutorial Clarity folder and select the <strong>extension</strong> subfolder</li>
                                                    <li>Click <strong>Select Folder</strong> — the extension is now installed</li>
                                                </ol>
                                            </div>
                                            <div style={{ color: '#d1d5db', lineHeight: '1.8' }}>
                                                <strong style={{ color: '#facc15' }}>To save a video from YouTube:</strong>
                                                <ul style={{ margin: '4px 0 0 0', paddingLeft: '18px' }}>
                                                    <li>Hover your mouse over any video thumbnail in the YouTube scroll list</li>
                                                    <li>Press the <strong>Alt key twice quickly</strong></li>
                                                    <li>A green banner confirms <em>"Saved to Tutorial Clarity!"</em></li>
                                                    <li>The video appears here in your list — Tutorial Clarity must be running</li>
                                                </ul>
                                            </div>
                                        </div>

                                        <div style={{ marginBottom: '12px' }}>
                                            <label style={{ display: 'block', marginBottom: '8px', color: '#9ca3af' }}>
                                                Or paste a YouTube URL manually:
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
                                                                    🗑 Delete
                                                                </button>
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

                                        {/* ─── STEP 1: DETECT SPEAKERS ─── */}
                                        <div style={{ margin: '10px 8px' }}>
                                            <button
                                                onClick={async () => {
                                                    if (!clarifyHandlersRef.current?.detectWithAssemblyAI) return;
                                                    setAssemblyAILoading(true);
                                                    try {
                                                        // Detection also fires onSpeakersDetected which sets detectedGenderMapRef
                                                        const speakers = await clarifyHandlersRef.current.detectWithAssemblyAI();
                                                        if (speakers && speakers.length >= 1) {
                                                            setDetectedSpeakers(speakers);

                                                            // Build config from auto-detected genders and apply immediately
                                                            const genderMap = detectedGenderMapRef.current;
                                                            const fullConfig: SpeakerConfig = {};
                                                            speakers.forEach(sid => {
                                                                if (genderMap[sid]) fullConfig[sid] = genderMap[sid];
                                                            });
                                                            setSpeakerConfig(fullConfig);
                                                            try { localStorage.setItem(`speaker-config-${videoId}`, JSON.stringify(fullConfig)); } catch {}
                                                            console.log('[auto-apply] Applying gender config:', fullConfig);

                                                            setIsRegenerating(true);
                                                            if (clarifyHandlersRef.current?.regenerateVoices) {
                                                                await clarifyHandlersRef.current.regenerateVoices(fullConfig);
                                                            }
                                                            setIsRegenerating(false);
                                                            setDetectionRun(true);
                                                        }
                                                    } catch (err: any) {
                                                        alert(`Speaker detection failed: ${err.message || 'Unknown error'}`);
                                                        setIsRegenerating(false);
                                                    } finally {
                                                        setAssemblyAILoading(false);
                                                    }
                                                }}
                                                disabled={assemblyAILoading}
                                                style={{
                                                    width: '100%', padding: '8px 12px',
                                                    backgroundColor: assemblyAILoading ? '#475569' : detectionRun ? '#1e3a5f' : '#2563eb',
                                                    color: detectionRun && !assemblyAILoading ? '#64748b' : 'white',
                                                    border: detectionRun && !assemblyAILoading ? '1px solid #334155' : 'none',
                                                    borderRadius: '6px',
                                                    fontSize: '12px', fontWeight: 'bold',
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
                                                        Detecting Speakers…
                                                    </span>
                                                ) : '🎯 Detect Speakers'}
                                            </button>
                                        </div>

                                        {/* ─── STEP 2: PLAY ─── */}
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
                                            detectionRun={detectionRun}
                                            readyToPlay={detectionRun && !assemblyAILoading && !isRegenerating}
                                            onUnknownSpeaker={handleUnknownSpeaker}
                                        />

                                    </div>
                                )}
                            </div>

                            {/* 8. ZOOM */}
                            <div style={{ borderBottom: '1px solid #374151' }}>
                                <h3
                                    onClick={() => toggleSection('zoom')}
                                    style={{
                                        margin: 0, color: 'white', backgroundColor: '#1f2937',
                                        fontWeight: 'bold', padding: '12px',
                                        cursor: 'pointer', display: 'flex',
                                        justifyContent: 'space-between', alignItems: 'center'
                                    }}
                                >
                                    <span>8. ZOOM 🔍</span>
                                    <span>{expandedSections.has('zoom') ? '▼' : '▶'}</span>
                                </h3>
                                {expandedSections.has('zoom') && (
                                    <div style={{ padding: '12px', backgroundColor: '#111827', fontSize: '13px', color: '#d1d5db', lineHeight: '1.8' }}>
                                        <p style={{ margin: '0 0 10px 0' }}>
                                            Use Zoom to enlarge any area of the video — great for small print, charts, or anything that goes by too fast to read.
                                        </p>
                                        <ol style={{ margin: '0 0 10px 0', paddingLeft: '18px' }}>
                                            <li>Pause your video.</li>
                                            <li>Click the <strong>🔍 Zoom</strong> button that appears at the bottom-right of the video.</li>
                                            <li>Left-click and hold your mouse at the <strong>top-left corner</strong> of the area you want to enlarge.</li>
                                            <li>Continue holding the left button and drag to the <strong>lower-right corner</strong> of the area, then release.</li>
                                            <li>If the image is too blurry at full size, use the <strong>Smaller / Larger slider</strong> that appears to shrink it — a smaller image is sharper.</li>
                                            <li>When you are finished reading, press the <strong>Spacebar</strong> to exit zoom and resume play.</li>
                                        </ol>
                                        <p style={{ margin: 0, color: '#9ca3af', fontSize: '12px' }}>
                                            <strong>Note:</strong> Image sharpness depends on the original video quality. High-definition videos will zoom more clearly than lower-resolution ones. The browser cannot sharpen beyond what the video itself contains.
                                        </p>
                                    </div>
                                )}
                            </div>

                            {/* 9. SHERLOCK SPYGLASS */}
                            <div style={{ borderBottom: '1px solid #374151' }}>
                                <h3
                                    onClick={() => toggleSection('spyglass')}
                                    style={{
                                        margin: 0, color: 'white', backgroundColor: '#1f2937',
                                        fontWeight: 'bold', padding: '12px',
                                        cursor: 'pointer', display: 'flex',
                                        justifyContent: 'space-between', alignItems: 'center'
                                    }}
                                >
                                    <span>9. SHERLOCK SPYGLASS 🕵️</span>
                                    <span>{expandedSections.has('spyglass') ? '▼' : '▶'}</span>
                                </h3>
                                {expandedSections.has('spyglass') && (
                                    <div style={{ padding: '12px', backgroundColor: '#111827', fontSize: '13px', color: '#d1d5db', lineHeight: '1.8' }}>
                                        <p style={{ margin: '0 0 10px 0' }}>
                                            Can't find the instructor's mouse cursor? It may be tiny — just one pixel on a high-resolution screen. The Spyglass is a draggable magnifying lens you move around the paused video until the cursor pops into view.
                                        </p>
                                        <ol style={{ margin: '0 0 10px 0', paddingLeft: '18px' }}>
                                            <li>Press <strong>Spacebar</strong> to pause the video at the moment you want to inspect.</li>
                                            <li>Click the purple <strong>🕵️ Spyglass</strong> button that appears at the bottom-right of the video.</li>
                                            <li>Move your mouse slowly over the video — a <strong>golden circular lens</strong> follows your cursor, magnifying everything underneath it.</li>
                                            <li>Everything outside the lens goes dark so you can focus on just the area inside.</li>
                                            <li>Use the <strong>size slider and zoom controls</strong> at the top of the screen to adjust the lens.</li>
                                            <li>When you've found what you were looking for, press <strong>Spacebar</strong> to exit and resume play.</li>
                                        </ol>
                                        <p style={{ margin: 0, color: '#9ca3af', fontSize: '12px' }}>
                                            <strong>Tip:</strong> Start at 2.5x zoom (the default) and drag across the video slowly. Increase to 4x or 5x only if the cursor is extremely small. The Spyglass works best on high-definition videos.
                                        </p>
                                    </div>
                                )}
                            </div>

                            {/* 10. RESUME PREVIOUS VIDEO */}
                            <div style={{ borderBottom: '1px solid #374151' }}>
                                <h3
                                    onClick={() => toggleSection('resume')}
                                    style={{
                                        margin: 0, color: 'white', backgroundColor: '#1f2937',
                                        fontWeight: 'bold', padding: '12px',
                                        cursor: 'pointer', display: 'flex',
                                        justifyContent: 'space-between', alignItems: 'center'
                                    }}
                                >
                                    <span>10. RESUME PREVIOUS VIDEO ▶</span>
                                    <span>{expandedSections.has('resume') ? '▼' : '▶'}</span>
                                </h3>
                                {expandedSections.has('resume') && (
                                    <div style={{ padding: '12px', backgroundColor: '#111827', fontSize: '13px', color: '#d1d5db' }}>
                                        {resumeSessions.length === 0 ? (
                                            <p style={{ textAlign: 'center', color: '#6b7280', padding: '16px 0', margin: 0 }}>
                                                No previous videos yet. Once you start watching, Tutorial Clarity will remember your place automatically.
                                            </p>
                                        ) : (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                {resumeSessions.map(session => (
                                                    <div key={session.videoId} style={{
                                                        backgroundColor: '#1f2937', borderRadius: '8px',
                                                        padding: '10px', border: '1px solid #374151',
                                                    }}>
                                                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                                            <img
                                                                src={`https://img.youtube.com/vi/${session.videoId}/default.jpg`}
                                                                alt={session.title}
                                                                style={{ width: '70px', height: '52px', objectFit: 'cover', borderRadius: '4px', flexShrink: 0, cursor: 'pointer' }}
                                                                onClick={() => handleResumeVideo(session)}
                                                            />
                                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                                <div style={{
                                                                    fontWeight: 'bold', fontSize: '11px', marginBottom: '4px',
                                                                    overflow: 'hidden', textOverflow: 'ellipsis',
                                                                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical'
                                                                }}>
                                                                    {session.title}
                                                                </div>
                                                                <div style={{ fontSize: '11px', color: '#facc15', marginBottom: '6px' }}>
                                                                    ⏱ {formatTimestamp(session.timestamp)}
                                                                    {session.duration > 0 && (
                                                                        <span style={{ color: '#9ca3af' }}> / {formatTimestamp(session.duration)}</span>
                                                                    )}
                                                                    <span style={{ color: '#6b7280', marginLeft: '8px' }}>{formatDate(session.lastWatched)}</span>
                                                                </div>
                                                                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                                                    <button
                                                                        onClick={() => handleResumeVideo(session)}
                                                                        style={{
                                                                            backgroundColor: '#22c55e', color: 'white',
                                                                            border: 'none', borderRadius: '4px',
                                                                            padding: '4px 10px', fontSize: '11px',
                                                                            fontWeight: 'bold', cursor: 'pointer',
                                                                        }}
                                                                    >
                                                                        ▶ Resume
                                                                    </button>
                                                                    <button
                                                                        onClick={() => handleToggleResumePin(session.videoId)}
                                                                        style={{
                                                                            backgroundColor: session.isPinned ? '#eab308' : 'transparent',
                                                                            color: session.isPinned ? 'white' : '#6b7280',
                                                                            border: '1px solid #374151', borderRadius: '4px',
                                                                            padding: '4px 10px', fontSize: '11px',
                                                                            cursor: 'pointer',
                                                                        }}
                                                                        title={session.isPinned ? 'Pinned — will not auto-remove when finished' : 'Pin to keep after finishing'}
                                                                    >
                                                                        📌 {session.isPinned ? 'Pinned' : 'Pin'}
                                                                    </button>
                                                                    <button
                                                                        onClick={() => handleClearResume(session.videoId)}
                                                                        style={{
                                                                            backgroundColor: 'transparent', color: '#6b7280',
                                                                            border: '1px solid #374151', borderRadius: '4px',
                                                                            padding: '4px 10px', fontSize: '11px',
                                                                            cursor: 'pointer',
                                                                        }}
                                                                    >
                                                                        Remove
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* 11. SUMMARY */}
                            <div>
                                <h3
                                    onClick={() => toggleSection('summary')}
                                    style={{
                                        fontSize: '16px', fontWeight: 'bold', padding: '12px',
                                        cursor: 'pointer', display: 'flex',
                                        justifyContent: 'space-between', alignItems: 'center',
                                    }}
                                >
                                    <span>11. SUMMARY</span>
                                    <span>{expandedSections.has('summary') ? '▼' : '▶'}</span>
                                </h3>
                                {expandedSections.has('summary') && (
                                    <div style={{ padding: '12px', backgroundColor: '#111827', fontSize: '12px' }}>
                                        <p style={{ color: '#d1d5db', lineHeight: '1.6', marginBottom: '12px' }}>
                                            Before you spend time watching, find out what this video actually covers.
                                            Click the button below and a plain-English summary will be generated for you.
                                        </p>
                                        <p style={{ color: '#f59e0b', lineHeight: '1.6', marginBottom: '12px', fontSize: '11px' }}>
                                            ⚠️ Summary is only available for YouTube videos that have captions. If a video has no captions, this feature will not work.
                                        </p>
                                        {!summaryFetched && !summaryLoading && (
                                            <button
                                                onClick={handleFetchSummary}
                                                style={{
                                                    width: '100%', padding: '10px', borderRadius: '6px',
                                                    border: 'none', cursor: 'pointer', fontWeight: 'bold',
                                                    fontSize: '13px', backgroundColor: '#7c3aed', color: 'white',
                                                }}
                                            >
                                                📋 What's this video about?
                                            </button>
                                        )}
                                        {summaryLoading && (
                                            <div style={{ textAlign: 'center', color: '#9ca3af', padding: '12px 0' }}>
                                                <div style={{ fontSize: '20px', marginBottom: '6px' }}>⏳</div>
                                                <div>Reading transcript and generating summary…</div>
                                                <div style={{ fontSize: '11px', marginTop: '4px', color: '#6b7280' }}>This takes about 10–15 seconds</div>
                                            </div>
                                        )}
                                        {summaryError && (
                                            <div style={{ color: '#f87171', marginBottom: '10px', lineHeight: '1.5' }}>
                                                ⚠️ {summaryError}
                                            </div>
                                        )}
                                        {summaryText && (
                                            <>
                                                <div style={{
                                                    backgroundColor: '#1e293b', border: '1px solid #4c1d95',
                                                    borderRadius: '8px', padding: '12px',
                                                    color: '#e2e8f0', lineHeight: '1.7', fontSize: '12px',
                                                    marginBottom: '10px',
                                                }}>
                                                    {summaryText}
                                                </div>
                                                <button
                                                    onClick={() => { setSummaryText(''); setSummaryFetched(false); setSummaryError(''); }}
                                                    style={{
                                                        width: '100%', padding: '7px', borderRadius: '6px',
                                                        border: '1px solid #374151', cursor: 'pointer',
                                                        fontSize: '11px', backgroundColor: 'transparent', color: '#9ca3af',
                                                    }}
                                                >
                                                    🔄 Generate new summary
                                                </button>
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* 12. TRANSCRIPT */}
                            <div style={{ borderBottom: '1px solid #374151' }}>
                                <h3
                                    onClick={() => toggleSection('transcriptdoc')}
                                    style={{
                                        fontSize: '16px', fontWeight: 'bold', padding: '12px',
                                        cursor: 'pointer', display: 'flex',
                                        justifyContent: 'space-between', alignItems: 'center',
                                    }}
                                >
                                    <span>12. TRANSCRIPT</span>
                                    <span>{expandedSections.has('transcriptdoc') ? '▼' : '▶'}</span>
                                </h3>
                                {expandedSections.has('transcriptdoc') && (
                                    <div style={{ padding: '12px', backgroundColor: '#111827', fontSize: '12px' }}>
                                        <p style={{ color: '#d1d5db', lineHeight: '1.6', marginBottom: '12px' }}>
                                            Generate a clean, readable transcript of this video — with proper punctuation and paragraph breaks — that you can download or print.
                                        </p>
                                        <p style={{ color: '#f59e0b', lineHeight: '1.6', marginBottom: '12px', fontSize: '11px' }}>
                                            ⚠️ Transcript is only available for YouTube videos that have captions. If a video has no captions, this feature will not work.
                                        </p>
                                        {!transcriptDocFetched && !transcriptDocLoading && (
                                            <button
                                                onClick={handleFetchTranscriptDoc}
                                                style={{
                                                    width: '100%', padding: '10px', borderRadius: '6px',
                                                    border: 'none', cursor: 'pointer', fontWeight: 'bold',
                                                    fontSize: '13px', backgroundColor: '#0369a1', color: 'white',
                                                }}
                                            >
                                                📄 Create Transcript
                                            </button>
                                        )}
                                        {transcriptDocLoading && (
                                            <div style={{ textAlign: 'center', color: '#9ca3af', padding: '12px 0' }}>
                                                <div style={{ fontSize: '20px', marginBottom: '6px' }}>⏳</div>
                                                <div>Formatting transcript…</div>
                                                <div style={{ fontSize: '11px', marginTop: '4px', color: '#6b7280' }}>This takes about 15–30 seconds</div>
                                            </div>
                                        )}
                                        {transcriptDocError && (
                                            <div style={{ color: '#f87171', marginBottom: '10px', lineHeight: '1.5' }}>
                                                ⚠️ {transcriptDocError}
                                            </div>
                                        )}
                                        {transcriptDoc && (
                                            <>
                                                <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                                                    <button
                                                        onClick={handleDownloadTranscript}
                                                        style={{
                                                            flex: 1, padding: '8px', borderRadius: '6px',
                                                            border: 'none', cursor: 'pointer', fontWeight: 'bold',
                                                            fontSize: '12px', backgroundColor: '#15803d', color: 'white',
                                                        }}
                                                    >
                                                        ⬇️ Download .txt
                                                    </button>
                                                    <button
                                                        onClick={handlePrintTranscript}
                                                        style={{
                                                            flex: 1, padding: '8px', borderRadius: '6px',
                                                            border: 'none', cursor: 'pointer', fontWeight: 'bold',
                                                            fontSize: '12px', backgroundColor: '#92400e', color: 'white',
                                                        }}
                                                    >
                                                        🖨️ Print
                                                    </button>
                                                </div>
                                                <div style={{
                                                    backgroundColor: '#1e293b', border: '1px solid #075985',
                                                    borderRadius: '8px', padding: '10px',
                                                    color: '#cbd5e1', lineHeight: '1.7', fontSize: '11px',
                                                    maxHeight: '200px', overflowY: 'auto',
                                                    marginBottom: '8px',
                                                }}>
                                                    {transcriptDoc.split('\n\n').map((para, i) => (
                                                        <p key={i} style={{ marginBottom: '10px' }}>{para}</p>
                                                    ))}
                                                </div>
                                                <button
                                                    onClick={() => { setTranscriptDoc(''); setTranscriptDocFetched(false); setTranscriptDocError(''); }}
                                                    style={{
                                                        width: '100%', padding: '7px', borderRadius: '6px',
                                                        border: '1px solid #374151', cursor: 'pointer',
                                                        fontSize: '11px', backgroundColor: 'transparent', color: '#9ca3af',
                                                    }}
                                                >
                                                    🔄 Generate new transcript
                                                </button>
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* 13. KEYBOARD SHORTCUTS */}
                            <div style={{ borderBottom: '1px solid #374151' }}>
                                <h3
                                    onClick={() => toggleSection('shortcuts')}
                                    style={{
                                        fontSize: '16px', fontWeight: 'bold', padding: '12px',
                                        cursor: 'pointer', display: 'flex',
                                        justifyContent: 'space-between', alignItems: 'center',
                                    }}
                                >
                                    <span>13. KEYBOARD SHORTCUTS</span>
                                    <span>{expandedSections.has('shortcuts') ? '▼' : '▶'}</span>
                                </h3>
                                {expandedSections.has('shortcuts') && (
                                    <div style={{ padding: '12px', backgroundColor: '#111827', fontSize: '12px' }}>
                                        <p style={{ color: '#d1d5db', marginBottom: '10px', lineHeight: '1.6' }}>
                                            These shortcuts work in the Tutorial Clarity watch page. When using the browser extension on YouTube, the same keys open TC to that section — and <strong>S</strong> also saves the current video automatically.
                                        </p>
                                        {[
                                            { key: 'Space', label: 'Pause / Play' },
                                            { key: 'M', label: 'Toggle Mute' },
                                            { key: ',  /  .', label: 'Speed Down / Up' },
                                            { key: 'Alt  Alt', label: 'Save Video (extension — from YouTube)' },
                                            { key: 'S', label: 'Save & Open Saved Videos' },
                                            { key: 'A', label: 'Clarify Audio' },
                                            { key: 'V', label: 'Speaker Voices' },
                                            { key: 'T', label: 'Scroll Transcript' },
                                            { key: 'Z', label: 'Zoom' },
                                            { key: 'Space (in Spyglass)', label: '🕵️ Exit Spyglass & Resume' },
                                            { key: 'R', label: 'Resume Previous Video' },
                                            { key: 'U', label: 'Summary' },
                                            { key: 'X', label: 'Transcript' },
                                            { key: 'K', label: 'Keyboard Shortcuts' },
                                            { key: '?', label: 'Tutorial' },
                                        ].map(({ key, label }) => (
                                            <div key={key} style={{
                                                display: 'flex', justifyContent: 'space-between',
                                                alignItems: 'center', padding: '5px 0',
                                                borderBottom: '1px solid #1f2937',
                                            }}>
                                                <span style={{ color: '#d1d5db' }}>{label}</span>
                                                <span style={{
                                                    backgroundColor: '#374151', color: '#facc15',
                                                    borderRadius: '4px', padding: '2px 8px',
                                                    fontFamily: 'monospace', fontSize: '12px',
                                                    fontWeight: 'bold', whiteSpace: 'nowrap',
                                                }}>{key}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* 14. TUTORIAL */}
                            <div style={{ borderBottom: '1px solid #374151' }}>
                                <h3
                                    onClick={() => toggleSection('tutorial')}
                                    style={{
                                        fontSize: '16px', fontWeight: 'bold', padding: '12px',
                                        cursor: 'pointer', display: 'flex',
                                        justifyContent: 'space-between', alignItems: 'center',
                                    }}
                                >
                                    <span>14. TUTORIAL</span>
                                    <span>{expandedSections.has('tutorial') ? '▼' : '▶'}</span>
                                </h3>
                                {expandedSections.has('tutorial') && (
                                    <div style={{ padding: '12px', backgroundColor: '#111827', fontSize: '12px' }}>
                                        {TUTORIAL_VIDEO_ID ? (
                                            <>
                                                <p style={{ color: '#d1d5db', lineHeight: '1.6', marginBottom: '10px' }}>
                                                    Watch this short video to learn how to use all of Tutorial Clarity's features.
                                                </p>
                                                <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0, overflow: 'hidden', borderRadius: '8px' }}>
                                                    <iframe
                                                        src={`https://www.youtube.com/embed/${TUTORIAL_VIDEO_ID}?rel=0`}
                                                        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none', borderRadius: '8px' }}
                                                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                                        allowFullScreen
                                                    />
                                                </div>
                                            </>
                                        ) : (
                                            <p style={{ color: '#9ca3af', lineHeight: '1.6' }}>
                                                Coming soon — a step-by-step video guide to using all of Tutorial Clarity's features.
                                            </p>
                                        )}
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