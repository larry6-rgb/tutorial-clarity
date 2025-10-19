
"use client";

interface PauseOverlayProps {
  isVisible: boolean;
  currentTime: string;
  onDismiss?: () => void;
}

export default function PauseOverlay({ isVisible, currentTime, onDismiss }: PauseOverlayProps) {
  if (!isVisible) return null;

  return (
    <div 
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm cursor-pointer"
      onClick={onDismiss}
    >
      <div className="text-center">
        <div className="text-6xl mb-4">⏸️</div>
        <h2 className="text-3xl font-bold text-white mb-2">PAUSED</h2>
        <p className="text-xl text-gray-300 mb-4">{currentTime}</p>
        <p className="text-sm text-gray-400 max-w-md px-4">
          Press <kbd className="px-2 py-1 bg-gray-700 rounded">Spacebar</kbd> to resume, or click anywhere to clear overlay
        </p>
      </div>
    </div>
  );
}
