# Tutorial Clarity v153 — Sync Fixes Installation Guide

**Date:** 2026-05-11  
**Fixes:** 3 critical sync bugs causing TTS stutter at ~252 seconds  
**Base version:** v152  

---

## Summary of the Problem

In v152, the clarified TTS audio stutters and loses sync with the YouTube video around the 252-second mark. Three root causes were identified:

1. **George can't see the player** — `getVideoTime()` looks for `window.__TC_ACTIVE_YT_PLAYER__` but page.tsx stores the player only in a local React ref.
2. **Synthetic timeline drift** — `adaptSegmentsForAudio()` ignores real YouTube caption timestamps and builds a fake cumulative timeline based on word counts. Any pause, music break, or silence in the video causes progressive drift.
3. **Always starts at 0:00** — `ClarifyAudioPanel.handleStart()` never passes the current video time to `start()`, so TTS always begins from the beginning regardless of where the user is watching.

---

## Files Changed (3 files)

### FIX #1 — `app/watch/page.tsx`
**Install path:** `/app/watch/page.tsx`  
**What changed:**
- Added `declare global { interface Window { __TC_ACTIVE_YT_PLAYER__: any; } }` TypeScript declaration at top of file
- In `onReady` callback (YouTube player init), added: `window.__TC_ACTIVE_YT_PLAYER__ = event.target;`
- In cleanup return of the player `useEffect`, added: `window.__TC_ACTIVE_YT_PLAYER__ = null;`

**Why:** George's `getVideoTime()` in `useAudioTranslation.ts` tries to read `window.__TC_ACTIVE_YT_PLAYER__.getCurrentTime()` to get the real video position. Without this global, George falls back to stale callbacks or estimates, causing drift detection to malfunction.

### FIX #2 — `components/useAudioClarification.ts`
**Install path:** `/components/useAudioClarification.ts`  
**What changed:**
- Rewrote the `adaptSegmentsForAudio()` function (~lines 387–574)
- **REMOVED:** Synthetic cumulative timeline (`let cumulativeTime = 0; ... start = cumulativeTime; cumulativeTime += scaledDuration;`)
- **ADDED:** Resolves original YouTube timestamps (`seg.start`, `seg.duration`, `raw.end`, `raw.startMs/endMs`) and uses them directly
- Falls back to positional estimate only when original timestamps are genuinely missing (NaN/undefined)
- Diagnostic logging updated from `[v129]` to `[v153]` with timing source tracking

**Why:** The v129 approach created segment timings like `0.00s, 2.40s, 5.10s...` based on word counts when the actual YouTube captions were at `0.00s, 3.50s, 12.80s...` (with natural pauses). By 252 seconds, the synthetic timeline had drifted far enough that George's 100ms sync loop entered a stutter cycle of jump→detect-drift→jump.

### FIX #3 — `components/ClarifyAudioPanel.tsx`
**Install path:** `/components/ClarifyAudioPanel.tsx`  
**What changed:**
- `handleStart()` now passes `currentTime` to `actions.start(currentTime)` instead of calling `actions.startClarification(videoId, selectedLanguage)` with no time
- Fixed hook destructuring from `{ state, actions }` to `[state, actions]` to match `useClarifyAudio` tuple return
- Fixed method names to match hook API: `stopClarification` → `stop`, `pauseAudio` → `pause`, `resumeAudio` → `resume`, `setVolume` → `setAudioVolume`, `setMuted` → `setAudioMuted`
- Fixed `state.progress` → `state.processingProgress`
- Added default export

**Why:** The `start()` function in `useClarifyAudio.ts` accepts `startTime?: number` (defaults to 0). Without passing the current video time, TTS always started generating from segment 0, requiring George to fast-forward through potentially minutes of already-watched content.

---

## Installation Steps

### 1. Back up current files
```bash
cp app/watch/page.tsx app/watch/page.tsx.v152-backup
cp components/useAudioClarification.ts components/useAudioClarification.ts.v152-backup  # if exists
cp components/ClarifyAudioPanel.tsx components/ClarifyAudioPanel.tsx.v152-backup  # if exists
```

### 2. Copy the v153 fixed files
```bash
# From the v153 package directory:
cp v153/app/watch/page.tsx            app/watch/page.tsx
cp v153/components/useAudioClarification.ts  components/useAudioClarification.ts
cp v153/components/ClarifyAudioPanel.tsx      components/ClarifyAudioPanel.tsx
```

### 3. Verify the fixes are present
```bash
# FIX #1: Player exposed globally
grep "__TC_ACTIVE_YT_PLAYER__" app/watch/page.tsx
# Should show 3 lines: declare, assignment in onReady, cleanup in return

# FIX #2: Real timestamps preserved
grep "PRESERVING original YouTube timestamps" components/useAudioClarification.ts
# Should show the v153 log message

# FIX #3: currentTime passed to start
grep "actions.start(currentTime)" components/ClarifyAudioPanel.tsx
# Should show the fixed handleStart call
```

### 4. Restart the dev server
```bash
npm run dev
# or
yarn dev
```

### 5. Test the fixes
1. Open a YouTube tutorial video (ideally 5+ minutes)
2. Seek to ~2:00 in the video
3. Open the Menu → Click "Start Clarification"
4. Verify in browser console:
   - `[v153] Player ready — exposed to window.__TC_ACTIVE_YT_PLAYER__` (FIX #1)
   - `[v153] ✅ All N segments using original YouTube timestamps` (FIX #2)
   - `[v153] ClarifyAudioPanel.handleStart() — starting from currentTime=120.00s` (FIX #3)
5. Let it play past the 4:12 mark (252 seconds) — stuttering should be eliminated

---

## Support Files (also included)

These files were copied from the v152 uploads into the project structure. They are **unchanged** but were missing from the project directory:

| File | Install Path |
|------|-------------|
| `useClarifyAudio.ts` | `hooks/useClarifyAudio.ts` |
| `useAudioTranslation.ts` | `hooks/useAudioTranslation.ts` |
| `useChunkedTranscription.ts` | `hooks/useChunkedTranscription.ts` |
| `useAudioClarification.ts` | `hooks/useAudioClarification.ts` |
| `useNotifications.ts` | `hooks/useNotifications.ts` |
| `useSpeechRateCalculator.ts` | `hooks/useSpeechRateCalculator.ts` |
| `useVideoProcessing.ts` | `hooks/useVideoProcessing.ts` |
| `useClarificationUsage.ts` | `hooks/useClarificationUsage.ts` |
| `clarifyAudioEngine.ts` | `lib/clarifyAudioEngine.ts` |
| `audioBufferManager.ts` | `lib/audioBufferManager.ts` |
| `voiceAssignment.ts` | `lib/voiceAssignment.ts` |
| `speakerDiarization.ts` | `lib/speakerDiarization.ts` |
| `clientSpeakerDetection.ts` | `lib/clientSpeakerDetection.ts` |
| `cache.ts` | `lib/cache.ts` |
| `ClarificationLimitPopup.tsx` | `components/ClarificationLimitPopup.tsx` |

---

## Rollback

To revert to v152:
```bash
git checkout v152-baseline -- app/watch/page.tsx
git checkout v152-baseline -- components/useAudioClarification.ts
git checkout v152-baseline -- components/ClarifyAudioPanel.tsx
```

Or restore from backups:
```bash
cp app/watch/page.tsx.v152-backup app/watch/page.tsx
# etc.
```
