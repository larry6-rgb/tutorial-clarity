# Multi-Voice Testing Guide

## Current Status

✅ **Working on test video (October in Slow German):**
- **Nova**: Female narrator (woman in yellow) — speaker_0
- **Onyx**: Male speaker (Janus) — speaker_1
- **Shimmer**: Woman in blue — speaker_2 (needs verification, may have fewer lines)

## How to Test on New Videos

### 1. Choose Test Videos

**Good test candidates:**
- 2-3 distinct speakers
- Different genders (easier to verify)
- Clear speech (not overlapping)
- Moderate length (5-15 minutes)

### 2. Testing Process

1. Load video in Tutorial Clarity
2. Click **"🎯 Detect Speakers with AI"**
3. Wait for detection to complete (~1-3 minutes)
4. Check console for speaker distribution:
   ```
   speaker_0: X segments
   speaker_1: Y segments
   speaker_2: Z segments
   ```
5. Verify voice assignments in UI (Female/Male selections)
6. Click **"Apply & Regenerate Audio"**
7. Click **"🧪 Test Audio Blobs (Play First 5)"**
8. Listen and verify voices match speakers

### 3. What to Check

**✅ Good signs:**
- Multiple speakers detected (not all speaker_0)
- Different voices for different speakers
- Voices stay consistent (no mid-sentence changes)
- Audio synced with video

**❌ Warning signs:**
- All segments labeled speaker_0
- All audio using same voice
- Voices changing mid-sentence
- Audio playing too early/late

### 4. Document Results

For each test video, note:
- Video URL
- Number of speakers detected
- Which voices were correct
- Any issues observed

### 5. Known Limitations

- Works best with 2-3 speakers
- Requires clear, distinct voices
- May struggle with:
  - Heavy background noise
  - Overlapping speech
  - Very similar voices (two women, same age/accent)
  - More than 3 speakers

## Troubleshooting

**If all speakers show as speaker_0:**
1. Try "🔧 Manual Detection (Gap-Based)" instead
2. Check if video has captions available

**If voices sound wrong:**
1. Check console for "Expected Voice" vs "Cached Voice"
2. Try regenerating with different gender assignments
3. Use "Nuclear Clear & Regenerate" to start fresh

**If detection fails:**
1. Check console for errors
2. Video may not have downloadable audio
3. Try a different video

## Success Criteria

The system is working well if:
- ✅ Detects correct number of speakers (2-3)
- ✅ Assigns distinct voices to each
- ✅ Voices stay consistent throughout
- ✅ Audio synced with video timing
- ✅ Works on 80%+ of test videos

## Next Steps

After testing 5-10 videos:
1. Report which types work best
2. Note common failure patterns
3. Decide if ready for production use
