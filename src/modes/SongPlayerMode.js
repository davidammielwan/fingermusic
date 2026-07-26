import * as Tone from 'tone';
import { Autotune } from '../audio/effects/Autotune.js';
import { Reverb } from '../audio/effects/Reverb.js';
import { Delay } from '../audio/effects/Delay.js';
import { NostalgiaChain } from '../audio/effects/NostalgiaChain.js';
import { fingerCurl, handPosition, handTilt, pinchDistance } from '../handpose/geometry.js';

const SMOOTHING_ALPHA = 0.2;
function smooth(previous, next) {
  return previous === undefined ? next : previous + SMOOTHING_ALPHA * (next - previous);
}

// All 4 fingers past this curl counts as a fist; all 4 below this counts
// as an open palm. The gap between is a dead zone so a half-curled hand
// doesn't flicker between states. Tune to taste.
const FIST_CURL_THRESHOLD = 0.6;
const PALM_CURL_THRESHOLD = 0.3;

const NON_THUMB_FINGERS = ['index', 'middle', 'ring', 'pinky'];

// Delay is a thumb-to-index pinch, but the same thumb-index gap also
// closes as a side effect of clenching the whole hand into a fist —
// gating on individual fingers (tried previously) doesn't hold up
// because people don't curl all 4 fingers in lockstep: whichever finger
// happens to lead the clench (often not index) can still leave the
// pinch reading "open" for several frames. Averaging curl across all 4
// non-thumb fingers is robust to that ordering: a deliberate one-finger
// pinch keeps 3 of the 4 fingers near zero curl, which caps the average
// well below the close threshold even if the pinching index finger
// itself curls all the way to its max — only a hand that's genuinely
// closing as a whole (multiple fingers rising together, as any real
// fist-forming motion does) can push the average past it. Two
// thresholds (not one) give this a dead zone, same reasoning as
// FIST_CURL_THRESHOLD/PALM_CURL_THRESHOLD above.
const DELAY_GATE_OPEN_AVG = 0.15;
const DELAY_GATE_CLOSE_AVG = 0.3;

// Reverb + delay are both time-based "space" effects — run fully
// independently they can stack into a congested wash. They share this
// combined wetness budget instead: if both are turned up at once, both
// scale back proportionally rather than each independently maxing out.
const COMBINED_SPACE_MAX = 0.75;

// Right fist + vertical drag = speed, like grabbing a turntable platter.
// Dragging up speeds it up, down slows it down — matches the height
// convention used everywhere else in this project (higher = more).
const MIN_SPEED = 0.5;
const MAX_SPEED = 2.0;
const SPEED_SENSITIVITY = 2.5;

// A comfortably-held hand rests lower than the frame's exact vertical
// center — pivoting "50% volume" at literal y=0.5 meant a naturally-held
// hand actually read well under 50%. Same fix already applied to pitch
// in an earlier version of this file: recenter "neutral" on where a
// hand actually rests, not on the frame's geometric middle.
const VOLUME_NEUTRAL_Y = 0.65;
const VOLUME_RANGE_Y = 0.5;

function allFingersCurled(landmarks) {
  return NON_THUMB_FINGERS.every((f) => fingerCurl(landmarks, f) > FIST_CURL_THRESHOLD);
}

