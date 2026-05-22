// Manages progressive loading and playback of clarified audio segments

export interface AudioSegment {
  index: number;
  startTime: number;
  endTime: number;
  audioUrl?: string;
  text: string;
  isLoaded: boolean;
  isPlaying: boolean;
}

export interface AudioBufferState {
  segments: AudioSegment[];
  currentSegmentIndex: number;
  bufferedUntil: number;
  isBuffering: boolean;
  bufferHealth: number;
}

export interface AudioBufferCallbacks {
  onSegmentComplete?: (index: number) => void;
  onBufferUpdate?: (state: AudioBufferState) => void;
  onError?: (error: Error) => void;
}

export class AudioBufferManager {
  private segments: AudioSegment[] = [];
  private currentSegmentIndex: number = -1;
  private audioElements: Map<number, HTMLAudioElement> = new Map();
  private callbacks: AudioBufferCallbacks = {};
  private isPlaying: boolean = false;
  private volume: number = 1.0;
  private isMuted: boolean = false;
  private speechSynthesis: SpeechSynthesis | null = null;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  
  constructor(callbacks: AudioBufferCallbacks = {}) {
    this.callbacks = callbacks;
    
    // Initialize speech synthesis if available
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.speechSynthesis = window.speechSynthesis;
    }
  }
  
  // Get available TTS voices
  getAvailableVoices(): SpeechSynthesisVoice[] {
    if (!this.speechSynthesis) return [];
    return this.speechSynthesis.getVoices();
  }
  
  // Add segments to buffer
  addSegments(segments: AudioSegment[]): void {
    this.segments.push(...segments);
    this.preBufferSegments();
    this.notifyBufferUpdate();
  }
  
  // Pre-buffer upcoming segments
  private async preBufferSegments(): Promise<void> {
    const bufferAhead = 3; // Buffer 3 segments ahead
    const startIndex = Math.max(0, this.currentSegmentIndex);
    const endIndex = Math.min(this.segments.length, startIndex + bufferAhead);
    
    for (let i = startIndex; i < endIndex; i++) {
      if (!this.segments[i].isLoaded) {
        await this.loadSegment(i);
      }
    }
  }
  
  // Load a specific segment
  private async loadSegment(index: number): Promise<void> {
    const segment = this.segments[index];
    if (!segment || segment.isLoaded) return;
    
    try {
      if (segment.audioUrl) {
        // Load from URL
        const audio = new Audio(segment.audioUrl);
        audio.volume = this.isMuted ? 0 : this.volume;
        
        await new Promise((resolve, reject) => {
          audio.addEventListener('canplaythrough', resolve, { once: true });
          audio.addEventListener('error', reject, { once: true });
          audio.load();
        });
        
        this.audioElements.set(index, audio);
      } else {
        // Use browser TTS as fallback
        // TTS will be generated on-demand during playback
      }
      
      segment.isLoaded = true;
      this.notifyBufferUpdate();
    } catch (error) {
      this.callbacks.onError?.(error as Error);
    }
  }
  
  // Play segment using browser TTS
  private playSegmentWithTTS(segment: AudioSegment, voice?: SpeechSynthesisVoice): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.speechSynthesis) {
        reject(new Error('Speech synthesis not available'));
        return;
      }
      
      const utterance = new SpeechSynthesisUtterance(segment.text);
      
      if (voice) {
        utterance.voice = voice;
      }
      
      utterance.volume = this.isMuted ? 0 : this.volume;
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      
      utterance.onend = () => {
        this.currentUtterance = null;
        resolve();
      };
      
      utterance.onerror = (event) => {
        this.currentUtterance = null;
        reject(new Error(`TTS error: ${event.error}`));
      };
      
      this.currentUtterance = utterance;
      this.speechSynthesis.speak(utterance);
    });
  }
  
  // Play from specific time
  async playFromTime(time: number, voice?: SpeechSynthesisVoice): Promise<void> {
    // Find segment at given time
    const segmentIndex = this.segments.findIndex(
      s => s.startTime <= time && s.endTime > time
    );
    
    if (segmentIndex === -1) return;
    
    this.currentSegmentIndex = segmentIndex;
    this.isPlaying = true;
    
    // Play segments sequentially
    for (let i = segmentIndex; i < this.segments.length && this.isPlaying; i++) {
      const segment = this.segments[i];
      segment.isPlaying = true;
      
      try {
        const audio = this.audioElements.get(i);
        
        if (audio) {
          // Play from audio element
          await new Promise<void>((resolve, reject) => {
            audio.onended = () => resolve();
            audio.onerror = () => reject(new Error('Audio playback error'));
            audio.play().catch(reject);
          });
        } else {
          // Use TTS
          await this.playSegmentWithTTS(segment, voice);
        }
        
        segment.isPlaying = false;
        this.callbacks.onSegmentComplete?.(i);
        this.currentSegmentIndex = i + 1;
        
        // Pre-buffer ahead
        await this.preBufferSegments();
      } catch (error) {
        segment.isPlaying = false;
        this.callbacks.onError?.(error as Error);
        break;
      }
    }
    
    this.isPlaying = false;
  }
  
  // Pause playback
  pause(): void {
    this.isPlaying = false;
    
    // Pause current audio element
    const currentAudio = this.audioElements.get(this.currentSegmentIndex);
    if (currentAudio) {
      currentAudio.pause();
    }
    
    // Cancel TTS
    if (this.speechSynthesis && this.currentUtterance) {
      this.speechSynthesis.cancel();
      this.currentUtterance = null;
    }
    
    // Update segment state
    if (this.currentSegmentIndex >= 0 && this.currentSegmentIndex < this.segments.length) {
      this.segments[this.currentSegmentIndex].isPlaying = false;
    }
  }
  
  // Stop playback
  stop(): void {
    this.pause();
    this.currentSegmentIndex = -1;
  }
  
  // Set volume (0-1)
  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    
    // Update all audio elements
    this.audioElements.forEach(audio => {
      audio.volume = this.isMuted ? 0 : this.volume;
    });
    
    // Update current utterance
    if (this.currentUtterance) {
      this.currentUtterance.volume = this.isMuted ? 0 : this.volume;
    }
  }
  
  // Mute/unmute
  setMuted(muted: boolean): void {
    this.isMuted = muted;
    this.setVolume(this.volume); // Trigger volume update
  }
  
  // Get current buffer state
  getBufferState(): AudioBufferState {
    const bufferedUntil = this.segments.length > 0
      ? this.segments[this.segments.length - 1].endTime
      : 0;
    
    return {
      segments: this.segments,
      currentSegmentIndex: this.currentSegmentIndex,
      bufferedUntil,
      isBuffering: this.segments.some(s => !s.isLoaded),
      bufferHealth: this.calculateBufferHealth()
    };
  }
  
  // Calculate buffer health (0-1)
  private calculateBufferHealth(): number {
    if (this.segments.length === 0) return 0;
    
    const loadedSegments = this.segments.filter(s => s.isLoaded).length;
    return loadedSegments / this.segments.length;
  }
  
  // Notify buffer update
  private notifyBufferUpdate(): void {
    this.callbacks.onBufferUpdate?.(this.getBufferState());
  }
  
  // Clean up
  dispose(): void {
    this.stop();
    this.audioElements.forEach(audio => {
      audio.pause();
      audio.src = '';
    });
    this.audioElements.clear();
    this.segments = [];
  }
}