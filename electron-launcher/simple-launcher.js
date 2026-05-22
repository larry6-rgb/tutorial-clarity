/**
 * Tutorial Clarity — Simple Clipboard Launcher (NO ELECTRON NEEDED)
 *
 * Pure Node.js — no native binaries, no Electron download issues.
 * Works on Windows, Mac, and Linux.
 *
 * TWO-STEP WORKFLOW (with toast notifications as alerts):
 *   1. Copy a YouTube URL
 *   2. 🔔 Toast pops up + terminal shows: "URL Detected! Press ENTER"
 *   3. Press ENTER → "Now pause your video... press ENTER again"
 *   4. 🔔 Second toast + press ENTER → opens Tutorial Clarity
 *
 * The toast notifications are visual/audio alerts to get your attention.
 * ENTER key in the terminal drives the actual workflow.
 *
 * Usage:
 *   cd electron-launcher
 *   npm run simple        (uses this file)
 *
 * Or directly:
 *   node simple-launcher.js
 */

import open from 'open';
import notifier from 'node-notifier';
import { execSync } from 'child_process';
import { platform } from 'os';

// ── Config ──────────────────────────────────────────────────────────
const TC_BASE_URL = 'http://localhost:3000';
const POLL_INTERVAL_MS = 500;
// ────────────────────────────────────────────────────────────────────

let lastClipboard = '';
let pendingUrl = null;
let urlCount = 0;

// State machine: 'watching' → 'step1' → 'step2' → (opens) → 'watching'
let state = 'watching';

// ── YouTube URL Detection ───────────────────────────────────────────

