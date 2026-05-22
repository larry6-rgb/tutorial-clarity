# Tutorial Clarity — Two-Step Clipboard Launcher

A tiny Electron app that sits in your system tray and watches the clipboard.
When you copy a YouTube URL, it guides you through a **two-step process** to prevent audio overlap.

## The Two-Step Flow

1. **Copy** any YouTube URL (from browser, chat, document, etc.)
2. **PINK popup** appears: *"I see that you have selected a URL"*
3. **Click** the pink popup
4. **ORANGE popup** appears: *"Pause the video, then click here to view in Tutorial Clarity"*
5. **Pause** the YouTube video in your browser
6. **Click** the orange popup
7. **Tutorial Clarity** opens with your video — no audio overlap!

## Why Two Steps?

If Tutorial Clarity opened immediately, YouTube would still be playing audio.
The two-step process reminds you to pause the video first, preventing
YouTube audio from overlapping with the AI clarified audio.

## Setup

```powershell
cd C:\Dev\DevMenu110102025\TC\tutorial-clarity\electron-launcher
npm install
```

## Run

Make sure Tutorial Clarity is already running (`npm run dev` in the main project), then:

```powershell
npm start
```

A small blue icon appears in your system tray (bottom-right of taskbar).

## Tray Menu (right-click the icon)

- **✅ Watching Clipboard** — Toggle clipboard monitoring on/off
- **📊 URLs opened** — Count of videos opened this session
- **🌐 Open Tutorial Clarity** — Open the main app in your browser
- **❌ Quit** — Exit the launcher

## Dismissing Notifications

- Click the **✕** button on any notification to dismiss it
- Notifications auto-dismiss after 15 seconds if not clicked

## Files

| File | Purpose |
|------|---------|
| `main.js` | Main process — clipboard polling, notification windows, tray |
| `preload.js` | Secure IPC bridge for notification click handling |
| `package.json` | Dependencies (just Electron) |
