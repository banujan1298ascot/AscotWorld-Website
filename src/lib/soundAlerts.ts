"use client";

/**
 * Audible alerts for the MES pipeline (spec 3.5) — a distinct chime for a
 * fresh batch (Incoming) versus a returned one (rework), so an operator can
 * tell which without looking at the screen. Synthesized via the Web Audio
 * API rather than shipped as audio files — two short two-tone chimes, no
 * binary assets to manage or license.
 *
 * Browsers block audio playback until a user gesture unlocks it — true on
 * touch/tablet browsers especially (spec 3.6's "tap to enable audio" note).
 * `unlockAudio()` must be called from a click handler once per session
 * before `play*` actually produces sound; `useSoundAlertsEnabled` is a
 * separate, persisted on/off preference layered on top of that.
 */
import { useCallback, useState } from "react";

type AudioContextCtor = typeof AudioContext;

let audioContext: AudioContext | null = null;
let unlocked = false;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const ctor: AudioContextCtor | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
  if (!ctor) return null;
  if (!audioContext) audioContext = new ctor();
  return audioContext;
}

export function isAudioUnlocked(): boolean {
  return unlocked;
}

/** Call from inside a user-gesture event handler (e.g. a button's onClick). */
export function unlockAudio(): void {
  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume();
  unlocked = true;
}

function playTone(ctx: AudioContext, frequency: number, startTime: number, duration: number, peakGain = 0.15): void {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.02);
  gain.gain.linearRampToValueAtTime(0, startTime + duration);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(startTime);
  oscillator.stop(startTime + duration);
}

/** Two short rising tones — a fresh batch has arrived in Incoming. */
export function playNewArrivalSound(): void {
  if (!unlocked) return;
  const ctx = getContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  playTone(ctx, 880, now, 0.12);
  playTone(ctx, 1175, now + 0.13, 0.16);
}

/** Two short falling, lower tones — a distinct timbre for Returned/rework. */
export function playReturnedArrivalSound(): void {
  if (!unlocked) return;
  const ctx = getContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  playTone(ctx, 660, now, 0.12);
  playTone(ctx, 494, now + 0.13, 0.18);
}

const ENABLED_KEY = "ascotworld:mes-sound-enabled";

/**
 * Persisted on/off preference for MES sound alerts — separate from browser
 * autoplay unlock above, which is a one-time-per-session technical gate
 * rather than a preference. Defaults to on.
 *
 * Reads localStorage in the lazy useState initializer rather than an
 * effect: this hook is only ever rendered from src/app/(portal)/mes/page.tsx,
 * which sits behind the portal shell's own `ready` gate (auth.tsx) — nothing
 * here reaches the DOM until after that client-only hydration point, so
 * there's no server/client markup mismatch to worry about.
 */
export function useSoundAlertsEnabled(): [boolean, (next: boolean) => void] {
  const [enabled, setEnabledState] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      const stored = window.localStorage.getItem(ENABLED_KEY);
      return stored === null ? true : stored === "true";
    } catch {
      return true;
    }
  });

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    try {
      window.localStorage.setItem(ENABLED_KEY, String(next));
    } catch {
      // Preference simply won't persist.
    }
  }, []);

  return [enabled, setEnabled];
}
