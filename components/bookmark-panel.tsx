
"use client";

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Bookmark, 
  Plus, 
  Edit3, 
  Trash2, 
  Clock,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '@/components/ui/dialog';
import { Bookmark as BookmarkType } from '@/lib/types';
import { formatTime } from '@/lib/youtube-utils';

interface BookmarkPanelProps {
  bookmarks: BookmarkType[];
  currentTime: number;
  onAddBookmark: (title: string, notes: string) => void;
  onEditBookmark: (bookmark: BookmarkType) => void;
  onDeleteBookmark: (bookmarkId: string) => void;
  onSeekTo: (time: number) => void;
  className?: string;
}

export default function BookmarkPanel({
  bookmarks,
  currentTime,
  onAddBookmark,
  onEditBookmark,
  onDeleteBookmark,
  onSeekTo,
  className = ""
}: BookmarkPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isAddingBookmark, setIsAddingBookmark] = useState(false);
  const [editingBookmark, setEditingBookmark] = useState<BookmarkType | null>(null);
  const [bookmarkForm, setBookmarkForm] = useState({ title: '', notes: '' });

  const handleAddBookmark = () => {
    if (bookmarkForm.title.trim()) {
      onAddBookmark(bookmarkForm.title, bookmarkForm.notes);
      setBookmarkForm({ title: '', notes: '' });
      setIsAddingBookmark(false);
    }
  };

  const handleEditBookmark = () => {
    if (editingBookmark && bookmarkForm.title.trim()) {
      const updatedBookmark = {
        ...editingBookmark,
        title: bookmarkForm.title,
        notes: bookmarkForm.notes
      };
      onEditBookmark(updatedBookmark);
      setEditingBookmark(null);
      setBookmarkForm({ title: '', notes: '' });
    }
  };

  const startEditing = (bookmark: BookmarkType) => {
    setEditingBookmark(bookmark);
    setBookmarkForm({ title: bookmark.title, notes: bookmark.notes });
  };

  const sortedBookmarks = [...bookmarks].sort((a, b) => a.timestamp - b.timestamp);

  return (
    <div className={`bg-white/5 backdrop-blur-sm border border-white/10 rounded-lg ${className}`}>
      <div className="p-4 border-b border-white/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bookmark size={20} className="text-blue-400" />
            <h3 className="text-white font-medium">Bookmarks</h3>
            <span className="bg-blue-600/20 text-blue-300 text-xs px-2 py-1 rounded-full">
              {bookmarks.length}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => setIsAddingBookmark(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              <Plus size={16} />
              Add
            </Button>
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
              {sortedBookmarks.length === 0 ? (
                <div className="text-center py-8 text-white/50">
                  <Bookmark size={48} className="mx-auto mb-3 opacity-30" />
                  <p>No bookmarks yet</p>
                  <p className="text-sm">Click "Add" to bookmark important moments</p>
                </div>
              ) : (
                sortedBookmarks.map((bookmark) => (
                  <motion.div
                    key={bookmark.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="group bg-white/5 border border-white/10 rounded-lg p-3 hover:bg-white/10 transition-colors cursor-pointer"
                    onClick={() => onSeekTo(bookmark.timestamp)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Clock size={14} className="text-blue-400" />
                          <span className="text-blue-300 text-sm font-mono">
                            {formatTime(bookmark.timestamp)}
                          </span>
                        </div>
                        <h4 className="text-white font-medium text-sm mb-1">
                          {bookmark.title}
                        </h4>
                        {bookmark.notes && (
                          <p className="text-white/70 text-xs leading-relaxed">
                            {bookmark.notes}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            startEditing(bookmark);
                          }}
                          className="text-white/60 hover:text-white hover:bg-white/10 p-1 h-auto"
                        >
                          <Edit3 size={12} />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteBookmark(bookmark.id);
                          }}
                          className="text-red-400 hover:text-red-300 hover:bg-red-500/10 p-1 h-auto"
                        >
                          <Trash2 size={12} />
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add Bookmark Dialog */}
      <Dialog open={isAddingBookmark} onOpenChange={setIsAddingBookmark}>
        <DialogContent className="bg-gray-900 border-gray-700">
          <DialogHeader>
            <DialogTitle className="text-white">Add Bookmark</DialogTitle>
            <DialogDescription className="text-white/70">
              Save this moment in the tutorial for easy reference later.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-white/70 text-sm mb-2 block">
                Timestamp: {formatTime(currentTime)}
              </label>
            </div>
            <div>
              <label className="text-white/70 text-sm mb-2 block">Title</label>
              <Input
                value={bookmarkForm.title}
                onChange={(e) => setBookmarkForm({ ...bookmarkForm, title: e.target.value })}
                placeholder="Enter bookmark title..."
                className="bg-white/10 border-white/20 text-white"
                autoFocus
              />
            </div>
            <div>
              <label className="text-white/70 text-sm mb-2 block">Notes (optional)</label>
              <Textarea
                value={bookmarkForm.notes}
                onChange={(e) => setBookmarkForm({ ...bookmarkForm, notes: e.target.value })}
                placeholder="Add notes about this moment..."
                className="bg-white/10 border-white/20 text-white resize-none"
                rows={3}
              />
            </div>
            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setIsAddingBookmark(false);
                  setBookmarkForm({ title: '', notes: '' });
                }}
                className="border-white/20 text-white hover:bg-white/10"
              >
                Cancel
              </Button>
              <Button
                onClick={handleAddBookmark}
                disabled={!bookmarkForm.title.trim()}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                Add Bookmark
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Bookmark Dialog */}
      <Dialog open={!!editingBookmark} onOpenChange={() => setEditingBookmark(null)}>
        <DialogContent className="bg-gray-900 border-gray-700">
          <DialogHeader>
            <DialogTitle className="text-white">Edit Bookmark</DialogTitle>
            <DialogDescription className="text-white/70">
              Modify the title and notes for this bookmark.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-white/70 text-sm mb-2 block">
                Timestamp: {editingBookmark ? formatTime(editingBookmark.timestamp) : ''}
              </label>
            </div>
            <div>
              <label className="text-white/70 text-sm mb-2 block">Title</label>
              <Input
                value={bookmarkForm.title}
                onChange={(e) => setBookmarkForm({ ...bookmarkForm, title: e.target.value })}
                placeholder="Enter bookmark title..."
                className="bg-white/10 border-white/20 text-white"
                autoFocus
              />
            </div>
            <div>
              <label className="text-white/70 text-sm mb-2 block">Notes (optional)</label>
              <Textarea
                value={bookmarkForm.notes}
                onChange={(e) => setBookmarkForm({ ...bookmarkForm, notes: e.target.value })}
                placeholder="Add notes about this moment..."
                className="bg-white/10 border-white/20 text-white resize-none"
                rows={3}
              />
            </div>
            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setEditingBookmark(null);
                  setBookmarkForm({ title: '', notes: '' });
                }}
                className="border-white/20 text-white hover:bg-white/10"
              >
                Cancel
              </Button>
              <Button
                onClick={handleEditBookmark}
                disabled={!bookmarkForm.title.trim()}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                Save Changes
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
