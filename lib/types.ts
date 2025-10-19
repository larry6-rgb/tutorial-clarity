
// Types for Tutorial Clarity App
export interface Bookmark {
  id: string;
  timestamp: number; // Changed from 'time' to 'timestamp' to match usage
  title: string;
  notes: string;
  createdAt: Date;
}

export interface TutorialSession {
  id: string;
  videoId: string;
  videoUrl: string; // Added missing videoUrl property
  videoTitle?: string;
  currentTime: number;
  playbackRate: number;
  bookmarks: Bookmark[];
  notes?: string;
  createdAt: Date;
  lastViewed: Date;
}

export interface YouTubePlayerState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
}

export interface ControlPanelPosition {
  x: number;
  y: number;
}

export interface AppSettings {
  defaultPlaybackRate: number;
  autoSaveSessions: boolean;
  showCursorHighlight: boolean;
  controlPanelPosition: ControlPanelPosition;
}

// YouTube API types
declare global {
  interface Window {
    YT: {
      Player: new (elementId: string | HTMLElement, options: any) => YTPlayer;
      PlayerState: {
        UNSTARTED: -1;
        ENDED: 0;
        PLAYING: 1;
        PAUSED: 2;
        BUFFERING: 3;
        CUED: 5;
      };
    };
    onYouTubeIframeAPIReady: () => void;
  }
}

export interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  seekTo(seconds: number, allowSeekAhead?: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlaybackRate(): number;
  setPlaybackRate(suggestedRate: number): void;
  getPlayerState(): number;
  destroy(): void;
  getVideoData(): {
    title: string;
    video_id: string;
  };
}