// Fixed gesture roles, per hand, for controlling song playback:
//   Left hand  — open palm = play, fist = pause; height = volume (a
//                naturally-resting hand height reads 50%, not literal
//                screen-center)
//   Right hand — open: tilt = autotune amount, y-position = reverb
//                (centered vertically = untouched/off; y isn't affected
//                by the display's horizontal mirroring, unlike x),
//                thumb-to-index pinch = delay.
//                Clenched into a fist: dragging vertically changes
//                playback speed (and, tape/turntable-style, pitch along
//                with it — this is the "nostalgic slowed/sped-up" effect,
//                not an independent pitch-preserving time-stretch), and
//                the other three effects stop responding until you open
//                the hand again.
//   Both hands closed into fists — toggles a lock: while locked, none
//                of the above (including play/pause) responds to hand
//                movement — everything freezes exactly where it was, so
//                you can move your hands freely, or rest them closed,
//                without disturbing playback or the sound. Close both
//                fists again to unlock; since that requires the left
//                hand to be a fist, playback pauses the instant you
//                unlock unless you immediately open it back up.
//
// MediaPipe's Left/Right handedness labels are based on the raw camera
// frame, not the CSS-mirrored display — if roles come out swapped from
// what you'd expect facing the camera, that's the mirroring convention
// to double check, not a logic bug.
export class SongPlayerMode {
  constructor() {
    this.autotune = new Autotune();
    this.nostalgia = new NostalgiaChain();
    this.delay = new Delay();
    this.reverb = new Reverb();
    this.volume = new Tone.Gain(0.5);
    // Final hard ceiling: whatever combination of gesture settings you
    // dial in, the fast-attack limiter guarantees the output can't clip.
    // Per-effect wet/dry caps bound each effect individually but don't
    // guarantee the combined signal stays safe — this does.
    this.limiter = new Tone.Limiter(-1);

    // Delay before reverb: the echo repeats get diffused by the reverb
    // tail into one cohesive wash, rather than reverb feeding into delay
    // and producing distinct, cluttered repeats of an already-reverberant
    // signal.
    this.autotune.output.connect(this.nostalgia.input);
    this.nostalgia.output.connect(this.delay.node);
    this.delay.node.connect(this.reverb.node);
    this.reverb.node.connect(this.volume);
    this.volume.connect(this.limiter);
    this.limiter.toDestination();

    this._wasExtended = false;
    this._wasCurled = false;
    this._wasBothFists = false;
    this._locked = false;
    this._leftSmoothY = undefined;
    this._rightSmoothTilt = undefined;
    this._rightSmoothY = undefined;
    this._rightWasFist = false;
    this._speedDragAnchorY = null;
    this._delayGateOpen = true;

    this.state = {
      leftPresent: false,
      rightPresent: false,
      locked: false,
      speed: 1,
      volume: 0.5,
      autotuneAmount: 0,
      reverbAmount: 0,
      delayAmount: 0,
    };
  }

  // Pass this to LocalFilePlayer.connectEffectsChain() instead of letting
  // it connect straight to the speakers.
  getEntryNode() {
    return this.autotune.input;
  }

