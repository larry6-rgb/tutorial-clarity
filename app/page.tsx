"use client";

import React from "react";

export default function LandingScaffold() {
  return (
    <div style={styles.root}>
      {/* Bright woven-graphite background (static lighting) */}
      <div style={styles.ambient} />
      <div style={styles.weaveA} />
      <div style={styles.weaveB} />
      <div style={styles.fiberTexture} />
      <div style={styles.keyLight} />
      <div style={styles.fillLight} />
      <div style={styles.specularStatic} />

      {/* Centered black card */}
      <div style={styles.card}>
        <h1 style={styles.title}>
          <span style={styles.titleGradient}>Tutorial Clarity</span>
        </h1>

        {/* Row with shorter white inset window and blue button */}
        <div style={styles.row}>
          <div style={styles.inputWindow}>
            <span style={styles.inputText}>Input YouTube URLs here.</span>
          </div>

          <button style={styles.button} type="button">
            WATCH ENHANCED
          </button>
        </div>
      </div>
    </div>
  );
}

/* Background constants (bright woven graphite) */
const TILE = 35;
const HIL = 2.5;
const GAP = 12.5;
const SHADOW_START = GAP;
const SHADOW_END = 16.5;

const styles: Record<string, React.CSSProperties> = {
  root: {
    position: "relative",
    minHeight: "100vh",
    backgroundColor: "#0a0d11",
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },

  // Bright background layers
  ambient: {
    position: "absolute",
    inset: 0,
    background:
      "radial-gradient(1800px 1000px at 50% 40%, #2a3240 0%, #1a2130 55%, #0a0d11 100%)",
    zIndex: 0,
  },
  weaveA: {
    position: "absolute",
    inset: 0,
    background: `
      repeating-linear-gradient(135deg,
        rgba(255,255,255,0.46) 0 ${HIL}px,
        rgba(0,0,0,0.00) ${HIL}px ${GAP}px),
      repeating-linear-gradient(135deg,
        rgba(0,0,0,0.48) ${SHADOW_START}px ${SHADOW_END}px,
        rgba(0,0,0,0.00) ${SHADOW_END}px ${TILE}px),
      repeating-linear-gradient(135deg,
        rgba(0,0,0,0.18) 10px 14px,
        rgba(0,0,0,0.00) 14px ${TILE}px)
    `,
    backgroundSize: `${TILE}px ${TILE}px, ${TILE}px ${TILE}px, ${TILE}px ${TILE}px`,
    opacity: 0.9,
    mixBlendMode: "overlay",
    zIndex: 2,
  },
  weaveB: {
    position: "absolute",
    inset: 0,
    background: `
      repeating-linear-gradient(225deg,
        rgba(220,240,255,0.42) 0 ${HIL}px,
        rgba(0,0,0,0.00) ${HIL}px ${GAP}px),
      repeating-linear-gradient(225deg,
        rgba(0,0,0,0.46) ${SHADOW_START}px ${SHADOW_END}px,
        rgba(0,0,0,0.00) ${SHADOW_END}px ${TILE}px),
      repeating-linear-gradient(225deg,
        rgba(0,0,0,0.16) 10px 14px,
        rgba(0,0,0,0.00) 14px ${TILE}px)
    `,
    backgroundSize: `${TILE}px ${TILE}px, ${TILE}px ${TILE}px, ${TILE}px ${TILE}px`,
    backgroundPosition: "10px 0, 10px 0, 10px 0",
    opacity: 0.86,
    mixBlendMode: "overlay",
    zIndex: 1,
  },
  fiberTexture: {
    position: "absolute",
    inset: 0,
    background: `
      repeating-linear-gradient(0deg, rgba(255,255,255,0.035) 0 1px, rgba(0,0,0,0.00) 1px 2px),
      radial-gradient(1400px 600px at 62% 14%, rgba(255,255,255,0.08), rgba(0,0,0,0) 60%)
    `,
    mixBlendMode: "soft-light",
    opacity: 0.95,
    zIndex: 3,
    pointerEvents: "none",
  },
  keyLight: {
    position: "absolute",
    inset: 0,
    background:
      "radial-gradient(1800px 700px at 18% 12%, rgba(255,255,255,0.42), rgba(0,0,0,0) 62%)",
    mixBlendMode: "screen",
    opacity: 0.95,
    zIndex: 4,
    pointerEvents: "none",
  },
  fillLight: {
    position: "absolute",
    inset: 0,
    background:
      "radial-gradient(1600px 600px at 82% 78%, rgba(160,190,230,0.26), rgba(0,0,0,0) 65%)",
    mixBlendMode: "screen",
    opacity: 0.85,
    zIndex: 5,
    pointerEvents: "none",
  },
  specularStatic: {
    position: "absolute",
    inset: 0,
    background:
      "radial-gradient(2000px 900px at 40% 20%, rgba(255,255,255,0.22), rgba(0,0,0,0) 60%)",
    mixBlendMode: "soft-light",
    opacity: 0.75,
    zIndex: 6,
    pointerEvents: "none",
  },

  // Card and contents
  card: {
    position: "relative",
    width: "min(820px, 92vw)",
    background: "#0b0e12",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 16,
    padding: "36px 24px",
    paddingBottom: "68px",
    boxShadow:
      "0 28px 70px rgba(0,0,0,0.55), 0 10px 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.10)",
    zIndex: 20,
  },
  title: {
    margin: "0 0 18px 0",
    fontSize: 26,
    lineHeight: 1.25,
    letterSpacing: 0.2,
    color: "#cfd6e0",
    fontFamily:
      'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"',
  },
  titleGradient: {
    background:
      "linear-gradient(90deg, #d6cbff 0%, #b79aff 28%, #8a5cf5 55%, #2f6df7 100%)",
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    color: "transparent",
    display: "inline-block",
  },

  row: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 0.75fr) auto",
    gap: 12,
    alignItems: "center",
    justifyContent: "center",
    width: "min(620px, 80vw)",
    margin: "0 auto",
  },

  // Large white inset window with black lettering
  inputWindow: {
    background: "#ffffff",
    border: "1px solid rgba(0,0,0,0.18)",
    borderRadius: 12,
    minHeight: 48,
    display: "flex",
    alignItems: "center",
    padding: "12px 14px",
    boxShadow: "inset 0 1px 2px rgba(0,0,0,0.10)",
  },
  inputText: {
    color: "#0f172a",
    fontSize: 14,
    fontWeight: 600,
    userSelect: "none",
  },

  // Royal blue button WITHOUT bottom color bleed
  button: {
    height: 48,
    padding: "0 14px",
    borderRadius: 12,
    border: "1px solid #2f6df7",         // match royal blue edge
    background: "#2f6df7",                // flat royal blue base (no gradient)
    // optional soft top sheen only (no bottom bleed):
    backgroundImage:
      "linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0) 40%)",
    color: "#ffffff",                     // crisp white text
    fontSize: 14,
    fontWeight: 800,
    letterSpacing: 0.25,
    cursor: "pointer",
    boxShadow:
      "0 10px 22px rgba(47,109,247,0.40), 0 6px 14px rgba(47,109,247,0.30)",
    WebkitFontSmoothing: "antialiased",
    MozOsxFontSmoothing: "grayscale",
    textShadow: "none",
    whiteSpace: "nowrap",
  },
};