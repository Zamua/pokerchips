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

let hiss: AudioBuffer | null = null;

/** A short buffer of white noise, made once. */
function noise(c: Ctx): AudioBuffer {
  if (hiss) return hiss;
  hiss = c.createBuffer(1, Math.ceil(c.sampleRate * 0.05), c.sampleRate);
  const d = hiss.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return hiss;
}

/**
 * Two soft chip clicks, like tapping an empty rack, for a tap that cannot do
 * anything. Synthesized, so it needs no file; about the chip sound's
 * loudness.
 */
export function playNope(): void {
  if (!ctx || ctx.state !== 'running') return;
  const c = ctx;
  const decay = (g: GainNode, at: number, peak: number, length: number) => {
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.001 + length);
  };
  for (const at of [c.currentTime, c.currentTime + 0.09]) {
    const tap = c.createBufferSource();
    tap.buffer = noise(c);
    const band = c.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 3_200;
    band.Q.value = 6;
    const g = c.createGain();
    decay(g, at, 1.6, 0.045);
    tap.connect(band).connect(g).connect(c.destination);
    tap.start(at);
    const ring = c.createOscillator();
    ring.frequency.value = 2_400;
    const rg = c.createGain();
    decay(rg, at, 0.24, 0.04);
    ring.connect(rg).connect(c.destination);
    ring.start(at);
    ring.stop(at + 0.06);
  }
}