  updateInteraction(handsLandmarks, handedness, localFilePlayer) {
    let leftLandmarks = null;
    let rightLandmarks = null;
    handsLandmarks.forEach((landmarks, i) => {
      const category = handedness[i]?.[0]?.categoryName;
      if (category === 'Left') leftLandmarks = landmarks;
      else if (category === 'Right') rightLandmarks = landmarks;
    });

    this.state.leftPresent = !!leftLandmarks;
    this.state.rightPresent = !!rightLandmarks;

    const leftAllCurled = leftLandmarks ? allFingersCurled(leftLandmarks) : false;
    const leftAllExtended = leftLandmarks
      ? NON_THUMB_FINGERS.every((f) => fingerCurl(leftLandmarks, f) < PALM_CURL_THRESHOLD)
      : false;
    const rightAllCurled = rightLandmarks ? allFingersCurled(rightLandmarks) : false;

    const bothFists = leftLandmarks && rightLandmarks && leftAllCurled && rightAllCurled;
    if (bothFists && !this._wasBothFists) {
      this._locked = !this._locked;
      if (!this._locked) {
        // Just unlocked. Both hands were necessarily fists to trigger
        // this gesture, so re-arm the edge-triggers as if this were the
        // first frame of normal operation: if the left hand is still
        // closed right after unlocking, playback stops here; open it
        // and the next frame's edge-trigger below resumes it.
        this._wasExtended = false;
        this._wasCurled = false;
        // Right hand was also necessarily a fist to trigger this — treat
        // unlocking as a fresh grab rather than resuming a drag from
        // wherever the anchor was left off before locking.
        this._rightWasFist = false;
      }
    }
    this._wasBothFists = bothFists;
    this.state.locked = this._locked;

    // Play/pause only responds to the left hand while unlocked — locking
    // freezes transport along with the continuous settings below, so
    // closing both hands to lock never itself pauses whatever was
    // already playing, and there's no need to keep a hand open just to
    // keep the music going while locked.
    if (!this._locked && leftLandmarks) {
      // Independent edge-triggers (not a single toggle) so the very first
      // gesture works regardless of which state came before it — a
      // toggle keyed off "was it previously a fist" would silently do
      // nothing on an open palm that's the first gesture seen.
      if (leftAllExtended && !this._wasExtended) {
        localFilePlayer.play();
      }
      if (leftAllCurled && !this._wasCurled) {
        localFilePlayer.pause();
      }
      this._wasExtended = leftAllExtended;
      this._wasCurled = leftAllCurled;
    }

    if (this._locked) return;

    if (leftLandmarks) {
      // A hand held at VOLUME_NEUTRAL_Y (a natural resting height, not
      // literal screen-center) reads 50%; higher = louder, lower = quieter.
      this._leftSmoothY = smooth(this._leftSmoothY, handPosition(leftLandmarks).y);
      const volume = Math.min(
        1,
        Math.max(0, 0.5 + ((VOLUME_NEUTRAL_Y - this._leftSmoothY) / VOLUME_RANGE_Y) * 0.5)
      );
      this.volume.gain.linearRampToValueAtTime(volume, Tone.now() + 0.05);
      this.state.volume = volume;
    }

    if (rightLandmarks && rightAllCurled) {
      // Clenched: drag controls speed instead of the open-hand effects
      // below. Anchor from wherever the fist closed, like grabbing a
      // record where it currently sits rather than snapping to a fixed
      // reference point.
      const currentY = handPosition(rightLandmarks).y;
      if (!this._rightWasFist) {
        this._speedDragAnchorY = currentY;
      }
      const dragDelta = this._speedDragAnchorY - currentY; // positive = dragged up
      const speed = Math.min(
        MAX_SPEED,
        Math.max(MIN_SPEED, 1 + dragDelta * SPEED_SENSITIVITY)
      );
      localFilePlayer.setSpeed(speed);
      this.state.speed = speed;
      this._rightWasFist = true;
    } else if (rightLandmarks) {
      this._rightWasFist = false;

      this._rightSmoothTilt = smooth(this._rightSmoothTilt, handTilt(rightLandmarks));
      const tiltDeg = (this._rightSmoothTilt * 180) / Math.PI;
      const autotuneAmount = Math.min(1, Math.max(0, tiltDeg / 45));
      this.autotune.setAmount(autotuneAmount);
      this.state.autotuneAmount = autotuneAmount;

      // y=0.5 (vertical center) -> reverb=0 (untouched); moving away
      // from center in either direction brings it in. Unlike x, y isn't
      // affected by the display's horizontal mirroring, so there's no
      // sign to flip here.
      this._rightSmoothY = smooth(this._rightSmoothY, handPosition(rightLandmarks).y);
      let reverbAmount = Math.min(1, Math.max(0, Math.abs(this._rightSmoothY - 0.5) * 2));

      const avgNonThumbCurl =
        NON_THUMB_FINGERS.reduce((sum, f) => sum + fingerCurl(rightLandmarks, f), 0) /
        NON_THUMB_FINGERS.length;
      if (avgNonThumbCurl > DELAY_GATE_CLOSE_AVG) this._delayGateOpen = false;
      else if (avgNonThumbCurl < DELAY_GATE_OPEN_AVG) this._delayGateOpen = true;

      let delayAmount = this.state.delayAmount;
      if (this._delayGateOpen) {
        const pinch = pinchDistance(rightLandmarks, 8);
        delayAmount = Math.min(1, Math.max(0, 1 - pinch));
      }

      const combined = reverbAmount + delayAmount;
      if (combined > COMBINED_SPACE_MAX) {
        const scale = COMBINED_SPACE_MAX / combined;
        reverbAmount *= scale;
        delayAmount *= scale;
      }

      this.reverb.setAmount(reverbAmount);
      this.state.reverbAmount = reverbAmount;
      this.delay.setAmount(delayAmount);
      this.state.delayAmount = delayAmount;
    }
  }

  dispose() {
    this.autotune.dispose();
    this.nostalgia.dispose();
    this.reverb.dispose();
    this.delay.dispose();
    this.volume.dispose();
    this.limiter.dispose();
  }
}
