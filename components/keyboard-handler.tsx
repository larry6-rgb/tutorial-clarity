
"use client";

import { useEffect } from 'react';

interface KeyboardHandlerProps {
  onSpaceBar: () => void;
  onLeftArrow: () => void;
  onRightArrow: () => void;
  onShiftLeftArrow: () => void;
  onShiftRightArrow: () => void;
  onUpArrow: () => void;
  onDownArrow: () => void;
  onBookmark: () => void;
  isEnabled: boolean;
}

export default function KeyboardHandler({
  onSpaceBar,
  onLeftArrow,
  onRightArrow,
  onShiftLeftArrow,
  onShiftRightArrow,
  onUpArrow,
  onDownArrow,
  onBookmark,
  isEnabled
}: KeyboardHandlerProps) {
  useEffect(() => {
    console.log('⭐⭐⭐ KEYBOARD HANDLER USEEFFECT STARTING ⭐⭐⭐');
    console.log('🔑 Keyboard handler enabled:', isEnabled);
    
    if (!isEnabled) {
      console.log('❌ Keyboard handler DISABLED - not setting up listeners');
      return;
    }

    console.log('✅ Keyboard handler ENABLED - setting up AGGRESSIVE keyboard capture...');
    
    // Track events for debugging
    let eventCount = 0;

    const handleKeyDown = (event: KeyboardEvent) => {
      eventCount++;
      
      // DEBUG: Log ALL keyboard events with maximum detail
      console.log('═══════════════════════════════════════');
      console.log('🔑 KEY EVENT #' + eventCount);
      console.log('   Key:', event.key);
      console.log('   Code:', event.code);
      console.log('   Target:', (event.target as HTMLElement).tagName);
      console.log('   Target class:', (event.target as HTMLElement).className);
      console.log('   Event phase:', event.eventPhase, '(1=capture, 2=target, 3=bubble)');
      console.log('   Active element:', document.activeElement?.tagName, document.activeElement?.className);
      console.log('═══════════════════════════════════════');
      
      // Only handle if no input/textarea is focused
      const target = event.target as HTMLElement;
      const isInputFocused = target.tagName === 'INPUT' || 
                           target.tagName === 'TEXTAREA' || 
                           target.contentEditable === 'true';

      if (isInputFocused) {
        console.log('⏭️ Ignoring - user is typing in input field');
        return;
      }

      switch (event.code) {
        case 'Space':
          console.log('⌨️ ⚡ ⚡ ⚡ SPACEBAR PRESSED! Calling onSpaceBar...');
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          onSpaceBar();
          console.log('✅ onSpaceBar() called');
          break;
        case 'ArrowLeft':
          if (event.shiftKey) {
            console.log('⬅️⬅️⬅️ SHIFT+LEFT ARROW pressed (30s backward)');
            event.preventDefault();
            event.stopPropagation();
            onShiftLeftArrow();
          } else {
            console.log('⬅️ LEFT ARROW pressed (10s backward)');
            event.preventDefault();
            event.stopPropagation();
            onLeftArrow();
          }
          break;
        case 'ArrowRight':
          if (event.shiftKey) {
            console.log('➡️➡️➡️ SHIFT+RIGHT ARROW pressed (30s forward)');
            event.preventDefault();
            event.stopPropagation();
            onShiftRightArrow();
          } else {
            console.log('➡️ RIGHT ARROW pressed (10s forward)');
            event.preventDefault();
            event.stopPropagation();
            onRightArrow();
          }
          break;
        case 'ArrowUp':
          console.log('⬆️ UP ARROW pressed');
          event.preventDefault();
          event.stopPropagation();
          onUpArrow();
          break;
        case 'ArrowDown':
          console.log('⬇️ DOWN ARROW pressed');
          event.preventDefault();
          event.stopPropagation();
          onDownArrow();
          break;
        case 'KeyB':
          if (event.ctrlKey || event.metaKey) {
            console.log('🔖 BOOKMARK shortcut pressed (Ctrl+B)');
            event.preventDefault();
            event.stopPropagation();
            onBookmark();
          }
          break;
        default:
          console.log('⏭️ Key not handled by Tutorial Clarity');
      }
    };

    // SUPER AGGRESSIVE: Add listeners to MULTIPLE targets with BOTH phases
    console.log('📍 Adding keyboard listeners to:');
    
    // 1. Window - capture phase (highest priority)
    window.addEventListener('keydown', handleKeyDown, true);
    console.log('   ✅ window (capture phase)');
    
    // 2. Window - bubble phase
    window.addEventListener('keydown', handleKeyDown, false);
    console.log('   ✅ window (bubble phase)');
    
    // 3. Document - capture phase
    document.addEventListener('keydown', handleKeyDown, true);
    console.log('   ✅ document (capture phase)');
    
    // 4. Document - bubble phase
    document.addEventListener('keydown', handleKeyDown, false);
    console.log('   ✅ document (bubble phase)');
    
    // 5. Document body - for good measure
    document.body.addEventListener('keydown', handleKeyDown, true);
    console.log('   ✅ document.body (capture phase)');
    
    console.log('🎯 ALL keyboard listeners installed! Event counter at:', eventCount);
    console.log('👆 Try pressing ANY key now - you should see detailed event logs!');
    
    // Try to ensure document has focus
    try {
      if (document.activeElement?.tagName === 'IFRAME') {
        console.log('⚠️ WARNING: An iframe has focus! Trying to focus body...');
        document.body.focus();
        console.log('✅ Body focused');
      }
    } catch (e) {
      console.log('ℹ️ Could not change focus:', e);
    }
    
    // Cleanup - remove ALL listeners
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keydown', handleKeyDown, false);
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('keydown', handleKeyDown, false);
      document.body.removeEventListener('keydown', handleKeyDown, true);
      console.log('🧹 ALL keyboard listeners removed. Final event count:', eventCount);
    };
  }, [isEnabled, onSpaceBar, onLeftArrow, onRightArrow, onShiftLeftArrow, onShiftRightArrow, onUpArrow, onDownArrow, onBookmark]);

  return null;
}
