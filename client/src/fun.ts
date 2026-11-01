// Toasts, sounds and particles. Everything is generated in the browser: no audio or image files.
import { useSyncExternalStore } from 'react';

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode: the setting just lasts until reload.
  }
}

function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: T) {
      value = next;
      listeners.forEach((l) => l());
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
}

// --- Toasts
export interface Toast {
  id: number;
  text: string;
}
const toasts = createStore<Toast[]>([]);
let toastId = 0;
export function toast(text: string) {
  const id = ++toastId;
  toasts.set([...toasts.get(), { id, text }]);
  setTimeout(() => toasts.set(toasts.get().filter((t) => t.id !== id)), 3500);
}
export const useToasts = () => useSyncExternalStore(toasts.subscribe, toasts.get);

// --- Theme
const prefersDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;
const theme = createStore<'light' | 'dark'>(
  stored('purrfect-theme') === 'dark' || (stored('purrfect-theme') === null && prefersDark()) ? 'dark' : 'light',
);
document.documentElement.dataset.theme = theme.get();
export const useTheme = () => useSyncExternalStore(theme.subscribe, theme.get);
export function toggleTheme() {
  const next = theme.get() === 'dark' ? 'light' : 'dark';
  theme.set(next);
  document.documentElement.dataset.theme = next;
  store('purrfect-theme', next);
}

// --- Purr sound
const sound = createStore<boolean>(stored('purrfect-sound') !== 'off');
export const useSound = () => useSyncExternalStore(sound.subscribe, sound.get);
export function toggleSound() {
  sound.set(!sound.get());
  store('purrfect-sound', sound.get() ? 'on' : 'off');
  if (sound.get()) purr();
}

let audio: AudioContext | null = null;
/** A purr is a low buzz whose volume pulses about 25 times a second. */
export function purr(seconds = 0.9) {
  if (!sound.get()) return;
  audio ??= new AudioContext();
  const now = audio.currentTime;
  const tone = audio.createOscillator();
  tone.type = 'sawtooth';
  tone.frequency.value = 58;
  const pulse = audio.createOscillator();
  pulse.frequency.value = 25;
  const pulseDepth = audio.createGain();
  pulseDepth.gain.value = 0.05;
  const volume = audio.createGain();
  volume.gain.setValueAtTime(0, now);
  volume.gain.linearRampToValueAtTime(0.06, now + 0.1);
  volume.gain.linearRampToValueAtTime(0, now + seconds);
  const filter = audio.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 320;
  pulse.connect(pulseDepth).connect(volume.gain);
  tone.connect(filter).connect(volume).connect(audio.destination);
  tone.start(now);
  pulse.start(now);
  tone.stop(now + seconds);
  pulse.stop(now + seconds);
}

// --- Particles
const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function particle(emoji: string, x: number, y: number, size: number) {
  const el = document.createElement('span');
  el.textContent = emoji;
  el.className = 'particle';
  el.setAttribute('aria-hidden', 'true');
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.fontSize = `${size}px`;
  document.body.append(el);
  return el;
}

export function pawConfetti(x: number, y: number, emoji = '🐾') {
  if (calm()) return;
  for (let i = 0; i < 14; i++) {
    const angle = Math.random() * Math.PI * 2;
    const distance = 50 + Math.random() * 110;
    const el = particle(i % 3 ? emoji : '✨', x, y, 14 + Math.random() * 18);
    el.animate(
      [
        { transform: 'translate(-50%, -50%) scale(.4)', opacity: 1 },
        {
          transform: `translate(calc(-50% + ${Math.cos(angle) * distance}px), calc(-50% + ${Math.sin(angle) * distance + 50}px)) rotate(${Math.random() * 360}deg) scale(1)`,
          opacity: 0,
        },
      ],
      { duration: 650 + Math.random() * 350, easing: 'cubic-bezier(.15,.7,.3,1)' },
    ).onfinish = () => el.remove();
  }
}

export function catParty() {
  if (calm()) return;
  const emojis = ['🐱', '😻', '🐾', '🐈', '🐟', '😹', '👑', '🐈‍⬛'];
  for (let i = 0; i < 70; i++) {
    const el = particle(emojis[i % emojis.length]!, Math.random() * window.innerWidth, -60, 22 + Math.random() * 34);
    el.animate(
      [
        { transform: 'translateY(0) rotate(0deg)' },
        { transform: `translateY(${window.innerHeight + 120}px) rotate(${Math.random() * 720 - 360}deg)` },
      ],
      { duration: 1800 + Math.random() * 2400, delay: Math.random() * 1500, easing: 'linear', fill: 'backwards' },
    ).onfinish = () => el.remove();
  }
}

export function timeAgo(ms: number): string {
  const rtf = new Intl.RelativeTimeFormat('ru', { numeric: 'auto' });
  const minutes = Math.round((ms - Date.now()) / 60_000);
  if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
  return rtf.format(Math.round(hours / 24), 'day');
}
