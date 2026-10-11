/**
 * The chip sound. iOS only lets audio start inside a user gesture, so the
 * first tap creates and resumes the audio context and plays a silent buffer;
 * after that the sound can play from any callback, such as a command's answer.
 */
type Ctx = AudioContext;

let ctx: Ctx | null = null;
let buffer: AudioBuffer | null = null;
let loading = false;

const SRC = '/chips.mp3';

function context(): Ctx | null {
  if (ctx) return ctx;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
  } catch {
    return null;
  }
  return ctx;
}

function load(c: Ctx): void {
  if (buffer || loading) return;
  loading = true;
  fetch(SRC)
    .then((r) => r.arrayBuffer())
    .then((data) => c.decodeAudioData(data))
    .then((b) => {
      buffer = b;
    })
    .catch(() => {
      loading = false;
    });
}

function unlock(): void {
  const c = context();
  if (!c) return;
  if (c.state !== 'running') void c.resume().catch(() => {});
  const silent = c.createBufferSource();
  silent.buffer = c.createBuffer(1, 1, 22_050);
  silent.connect(c.destination);
  silent.start(0);
  load(c);
  if (c.state === 'running') stopListening();
}

const EVENTS = ['pointerup', 'touchend', 'click', 'keydown'] as const;

function stopListening(): void {
  for (const e of EVENTS) document.removeEventListener(e, unlock, true);
}

export function installAudioUnlock(): void {
  for (const e of EVENTS) document.addEventListener(e, unlock, true);
}

export function playChips(): void {
  if (!ctx || !buffer || ctx.state !== 'running') return;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.value = 0.8;
  src.connect(gain).connect(ctx.destination);
  src.start(0);
}
