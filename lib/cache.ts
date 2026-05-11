import fs from 'fs';
import path from 'path';

const CACHE_DIR = path.join(process.cwd(), '.cache');
const TTS_CACHE_DIR = path.join(CACHE_DIR, 'tts');
const PROCESSING_STATUS_DIR = path.join(CACHE_DIR, 'status');

// Ensure cache directories exist
[CACHE_DIR, TTS_CACHE_DIR, PROCESSING_STATUS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

interface TranscriptSegment {
  text: string;
  start: number;
  duration: number;
}

interface ProcessingStatus {
  videoId: string;
  status: string;
  currentStep?: string;
  progress?: number;
  processedSegments?: number;
  totalSegments?: number;
  error?: string;
  updatedAt: string;
}

interface CachedTranscript {
  videoId: string;
  transcript: TranscriptSegment[];
  targetLanguage: string;
  createdAt: string;
  isStreaming?: boolean;
  lastProcessedTime?: number;
  bufferReadyAt?: number;
}

export function getCachedTranscript(videoId: string): CachedTranscript | null {
  try {
    const cachePath = path.join(CACHE_DIR, `${videoId}.json`);
    if (fs.existsSync(cachePath)) {
      const data = fs.readFileSync(cachePath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('[cache] Error reading cache:', error);
  }
  return null;
}

export function setCachedTranscript(videoId: string, data: CachedTranscript): void {
  try {
    const cachePath = path.join(CACHE_DIR, `${videoId}.json`);
    fs.writeFileSync(cachePath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('[cache] Error writing cache:', error);
  }
}

export function appendCachedSegments(videoId: string, newSegments: TranscriptSegment[], lastProcessedTime: number): void {
  try {
    const cached = getCachedTranscript(videoId);
    if (cached) {
      cached.transcript.push(...newSegments);
      cached.lastProcessedTime = lastProcessedTime;
      setCachedTranscript(videoId, cached);
    }
  } catch (error) {
    console.error('[cache] Error appending segments:', error);
  }
}

export function getNewSegments(videoId: string, afterCount: number): TranscriptSegment[] {
  try {
    const cached = getCachedTranscript(videoId);
    if (cached && cached.transcript.length > afterCount) {
      return cached.transcript.slice(afterCount);
    }
  } catch (error) {
    console.error('[cache] Error getting new segments:', error);
  }
  return [];
}

export function markStreamingComplete(videoId: string): void {
  try {
    const cached = getCachedTranscript(videoId);
    if (cached) {
      cached.isStreaming = false;
      setCachedTranscript(videoId, cached);
    }
  } catch (error) {
    console.error('[cache] Error marking streaming complete:', error);
  }
}

export function clearCache(videoId?: string): void {
  try {
    if (videoId) {
      const cachePath = path.join(CACHE_DIR, `${videoId}.json`);
      if (fs.existsSync(cachePath)) {
        fs.unlinkSync(cachePath);
      }
      // Also clear TTS cache for this video
      clearTTSCache(videoId);
    } else {
      // Clear all cache
      const files = fs.readdirSync(CACHE_DIR);
      files.forEach(file => {
        const filePath = path.join(CACHE_DIR, file);
        if (fs.statSync(filePath).isFile()) {
          fs.unlinkSync(filePath);
        }
      });
      // Clear TTS cache
      clearTTSCache();
    }
  } catch (error) {
    console.error('[cache] Error clearing cache:', error);
  }
}

/**
 * Get path for TTS audio segment cache
 */
export function getTTSSegmentPath(videoId: string, segmentIndex: number): string {
  const videoTTSDir = path.join(TTS_CACHE_DIR, videoId);
  if (!fs.existsSync(videoTTSDir)) {
    fs.mkdirSync(videoTTSDir, { recursive: true });
  }
  return path.join(videoTTSDir, `segment_${segmentIndex}.mp3`);
}

/**
 * Check if TTS segment is cached
 */
export function hasTTSSegmentCached(videoId: string, segmentIndex: number): boolean {
  const cachePath = getTTSSegmentPath(videoId, segmentIndex);
  return fs.existsSync(cachePath);
}

/**
 * Clear TTS cache for a video or all videos
 */
export function clearTTSCache(videoId?: string): void {
  try {
    if (videoId) {
      const videoTTSDir = path.join(TTS_CACHE_DIR, videoId);
      if (fs.existsSync(videoTTSDir)) {
        fs.rmSync(videoTTSDir, { recursive: true });
      }
    } else {
      if (fs.existsSync(TTS_CACHE_DIR)) {
        const dirs = fs.readdirSync(TTS_CACHE_DIR);
        dirs.forEach(dir => {
          fs.rmSync(path.join(TTS_CACHE_DIR, dir), { recursive: true });
        });
      }
    }
  } catch (error) {
    console.error('[cache] Error clearing TTS cache:', error);
  }
}

/**
 * Update processing status for a video
 */
export function updateProcessingStatus(videoId: string, status: Partial<ProcessingStatus>): void {
  try {
    const statusPath = path.join(PROCESSING_STATUS_DIR, `${videoId}.json`);
    let currentStatus: ProcessingStatus = {
      videoId,
      status: 'unknown',
      updatedAt: new Date().toISOString()
    };
    
    // Read existing status if available
    if (fs.existsSync(statusPath)) {
      const data = fs.readFileSync(statusPath, 'utf-8');
      currentStatus = JSON.parse(data);
    }
    
    // Merge with new status
    const updatedStatus: ProcessingStatus = {
      ...currentStatus,
      ...status,
      videoId,
      updatedAt: new Date().toISOString()
    };
    
    fs.writeFileSync(statusPath, JSON.stringify(updatedStatus, null, 2));
  } catch (error) {
    console.error('[cache] Error updating processing status:', error);
  }
}

/**
 * Get processing status for a video
 */
export function getProcessingStatus(videoId: string): ProcessingStatus | null {
  try {
    const statusPath = path.join(PROCESSING_STATUS_DIR, `${videoId}.json`);
    if (fs.existsSync(statusPath)) {
      const data = fs.readFileSync(statusPath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('[cache] Error reading processing status:', error);
  }
  return null;
}

/**
 * Clear processing status
 */
export function clearProcessingStatus(videoId: string): void {
  try {
    const statusPath = path.join(PROCESSING_STATUS_DIR, `${videoId}.json`);
    if (fs.existsSync(statusPath)) {
      fs.unlinkSync(statusPath);
    }
  } catch (error) {
    console.error('[cache] Error clearing processing status:', error);
  }
}

