# Tutorial Clarity - Multi-Voice Bug Report for Claude Code

## Quick Summary

A YouTube video tutorial translation app with multi-speaker voice support has a critical bug: voices play incorrectly despite correct detection, generation, and storage. Voices sometimes change mid-sentence.

## The Flow That Should Work

1. User loads YouTube video with 3 speakers
2. AssemblyAI detects speakers A, B, C
3. System maps to speaker_0, speaker_1, speaker_2
4. User assigns voices: speaker_0=Nova, speaker_1=Onyx, speaker_2=Shimmer
5. System generates audio for each segment with correct voice
6. Scheduler plays audio synchronized with video
7. Each segment plays with its assigned voice

## What Actually Happens

Steps 1-5 work perfectly (verified via logs). Step 6-7 broken: wrong voices play, sometimes changing mid-sentence.

## Key Files to Review

1. `app/components/ClarifyAudioPanel.tsx` - Main audio generation & scheduling (~1800 lines)
2. `app/watch/page.tsx` - UI and configuration (~2400 lines)
3. `app/api/detect-speakers/route.ts` - AssemblyAI integration
4. `app/api/multi-voice-tts/route.ts` - OpenAI TTS API
5. `app/utils/matchSpeakerSegments.ts` - Speaker label matching
6. `VOICE_BUG_DIAGNOSTICS.md` - Detailed diagnostic report

## The Mystery

- Generation logs show: "Generated segment 0 with voice=nova" ✅
- Cache stores: voice="nova" at index 0 ✅
- Post-generation audit: 3 different voices confirmed ✅
- But playback sounds wrong ❌

**Key clue:** Voices change mid-sentence → scheduler is switching audio blobs during playback

## Suspected Issues

1. Scheduler fetching wrong audio blob index
2. Audio blobs stored at wrong indices in `cacheRef`
3. Segment indices not aligned with audio indices
4. Overlapping audio playback (multiple blobs playing simultaneously)

## Architecture

```
ClarifyAudioPanel.tsx manages:
  - cacheRef: { [segIndex]: { url, voice, generating } }  — audio blob storage
  - frozenVoiceMapRef: { speaker_0: "nova", ... }         — voice assignments
  - assemblyAISpeakerMapRef: Map<segIndex, speakerId>      — AssemblyAI labels
  - translatedTxRef: ClarifyTranscriptSegment[]            — transcript segments
  - schedulerRef: setInterval loop                         — timing-based playback
  - audioRef: HTMLAudioElement                             — current playing audio

Playback flow:
  schedulerRef fires every ~100ms → checks currentTime vs segment timestamps
  → finds correct segment index → fetches cacheRef[index].url → plays audio
```

## What We Need

Help identifying the bug in the audio playback/scheduling logic. All generation is confirmed working - the issue is purely in playback.

## Project Details

- Framework: Next.js 14
- Audio: HTML5 Audio element + Object URLs from fetch blobs
- TTS: OpenAI API (nova/onyx/shimmer/echo/fable/alloy voices)
- Speaker Detection: AssemblyAI (file upload pipeline)
- Branch: `feature/v153-truly-clean`

## Diagnostic Tools Available

- `window.testAudioBlobs()` — manually plays first 5 cached audio blobs to verify correct voices
- POST-GENERATION VOICE AUDIT in console logs — confirms voice distribution after generation
- Manual Detection button — gap-based speaker detection (no API needed)
