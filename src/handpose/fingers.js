export const FINGER_TIPS = { index: 8, middle: 12, ring: 16, pinky: 20 };

// Each hand gets its own 4 notes rather than both hands duplicating the
// same set — that turns 4 playable pitches into a full C4-to-C5 scale
// across both hands, instead of everything past a 4-note run being
// unplayable. Trade-off versus the old single pentatonic set: chords
// formed by multiple fingers of the SAME hand can now be a half-step
// apart (e.g. ring+pinky on the left hand = E+F) instead of guaranteed
// consonant — full diatonic range costs the "never clashes" guarantee.
export const FINGER_NOTES_BY_HAND = {
  Left: { index: 'C4', middle: 'D4', ring: 'E4', pinky: 'F4' },
  Right: { index: 'G4', middle: 'A4', ring: 'B4', pinky: 'C5' },
};

// Hysteresis gap between trigger and release stops a note flickering
// on/off when a pinch hovers near the boundary. Tune to taste.
export const PINCH_TRIGGER_RATIO = 0.3;
export const PINCH_RELEASE_RATIO = 0.45;

// Piano mode: hand height glides pitch by up to one octave — raise your
// hand to go up, lower it to go down. y is 0 at the top of frame, 1 at
// the bottom (smaller y = higher hand), 0.5 = no shift. Continuous, so
// the pitch slides smoothly rather than snapping between fixed bands.
export function octaveShiftFromHeight(y) {
  const shift = (0.5 - y) * 2;
  return Math.max(-1, Math.min(1, shift));
}

export function shiftNoteOctave(note, shift) {
  const match = note.match(/^([A-G]#?)(\d)$/);
  if (!match) return note;
  const [, pitch, octaveDigits] = match;
  return `${pitch}${parseInt(octaveDigits, 10) + shift}`;
}

// Piano mode: hand tilt bends pitch, up to a max of MAX_DETUNE_CENTS
// (200 cents = 2 semitones) at MAX_TILT_DEG of roll in either direction.
const MAX_TILT_DEG = 45;
const MAX_DETUNE_CENTS = 200;

export function detuneFromTilt(tiltRadians) {
  const tiltDeg = (tiltRadians * 180) / Math.PI;
  const clamped = Math.max(-MAX_TILT_DEG, Math.min(MAX_TILT_DEG, tiltDeg));
  return (clamped / MAX_TILT_DEG) * MAX_DETUNE_CENTS;
}

// Guitar mode: same four fingers, mapped to an open G major chord
// voicing (low to high, index -> pinky).
export const GUITAR_STRING_NOTES = {
  index: 'G3',
  middle: 'B3',
  ring: 'D4',
  pinky: 'G4',
};

// A curled finger mutes its string; only extended fingers ring on strum.
export const CURL_MUTE_THRESHOLD = 0.5;

// Normalized hand-position velocity (frame-heights/second) that counts
// as a deliberate downward strum, not just drifting the hand around.
export const STRUM_VELOCITY_THRESHOLD = 1.5;
