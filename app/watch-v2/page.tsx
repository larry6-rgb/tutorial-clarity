'use client';

/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  WATCH V2 — PROOF OF CONCEPT: Separated Video/Audio Playback   ║
 * ╚══════════════════════════════════════════════════════════════════╝
 * 
 * THE PROBLEM (V1):
 *   YouTube's iframe bundles video + audio + controls together.
 *   We can't reliably mute/unmute the iframe audio, which causes
 *   conflicts when playing our AI clarified audio alongside.
 * 
 * THE SOLUTION (V2):
 *   Separate video and audio into independent streams:
 *     - <video> element: video-only stream (no audio track)
 *     - <audio id="yt-audio">: YouTube's original audio (toggleable)
 *     - <audio id="ai-audio">: AI clarified audio (from ClarifyAudioPanel)
 * 
 * ARCHITECTURE:
 *   ┌─────────────────────────────────────────────────────────┐
 *   │  Browser (this page)                                    │
 *   │                                                         │
 *   │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
 *   │  │  <video>      │  │ <audio>      │  │ <audio>      │ │
 *   │  │  Video-only   │  │ YT Audio     │  │ AI Audio     │ │
 *   │  │  (no audio)   │  │ (toggleable) │  │ (clarified)  │ │
 *   │  └──────┬───────┘  └──────┬───────┘  └──────────────┘ │
 *   │         │                  │                            │
 *   │         │    Synced via    │                            │
 *   │         │◀── timeupdate ──▶│                            │
 *   │         │     events       │                            │
 *   └─────────┼──────────────────┼────────────────────────────┘
 *             │                  │
 *             ▼                  ▼
 *   /api/video-stream    /api/video-stream
 *   ?proxy=video         ?proxy=audio
 *             │                  │
 *             ▼                  ▼
 *         yt-dlp             yt-dlp
 *        (local)            (local)
 *             │                  │
 *             ▼                  ▼
 *        YouTube CDN        YouTube CDN
 * 
 * AUDIO MODES:
 *   A) YouTube Audio ON  → YT audio plays, synced with video
 *   B) AI Clarified      → AI audio plays, YT audio OFF, video keeps playing
 *   C) Silent            → No audio, just video
 * 
 * This is a PROOF OF CONCEPT page. It does NOT replace /watch.
 * Navigate to: /watch-v2?url=https://youtube.com/watch?v=VIDEO_ID
 */

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState, useCallback } from 'react';
import { ClarifyAudioPanel } from '../components/ClarifyAudioPanel';

// ── Types ───────────────────────────────────────────────────────────

interface StreamInfo {
  url: string;
  format_id: string;
  ext: string;
  quality_label?: string;
  width?: number;
  height?: number;
  fps?: number;
  codec: string;
  bitrate?: number;
  filesize?: number;
  proxyUrl?: string;
}

interface VideoStreamResponse {
  success: boolean;
  videoId: string;
  bestVideo: StreamInfo | null;
  bestAudio: StreamInfo | null;
  proxyUrls: {
    video: string;
    audio: string;
  };
  videoOptions: StreamInfo[];
  audioOptions: StreamInfo[];
  totalFormats: number;
  error?: string;
  installInstructions?: Record<string, string>;
  hint?: string;
}

interface TranscriptSegment {
  start: number;
  duration: number;
  text: string;
}

// ── Audio Mode ──────────────────────────────────────────────────────

type AudioMode = 'youtube' | 'ai' | 'silent';

// ── Main Component ──────────────────────────────────────────────────

