'use client';

import { useState, useCallback, useEffect, useRef } from 'react';

export interface Notification {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning' | 'processing_complete';
  title: string;
  message: string;
  duration?: number; // 0 for persistent
  action?: {
    label: string;
    onClick: () => void;
  };
  createdAt: number;
}

interface UseNotificationsReturn {
  notifications: Notification[];
  addNotification: (notification: Omit<Notification, 'id' | 'createdAt'>) => string;
  removeNotification: (id: string) => void;
  clearAll: () => void;
  
  // Convenience methods
  showSuccess: (title: string, message: string, duration?: number) => string;
  showError: (title: string, message: string, duration?: number) => string;
  showInfo: (title: string, message: string, duration?: number) => string;
  showWarning: (title: string, message: string, duration?: number) => string;
  showProcessingComplete: (videoId: string, onWatch: () => void) => string;
}

// Store for background processing notifications
const BACKGROUND_PROCESSING_KEY = 'tutorial_clarity_background_processing';

interface BackgroundJob {
  videoId: string;
  startedAt: string;
  option: number;
}

export function useNotifications(): UseNotificationsReturn {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const timersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      timersRef.current.forEach(timer => clearTimeout(timer));
    };
  }, []);

  // Generate unique ID
  const generateId = useCallback(() => {
    return `notif_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }, []);

  // Add a notification
  const addNotification = useCallback((
    notification: Omit<Notification, 'id' | 'createdAt'>
  ): string => {
    const id = generateId();
    const newNotification: Notification = {
      ...notification,
      id,
      createdAt: Date.now(),
    };

    setNotifications(prev => [...prev, newNotification]);

    // Auto-remove after duration (if specified and not 0)
    const duration = notification.duration ?? 5000;
    if (duration > 0) {
      const timer = setTimeout(() => {
        removeNotification(id);
      }, duration);
      timersRef.current.set(id, timer);
    }

    // Play notification sound for processing complete
    if (notification.type === 'processing_complete') {
      try {
        // Try to play a notification sound
        const audio = new Audio('/notification.mp3');
        audio.volume = 0.5;
        audio.play().catch(() => {
          // Fallback: use system notification if available
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(notification.title, {
              body: notification.message,
              icon: '/icon.png',
            });
          }
        });
      } catch {}
    }

    return id;
  }, [generateId]);

  // Remove a notification
  const removeNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
    
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  // Clear all notifications
  const clearAll = useCallback(() => {
    setNotifications([]);
    timersRef.current.forEach(timer => clearTimeout(timer));
    timersRef.current.clear();
  }, []);

  // Convenience: Show success notification
  const showSuccess = useCallback((
    title: string, 
    message: string, 
    duration: number = 4000
  ): string => {
    return addNotification({
      type: 'success',
      title,
      message,
      duration,
    });
  }, [addNotification]);

  // Convenience: Show error notification
  const showError = useCallback((
    title: string, 
    message: string, 
    duration: number = 6000
  ): string => {
    return addNotification({
      type: 'error',
      title,
      message,
      duration,
    });
  }, [addNotification]);

  // Convenience: Show info notification
  const showInfo = useCallback((
    title: string, 
    message: string, 
    duration: number = 4000
  ): string => {
    return addNotification({
      type: 'info',
      title,
      message,
      duration,
    });
  }, [addNotification]);

  // Convenience: Show warning notification
  const showWarning = useCallback((
    title: string, 
    message: string, 
    duration: number = 5000
  ): string => {
    return addNotification({
      type: 'warning',
      title,
      message,
      duration,
    });
  }, [addNotification]);

  // Convenience: Show processing complete notification
  const showProcessingComplete = useCallback((
    videoId: string,
    onWatch: () => void
  ): string => {
    return addNotification({
      type: 'processing_complete',
      title: '🎉 Video Processing Complete!',
      message: 'Your clarified video is ready. Click to start watching with enhanced audio and subtitles.',
      duration: 0, // Persistent until dismissed
      action: {
        label: '▶️ Start Watching',
        onClick: onWatch,
      },
    });
  }, [addNotification]);

  return {
    notifications,
    addNotification,
    removeNotification,
    clearAll,
    showSuccess,
    showError,
    showInfo,
    showWarning,
    showProcessingComplete,
  };
}

/**
 * Store background processing job info (persists across page reloads)
 */
export function saveBackgroundJob(job: BackgroundJob): void {
  if (typeof window === 'undefined') return;
  
  try {
    const existing = getBackgroundJobs();
    const updated = existing.filter(j => j.videoId !== job.videoId);
    updated.push(job);
    localStorage.setItem(BACKGROUND_PROCESSING_KEY, JSON.stringify(updated));
  } catch {}
}

/**
 * Get all background processing jobs
 */
export function getBackgroundJobs(): BackgroundJob[] {
  if (typeof window === 'undefined') return [];
  
  try {
    const data = localStorage.getItem(BACKGROUND_PROCESSING_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

/**
 * Remove a background job
 */
export function removeBackgroundJob(videoId: string): void {
  if (typeof window === 'undefined') return;
  
  try {
    const existing = getBackgroundJobs();
    const updated = existing.filter(j => j.videoId !== videoId);
    localStorage.setItem(BACKGROUND_PROCESSING_KEY, JSON.stringify(updated));
  } catch {}
}

/**
 * Request notification permission (call on user interaction)
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) {
    return false;
  }
  
  if (Notification.permission === 'granted') {
    return true;
  }
  
  if (Notification.permission !== 'denied') {
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  }
  
  return false;
}
