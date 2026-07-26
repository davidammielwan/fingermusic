import * as Tone from 'tone';
import { PitchDetector } from 'pitchy';

const FFT_SIZE = 2048;
const CLARITY_THRESHOLD = 0.9;

// Raw pitch detection jitters frame-to-frame even on a musically "stable"
// note, especially over complex/polyphonic audio. Feeding that jitter
// straight into a granular pitch shifter's target every ~16ms is what
// actually produces harsh, warbly distortion — not the shifting itself.
// Smoothing the correction amount (rather than snapping to it instantly)
// fixes that at the root.
const CORRECTION_SMOOTHING_ALPHA = 0.12;
// The granular pitch-shifter's own artifacts (not the sign-flip click
// fixed above) become the dominant thing you hear as its share of the
// dry/wet blend grows — past roughly half wet, those artifacts stop
// being masked by the clean dry signal and the mix reads as "extremely
// distorted." Capping the actual blend at 0.5 guarantees at least half
// clean signal always comes through, no matter how far the gesture
// pushes — the meter/slider still reads up to 100% so the gesture range
// stays full, but the real effect underneath is silently held at half.
const MAX_AMOUNT = 0.5;

// Tone.PitchShift's own `set pitch()` swaps its internal LFOs' min/max
// the instant the value crosses zero (positive vs negative interval are
// two different branches internally) — a real discontinuity in the
// modulation, audible as a click. Sung pitch naturally dithers back and
// forth across "dead on pitch" (correction ≈ 0), so without a dead zone
// this fires constantly during exactly the passages needing the least
// correction, which is what read as "distorted in some areas" rather
// than evenly. PITCH_SIGN_DEADZONE holds the previously-committed sign
// until the correction has moved convincingly past zero the other way.
const PITCH_SIGN_DEADZONE = 0.15;
const PITCH_SIGN_EPSILON = 0.001;

// C major pentatonic pitch classes (relative to C), matching the scale
// already used for Piano mode elsewhere in this project.
const SCALE_PITCH_CLASSES = [0, 2, 4, 7, 9];

function frequencyToMidi(freq) {
  return 69 + 12 * Math.log2(freq / 440);
}

function nearestScaleMidi(midi) {
  const rounded = Math.round(midi);
  const pitchClass = ((rounded % 12) + 12) % 12;
  const octaveBase = rounded - pitchClass;
  let best = rounded;
  let bestDist = Infinity;
  for (const pc of SCALE_PITCH_CLASSES) {
    for (const octaveShift of [-12, 0, 12]) {
      const candidate = octaveBase + pc + octaveShift;
      const dist = Math.abs(candidate - midi);
      if (dist < bestDist) {
        bestDist = dist;
        best = candidate;
      }
    }
  }
  return best;
}

// Real pitch-correction: detects the input's current pitch frame-by-frame
// (McLeod Pitch Method via `pitchy`) and pitch-shifts it toward the nearest
// note in SCALE_PITCH_CLASSES, blended dry/wet by `amount`. This is the
// only pitch-shifting node in the chain — an earlier manual pitch control
// was removed because stacking two granular pitch-shifters in series
// produced harsh artifacts.
export class Autotune {
  constructor() {
    this.input = new Tone.Gain();
    this.output = new Tone.Gain();

    this.analyser = new Tone.Analyser('waveform', FFT_SIZE);
    this.input.connect(this.analyser);

    this.correction = new Tone.PitchShift({ windowSize: 0.1 });
    this.input.connect(this.correction);

    this.dryGain = new Tone.Gain(1);
    this.wetGain = new Tone.Gain(0);
    this.input.connect(this.dryGain);
    this.correction.connect(this.wetGain);
    this.dryGain.connect(this.output);
    this.wetGain.connect(this.output);

    this.detector = PitchDetector.forFloat32Array(FFT_SIZE);
    this.detector.minVolumeDecibels = -45;

    this._smoothedCorrection = 0;
    this._pitchSign = 1;
    this._running = true;
    this._analyzeLoop = this._analyzeLoop.bind(this);
    this._analyzeLoop();
  }

  _analyzeLoop() {
    if (!this._running) return;
    const buffer = this.analyser.getValue();
    const sampleRate = Tone.getContext().sampleRate;
    const [pitch, clarity] = this.detector.findPitch(buffer, sampleRate);
    if (clarity > CLARITY_THRESHOLD && pitch > 0) {
      const midi = frequencyToMidi(pitch);
      const targetMidi = nearestScaleMidi(midi);
      const targetCorrection = targetMidi - midi;
      this._smoothedCorrection +=
        CORRECTION_SMOOTHING_ALPHA * (targetCorrection - this._smoothedCorrection);

      if (this._smoothedCorrection > PITCH_SIGN_DEADZONE) this._pitchSign = 1;
      else if (this._smoothedCorrection < -PITCH_SIGN_DEADZONE) this._pitchSign = -1;

      // Inside the dead zone, hold the committed sign (as a tiny epsilon
      // rather than exactly 0, so the value still lands on the same side
      // of PitchShift's internal branch) instead of reporting whatever
      // raw sign the smoothed value happens to have.
      let applied = this._smoothedCorrection;
      if (this._pitchSign > 0 && applied <= 0) applied = PITCH_SIGN_EPSILON;
      if (this._pitchSign < 0 && applied >= 0) applied = -PITCH_SIGN_EPSILON;
      this.correction.pitch = applied;
    }
    requestAnimationFrame(this._analyzeLoop);
  }

  setAmount(ratio) {
    const amount = Math.min(MAX_AMOUNT, Math.max(0, ratio));
    const now = Tone.now();
    this.dryGain.gain.linearRampToValueAtTime(1 - amount, now + 0.05);
    this.wetGain.gain.linearRampToValueAtTime(amount, now + 0.05);
  }

  getAmount() {
    return this.wetGain.gain.value;
  }

  dispose() {
    this._running = false;
    this.input.dispose();
    this.output.dispose();
    this.analyser.dispose();
    this.correction.dispose();
    this.dryGain.dispose();
    this.wetGain.dispose();
  }
}