function extractYouTubeUrl(text) {
  if (!text || typeof text !== 'string') return null;
  const patterns = [
    /https?:\/\/(?:www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
    /https?:\/\/youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /https?:\/\/(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /https?:\/\/(?:www\.)?youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return `https://www.youtube.com/watch?v=${match[1]}`;
  }
  return null;
}

// ── Terminal Colors ─────────────────────────────────────────────────

const PINK = '\x1b[35m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const WHITE = '\x1b[37m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const BG_PINK = '\x1b[45m';
const BG_YELLOW = '\x1b[43m';
const BG_GREEN = '\x1b[42m';
const BLACK = '\x1b[30m';

// ── Clipboard Reading (native OS commands) ──────────────────────────

function readClipboard() {
  const os = platform();
  try {
    if (os === 'win32') {
      return execSync('powershell.exe -NoProfile -Command "Get-Clipboard"', {
        encoding: 'utf8',
        timeout: 3000,
        windowsHide: true,
      }).trim();
    } else if (os === 'darwin') {
      return execSync('pbpaste', { encoding: 'utf8', timeout: 3000 }).trim();
    } else {
      return execSync('xclip -selection clipboard -o', { encoding: 'utf8', timeout: 3000 }).trim();
    }
  } catch {
    return null;
  }
}

// ── Toast Notification (fire-and-forget alert) ──────────────────────

function fireToast(title, message) {
  try {
    notifier.notify({
      title,
      message,
      sound: true,
      wait: false,           // fire-and-forget — don't rely on click callback
      appID: 'Tutorial Clarity',
    });
  } catch (err) {
    // Toast failed — not critical, terminal is the primary UI
    console.error(`${DIM}  ⚠ Toast failed: ${err.message}${RESET}`);
  }
}

// ── Console UI ──────────────────────────────────────────────────────

function showBanner() {
  console.log('');
  console.log(`${CYAN}${BOLD}╔═══════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${CYAN}${BOLD}║      🎯 Tutorial Clarity — Clipboard Launcher        ║${RESET}`);
  console.log(`${CYAN}${BOLD}╚═══════════════════════════════════════════════════════╝${RESET}`);
  console.log('');
  console.log(`${WHITE}  📋 Watching clipboard for YouTube URLs...${RESET}`);
  console.log(`${WHITE}  Copy any YouTube URL to get started.${RESET}`);
  console.log(`${DIM}  Press Ctrl+C to quit.${RESET}`);
  console.log('');
}

function showUrlDetected(youtubeUrl) {
  console.log('');
  console.log(`${PINK}${BOLD}╔═══════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${PINK}${BOLD}║  🔗 YouTube URL Detected!                            ║${RESET}`);
  console.log(`${PINK}${BOLD}╚═══════════════════════════════════════════════════════╝${RESET}`);
  console.log(`${PINK}  ${youtubeUrl}${RESET}`);
  console.log('');
  console.log(`${BG_PINK}${WHITE}${BOLD}  >>> Press ENTER to continue <<<  ${RESET}`);
  console.log('');
}

function showPausePrompt() {
  console.log('');
  console.log(`${YELLOW}${BOLD}╔═══════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${YELLOW}${BOLD}║  ⏸  Now pause your YouTube video!                    ║${RESET}`);
  console.log(`${YELLOW}${BOLD}╚═══════════════════════════════════════════════════════╝${RESET}`);
  console.log('');
  console.log(`${YELLOW}  Go to your browser and pause the YouTube video.${RESET}`);
  console.log(`${YELLOW}  Then come back here and:${RESET}`);
  console.log('');
  console.log(`${BG_YELLOW}${BLACK}${BOLD}  >>> Press ENTER to open in Tutorial Clarity <<<  ${RESET}`);
  console.log('');
}

function showOpened() {
  console.log('');
  console.log(`${GREEN}${BOLD}╔═══════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${GREEN}${BOLD}║  ✅ Opened in Tutorial Clarity!                       ║${RESET}`);
  console.log(`${GREEN}${BOLD}╚═══════════════════════════════════════════════════════╝${RESET}`);
  console.log(`${DIM}  ${TC_BASE_URL}/watch?url=...${RESET}`);
  console.log('');
  console.log(`${WHITE}  📋 Watching clipboard for more URLs...${RESET}`);
  console.log('');
}

// ── Open Tutorial Clarity ───────────────────────────────────────────

async function openInTutorialClarity(youtubeUrl) {
  const encodedUrl = encodeURIComponent(youtubeUrl);
  const tcUrl = `${TC_BASE_URL}/watch?url=${encodedUrl}`;

  try {
    await open(tcUrl);
    urlCount++;
    showOpened();

    // Fire a success toast
    fireToast('✅ Tutorial Clarity', 'Video opened in your browser!');
  } catch (err) {
    console.error(`  ❌ Failed to open browser: ${err.message}`);
    console.log(`  📋 Copy this URL manually: ${tcUrl}`);
    console.log('');
  }
}

// ── Clipboard Polling ───────────────────────────────────────────────

function checkClipboard() {
  try {
    const current = readClipboard();
    if (current === null) return;

    if (current && current !== lastClipboard) {
      lastClipboard = current;
      const ytUrl = extractYouTubeUrl(current);
      if (ytUrl && ytUrl !== pendingUrl) {
        pendingUrl = ytUrl;
        state = 'step1';

        // Show terminal prompt
        showUrlDetected(ytUrl);

        // Fire toast notification as visual alert
        fireToast(
          '🔗 YouTube URL Detected!',
          `${ytUrl}\n\nSwitch to the terminal and press ENTER!`
        );
      }
    }
  } catch (err) {
    console.error(`${DIM}  ⚠ clipboard poll error: ${err.message}${RESET}`);
  }
}

// ── ENTER Key Handler (state machine) ───────────────────────────────

async function handleEnter() {
  if (state === 'step1' && pendingUrl) {
    // Move to step 2: pause prompt
    state = 'step2';
    showPausePrompt();

    // Fire second toast
    fireToast(
      '⏸ Pause Your Video!',
      'Pause your YouTube video, then press ENTER in the terminal.'
    );

  } else if (state === 'step2' && pendingUrl) {
    // Open Tutorial Clarity!
    const url = pendingUrl;
    pendingUrl = null;
    state = 'watching';
    await openInTutorialClarity(url);

  } else {
    console.log(`${DIM}  (No YouTube URL pending — copy one first)${RESET}`);
  }
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  showBanner();

  // Capture current clipboard so we don't trigger on pre-existing content
  lastClipboard = readClipboard() || '';

  // Start clipboard polling
  const pollTimer = setInterval(checkClipboard, POLL_INTERVAL_MS);

  // ── Keypress handling ──
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    process.stdin.on('data', async (key) => {
      // Ctrl+C
      if (key === '\u0003') {
        console.log('');
        console.log(`${DIM}  👋 Goodbye! Opened ${urlCount} video(s) this session.${RESET}`);
        clearInterval(pollTimer);
        process.exit(0);
      }

      // ENTER key — drives the two-step workflow
      if (key === '\r' || key === '\n') {
        await handleEnter();
      }
    });
  } else {
    // Non-TTY fallback
    console.log(`${DIM}  (Non-TTY mode — type and press ENTER)${RESET}`);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', async (chunk) => {
      if (chunk.trim() === '') {
        await handleEnter();
      }
    });
  }
}

main().catch(console.error);
