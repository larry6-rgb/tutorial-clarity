# Multi-Voice Speaker Detection - Diagnostic Report

## Problem Statement

**Current Issue:** After AssemblyAI speaker detection and voice assignment, audio plays with incorrect voices. Voices sometimes change mid-sentence.

**Expected Behavior:**
- AssemblyAI detects 3 speakers (A, B, C)
- System maps them to speaker_0, speaker_1, speaker_2
- User assigns voices: speaker_0=Nova (F), speaker_1=Onyx (M), speaker_2=Shimmer (F)
- Generated audio plays with correct voice for each segment
- Each segment maintains its assigned voice throughout

**Actual Behavior:**
- AssemblyAI detection works ✅
- Speaker mapping works ✅
- Voice assignment shows correctly in UI ✅
- Audio generation logs show different voices being generated ✅
- BUT: Audio plays with wrong voices ❌
- Voices sometimes change MID-SENTENCE ❌

## Test Video

- URL: https://www.youtube.com/watch?v=LuSLPOZ07qU
- Language: German
- Speakers: 3 (2 women, 1 narrator)
- Expected: Speaker 0=Nova, Speaker 1=Onyx, Speaker 2=Shimmer

## What We've Tried

### 1. AssemblyAI Integration (✅ Working)
- Implemented file upload to avoid URL expiry
- Fixed `speech_models` parameter (array vs string)
- Download → Upload → Process pipeline works
- Speaker detection accurate

### 2. Speaker Label Persistence (✅ Working)
- Added `assemblyAISpeakerMapRef` to survive React re-renders
- Labels correctly stored and retrieved
- Voice map shows correct assignments

### 3. Voice Assignment (✅ Working)
- `frozenVoiceMapRef` contains correct mappings
- Console logs show correct voice for each segment
- TTS API receives correct voice parameter

### 4. Audio Generation (✅ Working)
- Multi-voice TTS generates different voices
- API logs confirm: nova, onyx, shimmer all generated
- Audio blobs stored in `cacheRef`

### 5. The Problem: Playback/Scheduling (❌ BROKEN)

**Hypothesis:** The scheduler is playing the wrong audio blob for each segment.

**Evidence:**
- Voices change mid-sentence (scheduler switches blobs mid-playback?)
- All segments show correct voice in logs but play wrong voice
- Audio blobs might be stored at wrong index
- Scheduler might be using wrong index to fetch audio

## Critical Files

### 1. Main Component
`app/components/ClarifyAudioPanel.tsx`
- Audio generation logic
- Voice assignment
- Scheduler integration
- Key refs: `frozenVoiceMapRef`, `assemblyAISpeakerMapRef`, `cacheRef`

### 2. Watch Page
`app/watch/page.tsx`
- Speaker configuration UI
- Voice selection (radio buttons)
- Apply & Regenerate handler

### 3. Speaker Detection API
`app/api/detect-speakers/route.ts`
- AssemblyAI integration
- Audio download via yt-dlp
- Speaker mapping (A, B, C → speaker_0, speaker_1, speaker_2)

### 4. TTS API
`app/api/multi-voice-tts/route.ts`
- OpenAI TTS API calls
- Returns audio blob with metadata

### 5. Speaker Matching Utility
`app/utils/matchSpeakerSegments.ts`
- Matches AssemblyAI segments to YouTube segments
- Text similarity + time overlap
- Returns updated transcript with speaker labels

## Key Data Structures

### Transcript Segment
```typescript
interface ClarifyTranscriptSegment {
  text: string;      // Translated text
  start: number;     // Start time in seconds
  end: number;       // End time in seconds
  speaker?: string;  // "speaker_0", "speaker_1", "speaker_2"
}
```

### Voice Map
```typescript
frozenVoiceMapRef.current = {
  speaker_0: "nova",     // Female
  speaker_1: "onyx",     // Male
  speaker_2: "shimmer"   // Female
}
```

### Audio Cache
```typescript
// cacheRef.current — indexed by segment number
interface AudioCache {
  [index: number]: {
    url?: string;           // Object URL for the audio blob
    useClientTTS?: boolean;
    generating?: boolean;
    voice?: string;         // Which TTS voice was used for this segment
    generatedAt?: number;
  };
}
```

## Suspected Root Cause

**The scheduler is likely:**
1. Using the wrong index to fetch audio from `cacheRef`
2. Playing audio out of order
3. Not synchronizing segment index with audio index
4. Switching audio blobs mid-playback

**Key question:** When segment 5 should play (speaker_1, voice=onyx), is the scheduler:
- Fetching cacheRef.current[5]? (correct)
- Or fetching the wrong index?
- Or playing multiple blobs overlapping?

## Next Steps for Investigation

1. **Add index validation in scheduler:**
   - Log which segment index is playing
   - Log which audio blob index is being fetched
   - Verify they match

2. **Check audio blob storage:**
   - After generation, verify cacheRef indices match transcript indices
   - Log audio blob sizes to detect missing/duplicate blobs

3. **Scheduler timing:**
   - Check if scheduler is switching audio mid-playback
   - Verify audio.currentTime matches expected timing
   - Check for overlapping audio playback

4. **Manual blob test:**
   - Run `window.testAudioBlobs()` in browser console
   - Plays first 5 blobs sequentially with 3s gaps
   - Listen to verify each blob has the correct voice

## Console Log Patterns

**Good generation logs:**
```
[REGEN] ★ Re-applying stored AssemblyAI speaker map (42 entries)
[REGEN] Segment speaker distribution: {speaker_0: 34, speaker_1: 5, speaker_2: 3}
[REGEN] FROZEN MAP CREATED: {"speaker_0":"nova","speaker_1":"onyx","speaker_2":"shimmer"}
```

**Post-generation audit (expected):**
```
[AUDIT] Voice distribution: {"nova": 34, "onyx": 5, "shimmer": 3}
[AUDIT] ✅ Multiple voices detected — multi-voice is WORKING
```

**But playback sounds wrong → scheduler/playback bug**

## Diagnostic Tools

### Manual Audio Blob Test
Run in browser console after generating audio:
```javascript
window.testAudioBlobs()
```
This plays the first 5 blobs sequentially (3s gaps) and logs expected vs actual voice for each.

### Manual Speaker Detection
Click the "🔧 Manual Detection (Gap-Based)" button for quick gap-based detection without AssemblyAI API calls.

---

**Created:** 2026-05-27
**Status:** ACTIVE BUG - Voices play incorrectly despite correct generation
**Priority:** HIGH - Core feature broken
