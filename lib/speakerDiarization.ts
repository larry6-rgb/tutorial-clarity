/**
 * Speaker Diarization Module
 * 
 * Detects speakers and their genders from audio files.
 * Uses Python script with librosa for audio analysis.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

const execAsync = promisify(exec);

export interface Speaker {
  id: string;
  gender: 'male' | 'female' | 'neutral' | 'unknown';
  pitch?: number;
  total_speaking_time: number;
}

export interface SpeakerSegment {
  speaker_id: string;
  start: number;
  end: number;
  gender: 'male' | 'female' | 'neutral' | 'unknown';
}

export interface DiarizationResult {
  success: boolean;
  speakers: Speaker[];
  segments: SpeakerSegment[];
  error?: string;
}

/**
 * Run speaker diarization on an audio file
 */
export async function performDiarization(
  audioPath: string,
  numSpeakers?: number
): Promise<DiarizationResult> {
  const pythonScript = path.join(process.cwd(), 'python_services', 'speaker_diarization.py');
  
  // Check if script exists
  if (!fs.existsSync(pythonScript)) {
    return {
      success: false,
      speakers: [],
      segments: [],
      error: 'Speaker diarization script not found'
    };
  }
  
  // Check if audio file exists
  if (!fs.existsSync(audioPath)) {
    return {
      success: false,
      speakers: [],
      segments: [],
      error: `Audio file not found: ${audioPath}`
    };
  }
  
  try {
    const args = numSpeakers ? `"${audioPath}" ${numSpeakers}` : `"${audioPath}"`;
    const { stdout, stderr } = await execAsync(
      `python3 "${pythonScript}" ${args}`,
      { timeout: 300000 } // 5 minute timeout
    );
    
    if (stderr) {
      console.log('[speakerDiarization] stderr:', stderr);
    }
    
    const result = JSON.parse(stdout.trim());
    return result as DiarizationResult;
    
  } catch (error) {
    console.error('[speakerDiarization] Error:', error);
    return {
      success: false,
      speakers: [],
      segments: [],
      error: error instanceof Error ? error.message : 'Diarization failed'
    };
  }
}

/**
 * Cache for diarization results
 */
const diarizationCache = new Map<string, DiarizationResult>();

/**
 * Get cached or perform diarization
 */
export async function getDiarization(
  videoId: string,
  audioPath: string
): Promise<DiarizationResult> {
  // Check cache
  if (diarizationCache.has(videoId)) {
    console.log('[speakerDiarization] Using cached result for', videoId);
    return diarizationCache.get(videoId)!;
  }
  
  // Perform diarization
  const result = await performDiarization(audioPath);
  
  // Cache successful results
  if (result.success) {
    diarizationCache.set(videoId, result);
  }
  
  return result;
}

/**
 * Get speaker info for a specific time
 */
export function getSpeakerAtTime(
  segments: SpeakerSegment[],
  time: number
): SpeakerSegment | null {
  for (const segment of segments) {
    if (time >= segment.start && time < segment.end) {
      return segment;
    }
  }
  return null;
}

/**
 * Clear diarization cache for a video
 */
export function clearDiarizationCache(videoId: string): void {
  diarizationCache.delete(videoId);
}
