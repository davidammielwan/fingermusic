import { pinchDistance, fingerCurl, handPosition, handTilt } from './geometry.js';
import {
  FINGER_TIPS,
  FINGER_NOTES,
  PINCH_TRIGGER_RATIO,
  PINCH_RELEASE_RATIO,
  GUITAR_STRING_NOTES,
  CURL_MUTE_THRESHOLD,
  STRUM_VELOCITY_THRESHOLD,
  octaveShiftFromHeight,
  detuneFromTilt,
} from './fingers.js';

const CENTS_PER_OCTAVE = 1200;

// Smooths out per-frame landmark jitter before it reaches pitch math —
// without this, small tracking noise in y/tilt reads as an audible
// warble even while the hand is essentially still. Lower = smoother but
// laggier; tune to taste.
const SMOOTHING_ALPHA = 0.25;

function smooth(previous, next) {
  return previous === undefined ? next : previous + SMOOTHING_ALPHA * (next - previous);
}

function voiceIdFor(handIndex) {
  return `hand-${handIndex}`;
}

// Per-hand state objects also carry non-finger fields (smoothedY,
// smoothedTilt) alongside the 4 finger-active booleans. Anything that
// walks a hand's active fingers must iterate this list specifically,
// not Object.entries(state) — a nonzero smoothed value is truthy too,
// so blindly iterating every property looks up FINGER_NOTES[undefined]
// keys like 'smoothedY' (producing a literal "undefined" note) and, worse,
// calls noteOff on that undefined note and stomps the smoothing state
// with `false` in the process.
const FINGER_NAMES = Object.keys(FINGER_NOTES);

// Per-hand state, keyed by hand index within the frame's detection
// results: which fingers are currently sounding (the note identity never
// changes while held — octave is applied as a live detune offset
// instead, so a plain boolean is enough), plus smoothed y/tilt readings.
const handStates = [];

export function updateInteraction(handsLandmarks, instrument) {
  const seenHandIndices = new Set();

  handsLandmarks.forEach((landmarks, handIndex) => {
    seenHandIndices.add(handIndex);
    const state = (handStates[handIndex] ??= {});
    const voiceId = voiceIdFor(handIndex);

    for (const [finger, tipIndex] of Object.entries(FINGER_TIPS)) {
      const pinch = pinchDistance(landmarks, tipIndex);
      const note = FINGER_NOTES[finger];
      const isActive = state[finger] ?? false;

      if (!isActive && pinch < PINCH_TRIGGER_RATIO) {
        instrument.noteOn(note, 1, voiceId);
        state[finger] = true;
      } else if (isActive && pinch > PINCH_RELEASE_RATIO) {
        instrument.noteOff(note, voiceId);
        state[finger] = false;
      }
    }

    // Octave shift (hand height) and pitch bend (hand tilt) are each
    // hand's own independent detune voice, recalculated every frame from
    // wherever that hand currently is — so moving between octaves or
    // tilting glides whatever that hand is already holding, with no
    // need to release and re-trigger, and each hand stays independent.
    state.smoothedY = smooth(state.smoothedY, handPosition(landmarks).y);
    state.smoothedTilt = smooth(state.smoothedTilt, handTilt(landmarks));
    const octaveCents = octaveShiftFromHeight(state.smoothedY) * CENTS_PER_OCTAVE;
    const tiltCents = detuneFromTilt(state.smoothedTilt);
    instrument.setParam('detune', octaveCents + tiltCents, voiceId);
  });

  // A hand that left the frame won't appear in handsLandmarks anymore —
  // release any notes it still had active so they don't hang forever.
  handStates.forEach((state, handIndex) => {
    if (!state || seenHandIndices.has(handIndex)) return;
    const voiceId = voiceIdFor(handIndex);
    for (const finger of FINGER_NAMES) {
      if (state[finger]) {
        instrument.noteOff(FINGER_NOTES[finger], voiceId);
        state[finger] = false;
      }
    }
  });
}

// Currently-sounding note names across all tracked hands, for UI display.
// Deduped — two hands holding the same note should still show it once.
export function getActivePianoNotes() {
  const notes = new Set();
  handStates.forEach((state) => {
    if (!state) return;
    for (const finger of FINGER_NAMES) {
      if (state[finger]) notes.add(FINGER_NOTES[finger]);
    }
  });
  return [...notes];
}

// Releases every note the piano mode still has active. Call this before
// switching away from piano mode so no note is left hanging mid-play.
export function releaseAllPianoNotes(instrument) {
  handStates.forEach((state, handIndex) => {
    if (!state) return;
    const voiceId = voiceIdFor(handIndex);
    for (const finger of FINGER_NAMES) {
      if (state[finger]) {
        instrument.noteOff(FINGER_NOTES[finger], voiceId);
        state[finger] = false;
      }
    }
  });
}

// Per-hand strum tracking, keyed by hand index.
const guitarStates = [];

export function updateGuitarInteraction(handsLandmarks, instrument) {
  const now = performance.now();

  handsLandmarks.forEach((landmarks, handIndex) => {
    const state = (guitarStates[handIndex] ??= {
      prevY: null,
      prevTime: null,
      strumming: false,
    });
    const pos = handPosition(landmarks);

    if (state.prevY !== null) {
      const dt = (now - state.prevTime) / 1000;
      const velocity = (pos.y - state.prevY) / dt; // positive = moving down

      if (velocity > STRUM_VELOCITY_THRESHOLD && !state.strumming) {
        strum(landmarks, instrument);
        state.strumming = true;
      } else if (velocity < STRUM_VELOCITY_THRESHOLD / 2) {
        state.strumming = false;
      }
    }

    state.prevY = pos.y;
    state.prevTime = now;
  });
}

// Guitar plucks decay on their own rather than sustaining, so there's no
// real "active" state to query the way piano has. For UI display, track
// how recently each string was struck instead and show it as a brief
// flash rather than a held tag.
const RECENTLY_STRUMMED_MS = 400;
const lastStrummedAt = {};

function strum(landmarks, instrument) {
  for (const finger of Object.keys(FINGER_TIPS)) {
    if (fingerCurl(landmarks, finger) < CURL_MUTE_THRESHOLD) {
      const note = GUITAR_STRING_NOTES[finger];
      instrument.noteOn(note);
      lastStrummedAt[note] = performance.now();
    }
  }
}

export function getActiveGuitarNotes() {
  const now = performance.now();
  return Object.entries(lastStrummedAt)
    .filter(([, at]) => now - at < RECENTLY_STRUMMED_MS)
    .map(([note]) => note);
}
