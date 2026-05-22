'use client';

import React, { useEffect, useState } from 'react';
import { Notification } from './useNotifications';

interface NotificationContainerProps {
  notifications: Notification[];
  onDismiss: (id: string) => void;
}

const NOTIFICATION_ICONS: Record<Notification['type'], string> = {
  success: '✅',
  error: '❌',
  info: 'ℹ️',
  warning: '⚠️',
  processing_complete: '🎉',
};

const NOTIFICATION_COLORS: Record<Notification['type'], { bg: string; border: string; text: string }> = {
  success: { bg: 'bg-green-900/90', border: 'border-green-500', text: 'text-green-100' },
  error: { bg: 'bg-red-900/90', border: 'border-red-500', text: 'text-red-100' },
  info: { bg: 'bg-blue-900/90', border: 'border-blue-500', text: 'text-blue-100' },
  warning: { bg: 'bg-yellow-900/90', border: 'border-yellow-500', text: 'text-yellow-100' },
  processing_complete: { bg: 'bg-purple-900/90', border: 'border-purple-500', text: 'text-purple-100' },
};

function NotificationItem({ notification, onDismiss }: { notification: Notification; onDismiss: (id: string) => void }) {
  const [isExiting, setIsExiting] = useState(false);
  const colors = NOTIFICATION_COLORS[notification.type];
  const icon = NOTIFICATION_ICONS[notification.type];

  const handleDismiss = () => {
    setIsExiting(true);
    setTimeout(() => onDismiss(notification.id), 300);
  };

  return (
    <div
      className={`
        ${colors.bg} ${colors.border} ${colors.text}
        border-l-4 rounded-lg shadow-lg p-3 mb-2
        flex items-start gap-2 max-w-sm
        transition-all duration-300 ease-in-out
        ${isExiting ? 'opacity-0 translate-x-full' : 'opacity-100 translate-x-0'}
        animate-slide-in
      `}
      role="alert"
    >
      <span className="text-lg flex-shrink-0 mt-0.5">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm">{notification.title}</p>
        <p className="text-xs opacity-80 mt-0.5">{notification.message}</p>
        {notification.action && (
          <button
            onClick={notification.action.onClick}
            className="mt-1.5 text-xs font-medium underline hover:no-underline opacity-90 hover:opacity-100"
          >
            {notification.action.label}
          </button>
        )}
      </div>
      <button
        onClick={handleDismiss}
        className="flex-shrink-0 text-white/60 hover:text-white/90 transition-colors text-lg leading-none"
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </div>
  );
}

export default function NotificationContainer({ notifications, onDismiss }: NotificationContainerProps) {
  if (notifications.length === 0) return null;

  return (
    <div
      className="fixed top-4 right-4 z-[9999] flex flex-col items-end pointer-events-none"
      aria-live="polite"
    >
      {notifications.map(notification => (
        <div key={notification.id} className="pointer-events-auto">
          <NotificationItem notification={notification} onDismiss={onDismiss} />
        </div>
      ))}
    </div>
  );
}
