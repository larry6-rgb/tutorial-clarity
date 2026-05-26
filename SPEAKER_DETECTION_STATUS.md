# Speaker Detection Implementation Status

## Current Approach

Tutorial Clarity has **two independent speaker detection systems** that serve different parts of the app:

### System 1: ClarifyAudioPanel (ACTIVE — what you're using now)
- **Source**: YouTube captions via `/api/transcript` → `/api/process-video`
- **Detection Method**: Client-side gap-based analysis in `ClarifyAudioPanel.tsx`
- **File**: `app/components/ClarifyAudioPanel.tsx` → `detectSpeakers()` function
- **How it works**: Analyzes gaps between caption segments to guess speaker boundaries
- **Voice Config UI**: Speaker Voices panel with male/female radio buttons per speaker

### System 2: AudioClarification (LEGACY — not currently active in watch page)
- **Source**: AssemblyAI transcription via `useChunkedTranscription` hook
- **Detection Method**: AssemblyAI's API speaker diarization (server-side)
- **Files**:
  - `app/hooks/useChunkedTranscription.ts` — calls `/api/assemblyai-transcription`
  - `app/hooks/useAudioClarification.tsx` — the old v129 audio component
  - `app/lib/speakerDiarization.ts` + `lib/speakerDiarization.ts` — Python-based diarization (script missing)
  - `app/lib/voiceAssignment.ts` + `lib/voiceAssignment.ts` — voice mapping logic
- **Status**: This code EXISTS in the codebase but is **NOT wired into the current watch page**. The current `app/watch/page.tsx` uses `ClarifyAudioPanel`, not `AudioClarification`.

## AssemblyAI Integration Status

| Item | Status |
|------|--------|
| **API Key Present** | ✅ Yes — in `.env.local`: `ASSEMBLYAI_API_KEY="b38fca044343485db6ab665c8af1b172"` |
| **npm Package Installed** | ❌ No — not in `package.json` |
| **API Route Exists** | ❌ No — `/api/assemblyai-transcription` route does NOT exist |
| **Python Diarization Script** | ❌ No — `python_services/speaker_diarization.py` does NOT exist |
| **Hook Code Exists** | ✅ Yes — `useChunkedTranscription.ts` has the call to `/api/assemblyai-transcription` |
| **Component Code Exists** | ✅ Yes — `useAudioClarification.tsx` (v129) references AssemblyAI flow |
| **Currently Active** | ❌ No — watch page uses `ClarifyAudioPanel`, not `AudioClarification` |

**Bottom line**: AssemblyAI integration was started but **never completed**. The API key is configured, the client-side hooks reference it, but the backend API route and Python diarization script were never created/committed.

## Impact of AssemblyAI Speaker Diarization Changes

### Does it affect us right now?
**No.** Since the AssemblyAI integration is incomplete and not active:
- The current speaker detection uses client-side gap analysis on YouTube captions
- No AssemblyAI API calls are being made
- The API key in `.env.local` is unused
- Any changes AssemblyAI makes to their diarization API have **zero impact** on the current app

### If we were to complete the integration, what would matter?
AssemblyAI's speaker diarization API changes could affect:
1. `useChunkedTranscription.ts` line ~155: Response parsing (`data.segments || data.utterances`)
2. Speaker ID format: Currently expects `SPEAKER_0`, `SPEAKER_1` etc.
3. Confidence scores: Currently optional (`seg.confidence || 1.0`)
4. Millisecond-to-second conversion: Currently divides by 1000

## Current Issues with Gap-Based Detection

The active detection (`ClarifyAudioPanel.tsx → detectSpeakers()`) has known problems:
- ❌ YouTube captions have overlapping timestamps (negative end-to-start gaps)
- ❌ All threshold-based methods fail when gaps are negative
- ❌ Text-based signals also check gap size, so they fail too
- ✅ **Recently fixed**: Added top-N largest start-to-start gaps fallback (commit `0e2ed2d`)
- ✅ **Recently fixed**: Added forced equal split as absolute last resort
- ❌ Still purely heuristic — can't actually identify WHO is speaking from audio

## Speaker Detection Comparison

| Feature | Current (Gap-Based) | AssemblyAI | 
|---------|---------------------|------------|
| **Cost** | ✅ Free | ❌ ~$0.65/hr of audio |
| **Accuracy** | ❌ Heuristic guessing | ✅ ML-based from actual audio |
| **Works with YouTube** | ⚠️ Unreliable (overlapping captions) | ✅ Analyzes actual audio |
| **Speaker identification** | ❌ Can't tell WHO is speaking | ✅ Identifies unique speakers |
| **Handles overlapping speech** | ❌ No | ✅ Yes |
| **Provides confidence scores** | ❌ No | ✅ Yes |
| **Processing time** | ✅ Instant (client-side) | ❌ 30-60s for transcription |
| **External dependency** | ✅ None | ❌ API + internet required |
| **Gender detection** | ❌ No | ⚠️ Not directly, but pitch analysis possible |

## Recommendations

### Short-term (now)
The recent fixes (top-N gaps + forced split + speakerOverride parameter) should make the current system work well enough for the voice configuration feature. **No AssemblyAI changes needed.**

### Medium-term (if speaker detection quality becomes a priority)
Consider completing the AssemblyAI integration:

1. Create `/api/assemblyai-transcription/route.ts` API route
2. Install `assemblyai` npm package
3. Submit YouTube audio URL to AssemblyAI with `speaker_labels: true`
4. Use their speaker labels directly (no gap detection needed)
5. Map their `SPEAKER_A/B/C` labels to voice configuration

**Estimated effort**: 3-4 hours for a working integration

### Before completing AssemblyAI integration
- Check their latest API docs for any breaking changes
- Verify the API key in `.env.local` is still valid
- Review their current pricing (~$0.65/hr is approximate)
- Test with the specific video types Larry uses (Easy German etc.)

## Files Reference

### Active (ClarifyAudioPanel system)
- `app/components/ClarifyAudioPanel.tsx` — detectSpeakers(), generateSeg(), voice config
- `app/watch/page.tsx` — Speaker Voices UI, Apply & Regenerate button
- `app/api/multi-voice-tts/route.ts` — TTS generation with voice parameter
- `app/api/process-video/route.ts` — Transcript fetching + translation

### Legacy (AssemblyAI system — incomplete)
- `app/hooks/useChunkedTranscription.ts` — AssemblyAI API caller
- `app/hooks/useAudioClarification.tsx` — v129 audio component
- `app/lib/speakerDiarization.ts` — Python diarization interface (script missing)
- `app/lib/voiceAssignment.ts` — Speaker→voice mapping
- `lib/speakerDiarization.ts` — Duplicate of above
- `lib/voiceAssignment.ts` — Duplicate of above

---
*Report generated: May 26, 2026*
*Branch: feature/v153-truly-clean*
