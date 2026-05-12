
// Local storage utilities for Tutorial Clarity
import { TutorialSession, Bookmark, AppSettings } from './types';

const STORAGE_KEYS = {
  SESSIONS: 'tutorial_clarity_sessions',
  CURRENT_SESSION: 'tutorial_clarity_current_session',
  SETTINGS: 'tutorial_clarity_settings',
  BOOKMARKS: 'tutorial_clarity_bookmarks'
};

export const storage = {
  // Sessions
  getSessions(): TutorialSession[] {
    if (typeof window === 'undefined') return [];
    
    try {
      const sessions = localStorage.getItem(STORAGE_KEYS.SESSIONS);
      return sessions ? JSON.parse(sessions) : [];
    } catch (error) {
      console.error('Error getting sessions:', error);
      return [];
    }
  },

  saveSession(session: TutorialSession): void {
    if (typeof window === 'undefined') return;
    
    try {
      const sessions = this.getSessions();
      const existingIndex = sessions.findIndex(s => s.id === session.id);
      
      if (existingIndex >= 0) {
        sessions[existingIndex] = { ...session, lastViewed: new Date() };
      } else {
        sessions.push({ ...session, lastViewed: new Date() });
      }
      
      localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(sessions));
    } catch (error) {
      console.error('Error saving session:', error);
    }
  },

  getCurrentSession(): TutorialSession | null {
    if (typeof window === 'undefined') return null;
    
    try {
      const session = localStorage.getItem(STORAGE_KEYS.CURRENT_SESSION);
      return session ? JSON.parse(session) : null;
    } catch (error) {
      console.error('Error getting current session:', error);
      return null;
    }
  },

  setCurrentSession(session: TutorialSession | null): void {
    if (typeof window === 'undefined') return;
    
    try {
      if (session) {
        localStorage.setItem(STORAGE_KEYS.CURRENT_SESSION, JSON.stringify(session));
      } else {
        localStorage.removeItem(STORAGE_KEYS.CURRENT_SESSION);
      }
    } catch (error) {
      console.error('Error setting current session:', error);
    }
  },

  // Settings
  getSettings(): AppSettings {
    if (typeof window === 'undefined') {
      return {
        defaultPlaybackRate: 1,
        autoSaveSessions: true,
        showCursorHighlight: true,
        controlPanelPosition: { x: 20, y: 20 }
      };
    }
    
    try {
      const settings = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      const defaultSettings: AppSettings = {
        defaultPlaybackRate: 1,
        autoSaveSessions: true,
        showCursorHighlight: true,
        controlPanelPosition: { x: 20, y: 20 }
      };
      
      return settings ? { ...defaultSettings, ...JSON.parse(settings) } : defaultSettings;
    } catch (error) {
      console.error('Error getting settings:', error);
      return {
        defaultPlaybackRate: 1,
        autoSaveSessions: true,
        showCursorHighlight: true,
        controlPanelPosition: { x: 20, y: 20 }
      };
    }
  },

  saveSettings(settings: Partial<AppSettings>): void {
    if (typeof window === 'undefined') return;
    
    try {
      const currentSettings = this.getSettings();
      const updatedSettings = { ...currentSettings, ...settings };
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(updatedSettings));
    } catch (error) {
      console.error('Error saving settings:', error);
    }
  },

  // Bookmarks
  getBookmarks(videoId: string): Bookmark[] {
    if (typeof window === 'undefined') return [];
    
    try {
      const bookmarks = localStorage.getItem(`${STORAGE_KEYS.BOOKMARKS}_${videoId}`);
      return bookmarks ? JSON.parse(bookmarks) : [];
    } catch (error) {
      console.error('Error getting bookmarks:', error);
      return [];
    }
  },

  saveBookmark(videoId: string, bookmark: Bookmark): void {
    if (typeof window === 'undefined') return;
    
    try {
      const bookmarks = this.getBookmarks(videoId);
      const existingIndex = bookmarks.findIndex(b => b.id === bookmark.id);
      
      if (existingIndex >= 0) {
        bookmarks[existingIndex] = bookmark;
      } else {
        bookmarks.push(bookmark);
      }
      
      bookmarks.sort((a, b) => a.timestamp - b.timestamp);
      localStorage.setItem(`${STORAGE_KEYS.BOOKMARKS}_${videoId}`, JSON.stringify(bookmarks));
    } catch (error) {
      console.error('Error saving bookmark:', error);
    }
  },

  deleteBookmark(videoId: string, bookmarkId: string): void {
    if (typeof window === 'undefined') return;
    
    try {
      const bookmarks = this.getBookmarks(videoId);
      const filteredBookmarks = bookmarks.filter(b => b.id !== bookmarkId);
      localStorage.setItem(`${STORAGE_KEYS.BOOKMARKS}_${videoId}`, JSON.stringify(filteredBookmarks));
    } catch (error) {
      console.error('Error deleting bookmark:', error);
    }
  }
};
