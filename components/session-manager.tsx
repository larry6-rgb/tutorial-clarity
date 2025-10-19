
"use client";

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  History, 
  Play, 
  Trash2, 
  Clock,
  ChevronDown,
  ChevronUp,
  Calendar
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TutorialSession } from '@/lib/types';
import { formatTime } from '@/lib/youtube-utils';

interface SessionManagerProps {
  sessions: TutorialSession[];
  currentSession: TutorialSession | null;
  onLoadSession: (session: TutorialSession) => void;
  onDeleteSession: (sessionId: string) => void;
  className?: string;
}

export default function SessionManager({
  sessions,
  currentSession,
  onLoadSession,
  onDeleteSession,
  className = ""
}: SessionManagerProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const sortedSessions = [...sessions].sort((a, b) => 
    new Date(b.lastViewed).getTime() - new Date(a.lastViewed).getTime()
  );

  const formatDate = (date: Date) => {
    const now = new Date();
    const diffInHours = (now.getTime() - new Date(date).getTime()) / (1000 * 60 * 60);
    
    if (diffInHours < 1) {
      return 'Just now';
    } else if (diffInHours < 24) {
      return `${Math.floor(diffInHours)} hours ago`;
    } else if (diffInHours < 48) {
      return 'Yesterday';
    } else {
      return new Date(date).toLocaleDateString();
    }
  };

  return (
    <div className={`bg-white/5 backdrop-blur-sm border border-white/10 rounded-lg ${className}`}>
      <div className="p-4 border-b border-white/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History size={20} className="text-green-400" />
            <h3 className="text-white font-medium">Recent Sessions</h3>
            <span className="bg-green-600/20 text-green-300 text-xs px-2 py-1 rounded-full">
              {sessions.length}
            </span>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-white/60 hover:text-white hover:bg-white/10"
          >
            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </Button>
        </div>
      </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="p-4 space-y-3 max-h-96 overflow-y-auto">
              {sortedSessions.length === 0 ? (
                <div className="text-center py-8 text-white/50">
                  <History size={48} className="mx-auto mb-3 opacity-30" />
                  <p>No saved sessions yet</p>
                  <p className="text-sm">Sessions are automatically saved as you watch</p>
                </div>
              ) : (
                sortedSessions.map((session) => (
                  <motion.div
                    key={session.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`group border rounded-lg p-3 transition-all ${
                      currentSession?.id === session.id
                        ? 'bg-green-600/20 border-green-500/40'
                        : 'bg-white/5 border-white/10 hover:bg-white/10'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <h4 className="text-white font-medium text-sm mb-1 truncate">
                          {session.videoTitle || `Video ${session.videoId}`}
                        </h4>
                        <div className="flex items-center gap-3 text-xs text-white/70 mb-2">
                          <div className="flex items-center gap-1">
                            <Clock size={12} />
                            <span>{formatTime(session.currentTime)}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Calendar size={12} />
                            <span>{formatDate(session.lastViewed)}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-white/50">
                          <span>{session.bookmarks.length} bookmarks</span>
                          <span>•</span>
                          <span>{session.playbackRate}x speed</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-2">
                        {currentSession?.id !== session.id && (
                          <Button
                            size="sm"
                            onClick={() => onLoadSession(session)}
                            className="bg-green-600 hover:bg-green-700 text-white p-1 h-auto"
                          >
                            <Play size={12} />
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onDeleteSession(session.id)}
                          className="text-red-400 hover:text-red-300 hover:bg-red-500/10 p-1 h-auto"
                        >
                          <Trash2 size={12} />
                        </Button>
                      </div>
                    </div>
                    
                    {currentSession?.id === session.id && (
                      <div className="mt-2 pt-2 border-t border-green-500/20">
                        <div className="flex items-center gap-1 text-xs text-green-300">
                          <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                          Currently watching
                        </div>
                      </div>
                    )}
                  </motion.div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
