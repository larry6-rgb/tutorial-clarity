// George's Logic: Core audio synchronization engine
// Handles word matching, timeline alignment, and lookahead synchronization

export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptSegment {
  text: string;
  start: number;
  end: number;
  words?: TranscriptWord[];
}

export interface SyncPoint {
  videoTime: number;
  audioTime: number;
  confidence: number;
  matchedWords: string[];
}

export interface BufferStatus {
  bufferedUntil: number; // Time in seconds
  isBuffering: boolean;
  bufferHealth: number; // 0-1, how much buffer we have ahead
}

export interface SyncState {
  currentOffset: number; // Time offset between video and clarified audio
  syncPoints: SyncPoint[];
  lastSyncTime: number;
  driftRate: number; // How fast sync is drifting
}

// Utility: Normalize word for comparison
function normalizeWord(word: string): string {
  return word
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .trim();
}

// Utility: Calculate word similarity (Levenshtein distance)
function wordSimilarity(word1: string, word2: string): number {
  const w1 = normalizeWord(word1);
  const w2 = normalizeWord(word2);
  
  if (w1 === w2) return 1.0;
  if (w1.length === 0 || w2.length === 0) return 0;
  
  const matrix: number[][] = [];
  
  for (let i = 0; i <= w2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= w1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= w2.length; i++) {
    for (let j = 1; j <= w1.length; j++) {
      if (w2.charAt(i - 1) === w1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  const maxLen = Math.max(w1.length, w2.length);
  const distance = matrix[w2.length][w1.length];
  return 1 - distance / maxLen;
}

// Find matching words in clarified audio buffer
function findMatchingWords(
  videoWords: TranscriptWord[],
  clarifiedWords: TranscriptWord[],
  startIndex: number = 0,
  lookAheadCount: number = 5
): SyncPoint | null {
  const searchWords = videoWords.slice(startIndex, startIndex + lookAheadCount);
  
  if (searchWords.length === 0) return null;
  
  let bestMatch: SyncPoint | null = null;
  let bestScore = 0;
  
  // Search through clarified audio for matching sequence
  for (let i = 0; i < clarifiedWords.length - searchWords.length + 1; i++) {
    let totalScore = 0;
    const matchedWords: string[] = [];
    
    for (let j = 0; j < searchWords.length; j++) {
      const similarity = wordSimilarity(
        searchWords[j].word,
        clarifiedWords[i + j].word
      );
      totalScore += similarity;
      
      if (similarity > 0.7) {
        matchedWords.push(searchWords[j].word);
      }
    }
    
    const avgScore = totalScore / searchWords.length;
    
    if (avgScore > bestScore && avgScore > 0.6) {
      bestScore = avgScore;
      bestMatch = {
        videoTime: searchWords[0].start,
        audioTime: clarifiedWords[i].start,
        confidence: avgScore,
        matchedWords
      };
    }
  }
  
  return bestMatch;
}

// Calculate time offset between video and clarified audio
function calculateTimeOffset(syncPoints: SyncPoint[]): number {
  if (syncPoints.length === 0) return 0;
  
  // Weight recent sync points more heavily
  let weightedSum = 0;
  let weightTotal = 0;
  
  syncPoints.slice(-10).forEach((point, index) => {
    const weight = point.confidence * (index + 1); // More recent = higher weight
    const offset = point.videoTime - point.audioTime;
    weightedSum += offset * weight;
    weightTotal += weight;
  });
  
  return weightTotal > 0 ? weightedSum / weightTotal : 0;
}

export class ClarifyAudioEngine {
  private originalTranscript: TranscriptSegment[] = [];
  private clarifiedTranscript: TranscriptSegment[] = [];
  private originalWords: TranscriptWord[] = [];
  private clarifiedWords: TranscriptWord[] = [];
  private syncState: SyncState = {
    currentOffset: 0,
    syncPoints: [],
    lastSyncTime: 0,
    driftRate: 0
  };
  private bufferStatus: BufferStatus = {
    bufferedUntil: 0,
    isBuffering: true,
    bufferHealth: 0
  };
  
  // Load original video transcript
  setOriginalTranscript(segments: TranscriptSegment[]): void {
    this.originalTranscript = segments;
    this.originalWords = this.extractWords(segments);
  }
  
  // Add clarified audio segments as they become available
  addClarifiedSegments(segments: TranscriptSegment[]): void {
    this.clarifiedTranscript.push(...segments);
    this.clarifiedWords = this.extractWords(this.clarifiedTranscript);
    
    // Update buffer status
    if (this.clarifiedTranscript.length > 0) {
      const lastSegment = this.clarifiedTranscript[this.clarifiedTranscript.length - 1];
      this.bufferStatus.bufferedUntil = lastSegment.end;
      this.bufferStatus.isBuffering = false;
    }
  }
  
  // Extract words from segments
  private extractWords(segments: TranscriptSegment[]): TranscriptWord[] {
    const words: TranscriptWord[] = [];
    
    segments.forEach(segment => {
      if (segment.words && segment.words.length > 0) {
        words.push(...segment.words);
      } else {
        // Fallback: split text into words with estimated timing
        const segmentWords = segment.text.split(/\s+/);
        const duration = segment.end - segment.start;
        const wordDuration = duration / segmentWords.length;
        
        segmentWords.forEach((word, index) => {
          words.push({
            word,
            start: segment.start + index * wordDuration,
            end: segment.start + (index + 1) * wordDuration
          });
        });
      }
    });
    
    return words;
  }
  
  // Update current playback position and perform synchronization
  updatePlaybackPosition(videoTime: number): SyncState {
    // Find current position in original transcript
    const currentWordIndex = this.originalWords.findIndex(
      w => w.start <= videoTime && w.end >= videoTime
    );
    
    if (currentWordIndex === -1) return this.syncState;
    
    // Look ahead and find matching sequence
    const syncPoint = findMatchingWords(
      this.originalWords,
      this.clarifiedWords,
      currentWordIndex,
      5 // Look ahead 5 words
    );
    
    if (syncPoint) {
      this.syncState.syncPoints.push(syncPoint);
      this.syncState.lastSyncTime = videoTime;
      
      // Keep only recent sync points
      if (this.syncState.syncPoints.length > 20) {
        this.syncState.syncPoints = this.syncState.syncPoints.slice(-20);
      }
      
      // Recalculate offset
      const newOffset = calculateTimeOffset(this.syncState.syncPoints);
      const offsetChange = Math.abs(newOffset - this.syncState.currentOffset);
      
      // Calculate drift rate
      const timeSinceLastSync = videoTime - this.syncState.lastSyncTime;
      if (timeSinceLastSync > 0) {
        this.syncState.driftRate = offsetChange / timeSinceLastSync;
      }
      
      this.syncState.currentOffset = newOffset;
    }
    
    // Update buffer health
    const bufferAhead = this.bufferStatus.bufferedUntil - videoTime;
    this.bufferStatus.bufferHealth = Math.min(1, Math.max(0, bufferAhead / 10)); // 10 seconds = full health
    
    return this.syncState;
  }
  
  // Get current buffer status
  getBufferStatus(): BufferStatus {
    return { ...this.bufferStatus };
  }
  
  // Get synchronized audio time for given video time
  getSyncedAudioTime(videoTime: number): number {
    return videoTime - this.syncState.currentOffset;
  }
  
  // Get current subtitle for given video time
  getCurrentSubtitle(videoTime: number): string | null {
    const audioTime = this.getSyncedAudioTime(videoTime);
    
    const segment = this.clarifiedTranscript.find(
      s => s.start <= audioTime && s.end >= audioTime
    );
    
    return segment ? segment.text : null;
  }
}