function WatchV2Content() {
  const searchParams = useSearchParams();
  const rawUrl = searchParams.get('url');

  /**
   * Extract YouTube video ID — handles multiple URL formats.
   * 
   * YouTube IDs are typically 11 chars, but we accept 8-16 to be safe.
   * 
   * BROWSER QUERY STRING PROBLEM:
   *   When user navigates to:
   *     /watch-v2?url=https://www.youtube.com/watch?v=ABC123_xYz
   *   The browser parses TWO query params:
   *     url = "https://www.youtube.com/watch"  (truncated!)
   *     v   = "ABC123_xYz"                      (split off!)
   * 
   *   So we check BOTH searchParams.get('url') AND searchParams.get('v').
   */
  const extractId = (url: string | null): string | null => {
    if (!url) return null;
    // Standard YouTube URL patterns (capture the ID part after v= or youtu.be/)
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]+)/);
    if (match) return match[1];
    // Bare ID (alphanumeric, dash, underscore, reasonable length)
    const idMatch = url.match(/^([a-zA-Z0-9_-]{8,16})$/);
    if (idMatch) return idMatch[1];
    return null;
  };

  // Try multiple sources for the video ID:
  // 1. Extract from the ?url= parameter (works when URL is properly encoded)
  // 2. Fall back to ?v= parameter (works when browser splits unencoded YouTube URL)
  // 3. Fall back to ?videoId= parameter (direct ID)
  const videoId = extractId(rawUrl) 
    || searchParams.get('v')?.match(/^([a-zA-Z0-9_-]+)/)?.[1]
    || searchParams.get('videoId') 
    || null;

  // DEBUG: Log what we're getting from search params
  // This helps Larry see exactly what the page receives
  if (typeof window !== 'undefined') {
    console.log('[watch-v2 DEBUG] Full URL:', window.location.href);
    console.log('[watch-v2 DEBUG] searchParams.get("url"):', searchParams.get('url'));
    console.log('[watch-v2 DEBUG] searchParams.get("v"):', searchParams.get('v'));
    console.log('[watch-v2 DEBUG] searchParams.get("videoId"):', searchParams.get('videoId'));
    console.log('[watch-v2 DEBUG] extractId(rawUrl):', extractId(rawUrl));
    console.log('[watch-v2 DEBUG] → Final videoId:', videoId);
  }

  // ── Refs ──
  const videoRef = useRef<HTMLVideoElement>(null);
  const ytAudioRef = useRef<HTMLAudioElement>(null);

  // ── State ──
  const [streamData, setStreamData] = useState<VideoStreamResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(100);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  // Audio mode: which audio source is active
  const [audioMode, setAudioMode] = useState<AudioMode>('youtube');

  // Transcript
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [transcriptLoading, setTranscriptLoading] = useState(false);

  // Stream URLs (may be direct or proxy)
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [useProxy, setUseProxy] = useState(false);

  // Sync lock — prevents infinite sync loops
  const syncingRef = useRef(false);

  // ── Fetch stream URLs from our API ────────────────────────────────

  const fetchStreams = useCallback(async () => {
    if (!videoId) return;

    setLoading(true);
    setError(null);

    try {
      console.log('[watch-v2] Fetching stream info for:', videoId);
      const res = await fetch(`/api/video-stream?videoId=${videoId}`);
      const data: VideoStreamResponse = await res.json();

      if (!res.ok || data.error) {
        setError(data.error || 'Failed to fetch stream info');
        if (data.installInstructions) {
          console.log('[watch-v2] Install instructions:', data.installInstructions);
        }
        setLoading(false);
        return;
      }

      console.log('[watch-v2] Stream data:', {
        bestVideo: data.bestVideo?.quality_label,
        bestAudio: data.bestAudio?.codec,
        videoOptions: data.videoOptions?.length,
        audioOptions: data.audioOptions?.length,
      });

      setStreamData(data);

      // Try direct URLs first, fall back to proxy
      if (data.bestVideo?.url) {
        setVideoUrl(data.bestVideo.url);
        console.log('[watch-v2] Using direct video URL');
      } else {
        setVideoUrl(data.proxyUrls.video);
        setUseProxy(true);
        console.log('[watch-v2] Using proxy video URL');
      }

      if (data.bestAudio?.url) {
        setAudioUrl(data.bestAudio.url);
        console.log('[watch-v2] Using direct audio URL');
      } else {
        setAudioUrl(data.proxyUrls.audio);
        setUseProxy(true);
        console.log('[watch-v2] Using proxy audio URL');
      }
    } catch (err: any) {
      console.error('[watch-v2] Fetch error:', err);
      setError(`Network error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [videoId]);

  // ── Fetch transcript ──────────────────────────────────────────────

  const fetchTranscript = useCallback(async () => {
    if (!videoId) return;
    setTranscriptLoading(true);
    try {
      const res = await fetch(`/api/transcript?videoId=${videoId}`);
      const data = await res.json();
      if (data.transcript && Array.isArray(data.transcript)) {
        setTranscript(data.transcript);
        console.log('[watch-v2] Transcript loaded:', data.transcript.length, 'segments');
      }
    } catch (err: any) {
      console.error('[watch-v2] Transcript error:', err);
    } finally {
      setTranscriptLoading(false);
    }
  }, [videoId]);

  // ── Load streams and transcript on mount ──────────────────────────

  useEffect(() => {
    fetchStreams();
    fetchTranscript();
  }, [fetchStreams, fetchTranscript]);

  // ── Video event: track time ───────────────────────────────────────

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      if (!syncingRef.current) {
        setCurrentTime(video.currentTime);
      }
    };

    const handleDurationChange = () => {
      setDuration(video.duration || 0);
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('durationchange', handleDurationChange);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('durationchange', handleDurationChange);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
    };
  }, [videoUrl]);

  // ── Sync YouTube audio with video ─────────────────────────────────

  useEffect(() => {
    /**
     * SYNC LOGIC:
     * The <video> element is the master clock.
     * The <audio> element for YouTube audio follows the video's time.
     * We sync every timeupdate event, but only if drift > 0.3s.
     */
    const video = videoRef.current;
    const audio = ytAudioRef.current;
    if (!video || !audio) return;

    const syncAudio = () => {
      if (syncingRef.current) return;
      
      // Only sync if YouTube audio is active
      if (audioMode !== 'youtube') {
        if (!audio.paused) audio.pause();
        return;
      }

      // Match play/pause state
      if (video.paused && !audio.paused) {
        audio.pause();
      } else if (!video.paused && audio.paused) {
        audio.play().catch(() => {});
      }

      // Match speed
      if (audio.playbackRate !== video.playbackRate) {
        audio.playbackRate = video.playbackRate;
      }

      // Sync time if drift is too large (> 0.3 seconds)
      const drift = Math.abs(video.currentTime - audio.currentTime);
      if (drift > 0.3) {
        syncingRef.current = true;
        audio.currentTime = video.currentTime;
        setTimeout(() => { syncingRef.current = false; }, 100);
      }
    };

    video.addEventListener('timeupdate', syncAudio);
    video.addEventListener('seeked', syncAudio);
    video.addEventListener('play', syncAudio);
    video.addEventListener('pause', syncAudio);
    video.addEventListener('ratechange', syncAudio);

    return () => {
      video.removeEventListener('timeupdate', syncAudio);
      video.removeEventListener('seeked', syncAudio);
      video.removeEventListener('play', syncAudio);
      video.removeEventListener('pause', syncAudio);
      video.removeEventListener('ratechange', syncAudio);
    };
  }, [audioMode, audioUrl]);

  // ── Audio mode changes ────────────────────────────────────────────

  useEffect(() => {
    const audio = ytAudioRef.current;
    if (!audio) return;

    console.log('[watch-v2] audioMode useEffect:', audioMode, 'volume:', volume);

    if (audioMode === 'youtube') {
      audio.volume = volume / 100;
      // NOTE: audio.play() is called from direct click handlers (not here)
      // because browser autoplay policy requires a user gesture.
    } else {
      // AI mode or silent — pause YouTube audio
      audio.pause();
      console.log('[watch-v2] Audio paused via useEffect, mode:', audioMode);
    }
  }, [audioMode, volume]);

  // ── Playback controls ─────────────────────────────────────────────

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    const audio = ytAudioRef.current;
    if (video.paused) {
      video.play();
      // Start audio in same user gesture (autoplay policy)
      if (audioMode === 'youtube' && audio) {
        audio.currentTime = video.currentTime;
        audio.volume = volume / 100;
        audio.play()
          .then(() => console.log('[watch-v2] Audio started with video'))
          .catch((e: unknown) => console.error('[watch-v2] Audio play-with-video failed:', e));
      }
    } else {
      video.pause();
      if (audio) audio.pause();
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.currentTime = time;
    }
    if (ytAudioRef.current && audioMode === 'youtube') {
      ytAudioRef.current.currentTime = time;
    }
    setCurrentTime(time);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseInt(e.target.value);
    setVolume(vol);
    if (ytAudioRef.current) {
      ytAudioRef.current.volume = vol / 100;
    }
  };

  const handleSpeedChange = (speed: number) => {
    setPlaybackSpeed(speed);
    if (videoRef.current) videoRef.current.playbackRate = speed;
    if (ytAudioRef.current) ytAudioRef.current.playbackRate = speed;
  };

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // ── Handle video error (CORS) → fall back to proxy ────────────────

  const handleVideoError = () => {
    if (!useProxy && streamData?.proxyUrls) {
      console.log('[watch-v2] Direct URL failed, switching to proxy');
      setVideoUrl(streamData.proxyUrls.video);
      setAudioUrl(streamData.proxyUrls.audio);
      setUseProxy(true);
    }
  };

  // ── Find current transcript segment ───────────────────────────────

  const currentSegmentIndex = transcript.findIndex(
    (seg, i) => {
      const nextStart = transcript[i + 1]?.start ?? Infinity;
      return currentTime >= seg.start && currentTime < nextStart;
    }
  );

  // ── Render ────────────────────────────────────────────────────────

  if (!videoId) {
    return (
      <div style={{ 
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', background: '#000', color: '#fff',
        fontFamily: 'system-ui, sans-serif',
      }}>
        <div style={{ textAlign: 'center', maxWidth: 700, padding: 40 }}>
          <h1 style={{ fontSize: 32, marginBottom: 16 }}>🎬 Watch V2 — POC</h1>
          <p style={{ color: '#aaa', fontSize: 18, marginBottom: 24 }}>
            Separated video/audio architecture
          </p>
          <p style={{ color: '#888', marginBottom: 16 }}>
            Usage: <code style={{ color: '#4ade80' }}>/watch-v2?videoId=YOUTUBE_ID</code>
          </p>
          <p style={{ color: '#888', marginBottom: 8 }}>
            Or: <code style={{ color: '#4ade80' }}>/watch-v2?v=YOUTUBE_ID</code>
          </p>
          <p style={{ color: '#888', marginBottom: 24 }}>
            Or: <code style={{ color: '#4ade80' }}>/watch-v2?url=https://youtube.com/watch?v=ID</code>
          </p>

          {/* Debug info — shows what the page actually received */}
          <div style={{
            marginTop: 24, padding: 16, background: '#111', borderRadius: 8,
            textAlign: 'left', fontSize: 13, color: '#888',
          }}>
            <p style={{ color: '#f59e0b', fontWeight: 'bold', marginBottom: 8 }}>🔧 Debug (what this page received):</p>
            <p>searchParams.get(&quot;url&quot;): <code style={{ color: '#60a5fa' }}>{rawUrl ?? '(null)'}</code></p>
            <p>searchParams.get(&quot;v&quot;): <code style={{ color: '#60a5fa' }}>{searchParams.get('v') ?? '(null)'}</code></p>
            <p>searchParams.get(&quot;videoId&quot;): <code style={{ color: '#60a5fa' }}>{searchParams.get('videoId') ?? '(null)'}</code></p>
            <p>extractId(url): <code style={{ color: '#60a5fa' }}>{extractId(rawUrl) ?? '(null)'}</code></p>
            <p style={{ marginTop: 8, color: '#f87171' }}>→ Final videoId: <code>{videoId ?? '(null)'}</code></p>
            <p style={{ marginTop: 12, color: '#666', fontSize: 11 }}>
              All params: {typeof window !== 'undefined' ? window.location.search : '(SSR)'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#000',
      color: '#fff',
      fontFamily: 'system-ui, sans-serif',
    }}>
      {/* ── Header ── */}
      <div style={{
        padding: '12px 20px',
        background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
        borderBottom: '1px solid #333',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div>
          <span style={{ fontSize: 20, fontWeight: 'bold' }}>
            🎬 Watch V2 — <span style={{ color: '#f59e0b' }}>POC</span>
          </span>
          <span style={{ color: '#888', marginLeft: 16, fontSize: 14 }}>
            Separated video/audio architecture
          </span>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {/* Audio mode indicator */}
          <span style={{
            padding: '4px 12px',
            borderRadius: 20,
            fontSize: 13,
            fontWeight: 'bold',
            background: audioMode === 'youtube' ? '#3b82f6' 
                      : audioMode === 'ai' ? '#8b5cf6' 
                      : '#6b7280',
            color: '#fff',
          }}>
            {audioMode === 'youtube' ? '🔊 YouTube Audio' 
             : audioMode === 'ai' ? '🤖 AI Audio' 
             : '🔇 Silent'}
          </span>
          <span style={{ color: '#666', fontSize: 12 }}>
            {streamData ? `${streamData.bestVideo?.quality_label || '?'} · ${streamData.totalFormats} formats` : ''}
          </span>
        </div>
      </div>

      {/* ── Loading / Error states ── */}
      {loading && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 60, color: '#aaa',
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 16, animation: 'spin 1s linear infinite' }}>⚙️</div>
            <p style={{ fontSize: 18 }}>Extracting video streams...</p>
            <p style={{ fontSize: 14, color: '#666', marginTop: 8 }}>
              yt-dlp is fetching format info from YouTube
            </p>
          </div>
        </div>
      )}

      {error && (
        <div style={{
          margin: 20, padding: 20, borderRadius: 12,
          background: '#1a0000', border: '1px solid #f87171',
        }}>
          <h3 style={{ color: '#f87171', marginBottom: 8 }}>❌ Error</h3>
          <p style={{ color: '#fca5a5' }}>{error}</p>
          {streamData?.installInstructions && (
            <div style={{ marginTop: 16, padding: 16, background: '#111', borderRadius: 8 }}>
              <p style={{ color: '#f59e0b', fontWeight: 'bold', marginBottom: 8 }}>
                📦 Install yt-dlp:
              </p>
              {Object.entries(streamData.installInstructions).map(([os, cmd]) => (
                <p key={os} style={{ color: '#aaa', fontSize: 14, marginBottom: 4 }}>
                  <strong>{os}:</strong>{' '}
                  <code style={{ color: '#4ade80' }}>{cmd}</code>
                </p>
              ))}
            </div>
          )}
          {streamData?.hint && (
            <pre style={{ 
              color: '#fbbf24', marginTop: 12, fontSize: 14,
              whiteSpace: 'pre-wrap', fontFamily: 'system-ui, sans-serif',
            }}>
              💡 {streamData.hint}
            </pre>
          )}
        </div>
      )}

      {/* ── Video Player ── */}
      {videoUrl && (
        <div style={{ position: 'relative' }}>
          {/* The actual HTML5 video element — VIDEO ONLY, no audio track */}
          <video
            ref={videoRef}
            src={videoUrl}
            style={{
              width: '100%',
              maxHeight: 'calc(100vh - 240px)',
              background: '#000',
              display: 'block',
            }}
            onError={handleVideoError}
            playsInline
            // No 'muted' attribute needed — this stream has NO audio track
          />

          {/* Hidden audio element for YouTube's original audio */}
          {audioUrl && (
            <audio
              ref={ytAudioRef}
              src={audioUrl}
              preload="auto"
              // Starts paused — sync logic will handle play/pause
            />
          )}
        </div>
      )}

      {/* ── Controls Bar ── */}
      {videoUrl && (
        <div style={{
          padding: '12px 20px',
          background: '#111',
          borderTop: '1px solid #333',
        }}>
          {/* Progress bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <span style={{ fontSize: 13, color: '#aaa', minWidth: 50 }}>
              {formatTime(currentTime)}
            </span>
            <input
              type="range"
              min={0}
              max={duration || 100}
              value={currentTime}
              onChange={handleSeek}
              step={0.1}
              style={{
                flex: 1, height: 6, cursor: 'pointer',
                accentColor: '#3b82f6',
              }}
            />
            <span style={{ fontSize: 13, color: '#aaa', minWidth: 50, textAlign: 'right' }}>
              {formatTime(duration)}
            </span>
          </div>

          {/* Control buttons */}
          <div style={{ 
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            flexWrap: 'wrap', gap: 12,
          }}>
            {/* Left: Play/pause + volume */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button
                onClick={togglePlay}
                style={{
                  background: '#3b82f6', border: 'none', borderRadius: 8,
                  padding: '8px 20px', color: '#fff', fontSize: 16,
                  cursor: 'pointer', fontWeight: 'bold',
                }}
              >
                {isPlaying ? '⏸ Pause' : '▶ Play'}
              </button>

              {/* Volume */}
              <span style={{ fontSize: 14 }}>🔊</span>
              <input
                type="range"
                min={0} max={100}
                value={volume}
                onChange={handleVolumeChange}
                style={{ width: 80, accentColor: '#3b82f6' }}
              />
              <span style={{ fontSize: 12, color: '#888' }}>{volume}%</span>
            </div>

            {/* Center: Audio mode toggle */}
            <div style={{ 
              display: 'flex', gap: 4, background: '#222', borderRadius: 8, padding: 4,
            }}>
              {(['youtube', 'ai', 'silent'] as AudioMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => {
                    console.log('[watch-v2] Audio mode button clicked:', mode);
                    setAudioMode(mode);
                    const audio = ytAudioRef.current;
                    if (mode === 'youtube' && audio) {
                      audio.volume = volume / 100;
                      if (videoRef.current) {
                        audio.currentTime = videoRef.current.currentTime;
                      }
                      audio.play()
                        .then(() => console.log('[watch-v2] Audio now playing!'))
                        .catch((e: unknown) => console.error('[watch-v2] Audio play failed:', e));
                    } else if (audio) {
                      audio.pause();
                      console.log('[watch-v2] Audio paused, mode:', mode);
                    }
                  }}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 6,
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: audioMode === mode ? 'bold' : 'normal',
                    background: audioMode === mode 
                      ? (mode === 'youtube' ? '#3b82f6' : mode === 'ai' ? '#8b5cf6' : '#6b7280')
                      : 'transparent',
                    color: audioMode === mode ? '#fff' : '#888',
                    transition: 'all 0.2s',
                  }}
                >
                  {mode === 'youtube' ? '🔊 YouTube' : mode === 'ai' ? '🤖 AI' : '🔇 Silent'}
                </button>
              ))}
              <span style={{ fontSize: 11, color: '#6b7280', fontStyle: 'italic', marginLeft: 4 }}>
                {audioMode === 'youtube' ? '♪ on' : audioMode === 'ai' ? 'AI' : 'off'}
              </span>
            </div>

            {/* Right: Speed */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, color: '#888' }}>Speed:</span>
              {[0.5, 0.75, 1, 1.25, 1.5, 2].map((speed) => (
                <button
                  key={speed}
                  onClick={() => handleSpeedChange(speed)}
                  style={{
                    padding: '4px 8px', borderRadius: 4, border: 'none',
                    background: playbackSpeed === speed ? '#f59e0b' : '#333',
                    color: playbackSpeed === speed ? '#000' : '#aaa',
                    cursor: 'pointer', fontSize: 12, fontWeight: 'bold',
                  }}
                >
                  {speed}x
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Transcript + AI Panel (side by side on wide screens) ── */}
      {videoUrl && (
        <div style={{
          display: 'flex', gap: 0, borderTop: '1px solid #333',
        }}>
          {/* ── Left: Transcript ── */}
          <div style={{
            flex: 1, maxHeight: 300, overflowY: 'auto',
            padding: '12px 16px', background: '#0a0a0a',
            borderRight: '1px solid #222',
          }}>
            <h4 style={{ color: '#888', marginBottom: 8, fontSize: 13 }}>
              📝 TRANSCRIPT {transcriptLoading ? '(loading...)' : `(${transcript.length} segments)`}
            </h4>
            {transcript.map((seg, i) => (
              <p
                key={i}
                onClick={() => {
                  if (videoRef.current) videoRef.current.currentTime = seg.start;
                  if (ytAudioRef.current && audioMode === 'youtube') {
                    ytAudioRef.current.currentTime = seg.start;
                  }
                  setCurrentTime(seg.start);
                }}
                style={{
                  padding: '4px 8px',
                  margin: '2px 0',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontSize: 14,
                  lineHeight: 1.5,
                  background: i === currentSegmentIndex ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                  color: i === currentSegmentIndex ? '#60a5fa' : '#ccc',
                  borderLeft: i === currentSegmentIndex ? '3px solid #3b82f6' : '3px solid transparent',
                  transition: 'all 0.15s',
                }}
              >
                <span style={{ color: '#666', fontSize: 11, marginRight: 8 }}>
                  {formatTime(seg.start)}
                </span>
                {seg.text}
              </p>
            ))}
          </div>

          {/* ── Right: Clarify Audio Panel ── */}
          <div style={{
            width: 400, maxHeight: 300, overflowY: 'auto',
            padding: '12px 16px', background: '#0d0d1a',
          }}>
            <h4 style={{ color: '#888', marginBottom: 8, fontSize: 13 }}>
              🤖 AI CLARIFIED AUDIO
            </h4>
            {videoId && (
              <ClarifyAudioPanel
                videoId={videoId}
                currentTime={currentTime}
                onSubtitleChange={(subtitle) => {
                  if (subtitle) console.log('[watch-v2] AI subtitle:', subtitle);
                }}
                onMuteYouTube={(mute) => {
                  /**
                   * V2 ARCHITECTURE: Instead of trying to mute an iframe,
                   * we simply toggle the audio mode!
                   * When AI wants to mute YouTube → switch to 'ai' mode
                   * When AI wants to unmute → switch back to 'youtube' mode
                   */
                  if (mute) {
                    setAudioMode('ai');
                    console.log('[watch-v2] AI requested mute → switched to AI audio mode');
                  } else {
                    setAudioMode('youtube');
                    console.log('[watch-v2] AI requested unmute → switched to YouTube audio mode');
                  }
                }}
                onPlayYouTube={() => {
                  /**
                   * V2: Start video playback when AI panel says "play"
                   * In V1 this sent a postMessage to the iframe.
                   * In V2 we just call video.play() directly!
                   */
                  if (videoRef.current) {
                    videoRef.current.play().catch(() => {});
                    console.log('[watch-v2] AI requested play → video.play()');
                  }
                }}
              />
            )}
          </div>
        </div>
      )}

      {/* ── Debug Panel (collapsible) ── */}
      <details style={{ margin: 16, color: '#666', fontSize: 12 }}>
        <summary style={{ cursor: 'pointer', marginBottom: 8 }}>
          🔧 Debug Info
        </summary>
        <pre style={{ 
          background: '#111', padding: 12, borderRadius: 8, 
          overflow: 'auto', maxHeight: 200,
        }}>
{JSON.stringify({
  videoId,
  audioMode,
  isPlaying,
  currentTime: currentTime.toFixed(2),
  duration: duration.toFixed(2),
  playbackSpeed,
  volume,
  videoUrl: videoUrl ? '✅ loaded' : '❌ none',
  audioUrl: audioUrl ? '✅ loaded' : '❌ none',
  useProxy,
  transcriptSegments: transcript.length,
  currentSegment: currentSegmentIndex,
  streamData: streamData ? {
    bestVideo: streamData.bestVideo?.quality_label,
    bestAudio: streamData.bestAudio?.codec,
    totalFormats: streamData.totalFormats,
  } : null,
}, null, 2)}
        </pre>
      </details>

      {/* ── CSS animation for loading spinner ── */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

// ── Export with Suspense boundary ───────────────────────────────────

export default function WatchV2Page() {
  return (
    <Suspense fallback={
      <div style={{ 
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', background: '#000', color: '#888',
      }}>
        Loading Watch V2...
      </div>
    }>
      <WatchV2Content />
    </Suspense>
  );
}
