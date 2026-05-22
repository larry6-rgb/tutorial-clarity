/**
 * Tutorial Clarity — Simple Clipboard Launcher (NO ELECTRON NEEDED)
 *
 * Pure Node.js — no native binaries, no Electron download issues.
 * Works on Windows, Mac, and Linux.
 *
 * TWO-STEP NOTIFICATION WORKFLOW:
 *   1. Copy a YouTube URL
 *   2. Toast notification #1: "YouTube URL Detected! Click here to continue"
 *   3. Click the notification
 *   4. Toast notification #2: "Pause your video, then click here to open"
 *   5. Click it → Tutorial Clarity opens in your browser
 *
 * Also works with ENTER key in the terminal as a fallback.
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
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Config ──────────────────────────────────────────────────────────
const TC_BASE_URL = 'http://localhost:3000';
const POLL_INTERVAL_MS = 500;
const APP_NAME = 'Tutorial Clarity';
// ────────────────────────────────────────────────────────────────────

let lastClipboard = '';
let pendingUrl = null;
let urlCount = 0;

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
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

// ── Clipboard Reading (native OS commands — no clipboardy) ──────────

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

// ── Toast Notifications ─────────────────────────────────────────────

/**
 * Show a native toast notification and return a promise that resolves
 * to 'click' or 'timeout' (or rejects on error).
 */
function showToast(title, message) {
  return new Promise((resolve) => {
    notifier.notify(
      {
        title,
        message,
        sound: true,
        wait: true,                       // keep alive until user acts
        appID: APP_NAME,                  // shows "Tutorial Clarity" in Windows toast
      },
      (err, response) => {
        if (err) {
          console.error(`${DIM}  ⚠ Notification error: ${err.message}${RESET}`);
          resolve('error');
        } else {
          // response is 'click', 'timeout', or 'dismissed'
          resolve(response);
        }
      }
    );
  });
}

/**
 * Two-step notification workflow:
 *   Step 1: "YouTube URL Detected!" → click
 *   Step 2: "Pause your video first, then click" → click → open TC
 */
async function notifyAndOpen(youtubeUrl) {
  // ── Step 1: URL Detected notification ──
  console.log(`${PINK}${BOLD}  📢 Sending notification #1: URL Detected...${RESET}`);

  const step1 = await showToast(
    '🔗 YouTube URL Detected!',
    `I see you copied a URL!\n${youtubeUrl}\n\n👉 Click here to continue...`
  );

  console.log(`${DIM}  Notification #1 result: ${step1}${RESET}`);

  if (step1 !== 'click') {
    // User dismissed or it timed out — back to watching
    console.log(`${DIM}  (Notification dismissed — still watching clipboard)${RESET}`);
    console.log('');
    return;
  }

  // ── Step 2: Pause & Open notification ──
  console.log(`${YELLOW}${BOLD}  📢 Sending notification #2: Pause & Open...${RESET}`);

  const step2 = await showToast(
    '⏸ Pause Your Video First!',
    'Pause your YouTube video now.\n\n👉 Then click HERE to open in Tutorial Clarity!'
  );

  console.log(`${DIM}  Notification #2 result: ${step2}${RESET}`);

  if (step2 !== 'click') {
    console.log(`${DIM}  (Notification dismissed — still watching clipboard)${RESET}`);
    console.log('');
    return;
  }

  // ── Open in Tutorial Clarity ──
  await openInTutorialClarity(youtubeUrl);
}

// ── Console UI ──────────────────────────────────────────────────────

function showBanner() {
  console.log('');
  console.log(`${CYAN}${BOLD}╔═══════════════════════════════════════════════════╗${RESET}`);
  console.log(`${CYAN}${BOLD}║     🎯 Tutorial Clarity — Clipboard Launcher     ║${RESET}`);
  console.log(`${CYAN}${BOLD}╚═══════════════════════════════════════════════════╝${RESET}`);
  console.log('');
  console.log(`${DIM}  Watching clipboard for YouTube URLs...${RESET}`);
  console.log(`${DIM}  Copy any YouTube URL → you'll get a pop-up notification!${RESET}`);
  console.log(`${DIM}  (ENTER key also works as a fallback)${RESET}`);
  console.log(`${DIM}  Press Ctrl+C to quit.${RESET}`);
  console.log('');
}

function showStep1Terminal(youtubeUrl) {
  console.log('');
  console.log(`${PINK}${BOLD}╔═══════════════════════════════════════════════════╗${RESET}`);
  console.log(`${PINK}${BOLD}║  🔗 YouTube URL Detected!                        ║${RESET}`);
  console.log(`${PINK}${BOLD}╚═══════════════════════════════════════════════════╝${RESET}`);
  console.log(`${PINK}  ${youtubeUrl}${RESET}`);
  console.log('');
  console.log(`${YELLOW}${BOLD}  ⏸  STEP 1: Pause your YouTube video first!${RESET}`);
  console.log(`${YELLOW}${BOLD}  ⏎  STEP 2: Press ENTER to open (or click the pop-up!)${RESET}`);
  console.log('');
}

function showOpened() {
  console.log(`${GREEN}${BOLD}  ✅ Opened in Tutorial Clarity!${RESET}`);
  console.log(`${DIM}  ${TC_BASE_URL}/watch?url=...${RESET}`);
  console.log('');
  console.log(`${DIM}  Watching clipboard for more URLs...${RESET}`);
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

        // Show terminal message
        showStep1Terminal(ytUrl);

        // Fire the two-step toast notification workflow (async, non-blocking)
        notifyAndOpen(ytUrl).catch((err) => {
          console.error(`${DIM}  ⚠ Notification flow error: ${err.message}${RESET}`);
        });
      }
    }
  } catch (err) {
    console.error(`${DIM}  ⚠ clipboard poll error: ${err.message}${RESET}`);
  }
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  showBanner();

  // Capture current clipboard so we don't trigger on pre-existing content
  lastClipboard = readClipboard() || '';

  // Start clipboard polling
  const pollTimer = setInterval(checkClipboard, POLL_INTERVAL_MS);

  // ── Keypress handling (ENTER as fallback) ──
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

      // ENTER key — manual fallback (skips notification workflow)
      if (key === '\r' || key === '\n') {
        if (pendingUrl) {
          const url = pendingUrl;
          pendingUrl = null;
          console.log(`${DIM}  (ENTER pressed — skipping to open)${RESET}`);
          await openInTutorialClarity(url);
        } else {
          console.log(`${DIM}  (No YouTube URL pending — copy one first)${RESET}`);
        }
      }
    });
  } else {
    // Non-TTY fallback
    console.log(`${DIM}  (Non-TTY mode — type and press ENTER)${RESET}`);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', async (chunk) => {
      if (chunk.trim() === '' && pendingUrl) {
        const url = pendingUrl;
        pendingUrl = null;
        await openInTutorialClarity(url);
      }
    });
  }
}

main().catch(console.error);
