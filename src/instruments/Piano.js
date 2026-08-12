import * as Tone from 'tone';
import { Instrument } from './Instrument.js';

// Real piano recordings (Salamander Grand Piano, self-hosted in
// public/audio/piano — see README for attribution/license), spaced every
// major third per octave. Tone.Sampler auto-repitches to fill the gaps,
// which is inaudible at these small intervals. The range covers a full
// octave of glide plus tilt-bend headroom in either direction from any of
// the 8 playable notes (C4-C5), so the live pitch bend below never has to
// stretch far from a real sample.
const PIANO_SAMPLE_BASE_URL = '/audio/piano/';
const PIANO_SAMPLE_URLS = {
  A2: 'A2.mp3',
  C3: 'C3.mp3',
  'D#3': 'Ds3.mp3',
  'F#3': 'Fs3.mp3',
  A3: 'A3.mp3',
  C4: 'C4.mp3',
  'D#4': 'Ds4.mp3',
  'F#4': 'Fs4.mp3',
  A4: 'A4.mp3',
  C5: 'C5.mp3',
  'D#5': 'Ds5.mp3',
  'F#5': 'Fs5.mp3',
  A5: 'A5.mp3',
  C6: 'C6.mp3',
};

// A real damper falls in well under a second — a full 1s tail reads more
// like a synth pad fading out than a struck string being damped. Short
// enough to sound like a key actually being released, long enough to
// avoid Sampler's fast 0.1s default hard-cutting the tail audibly.
const RELEASE_SECONDS = 0.35;

// A tiny fade-in on the attack softens the hammer-strike transient —
// this bright, close-mic'd concert-grand recording hits harder and
// clearer than the warm, faded character a "nostalgic" mellow piano
// tone calls for. Short enough that it still reads as a key being
// struck, not a pad swelling in.
const ATTACK_SECONDS = 0.03;

// Warms up the recording's own brightness — a close-mic'd concert
// grand has more top-end sparkle than the duller, more muffled
// character a nostalgic/lo-fi piano tone calls for. Placed before the
// reverb so the room tail itself inherits the same darker color
// instead of staying bright underneath a dark direct signal.
const DARKEN_FILTER_HZ = 3200;

// PitchShift's delay-line algorithm is inherently lossy (it's documented
// as "near-realtime", not transparent) — even parked at 0 semitones it
// still routes audio through dual crossfaded delay lines, which colors
// and thins the tone. Keeping it dry by default and fading it in only as
// a bend is applied was the intent — but a hand is essentially never
// perfectly still at dead-center: normal tracking drift alone is enough
// to cross a small threshold, which meant the "dry by default" case
// barely happened in practice and most notes were quietly getting
// processed anyway. Raised well above typical resting jitter so it only
// engages for a deliberate, noticeable bend (a couple semitones or more).
const DETUNE_WET_RAMP_CENTS = 150;
const WET_RAMP_TIME = 0.05;

// Salamander's samples are dry/close-mic'd, so room decay helps it read
// as a real instrument in a real space rather than a bare sample.
// Pushed further than the previous tight/subtle setting for a washed-
// out, faded-back "nostalgic cover" character — still short of where
// Tone.Reverb's synthesized (decaying-noise) IR starts leaning
// metallic, since it's not a real hall impulse. One shared reverb per
// Piano instance (not per voice) models a single physical space both
// hands play into.
const REVERB_DECAY_SECONDS = 1.8;
const REVERB_WET = 0.2;

// Tone.Sampler has no detune param, so the live octave-glide/tilt-bend
// (see fingers.js) can't ride on the sampler itself like it did on
// Tone.Synth. Each voice instead runs through its own PitchShift node,
// driven by the same 'detune' cents value converted to semitones.
export class Piano extends Instrument {
  constructor() {
    super();
    this.voices = new Map();
    this.reverb = new Tone.Reverb({
      decay: REVERB_DECAY_SECONDS,
      wet: REVERB_WET,
    }).toDestination();
  }

  _voiceFor(voiceId) {
    if (!this.voices.has(voiceId)) {
      const filter = new Tone.Filter({ type: 'lowpass', frequency: DARKEN_FILTER_HZ }).connect(
        this.reverb
      );
      const pitchShift = new Tone.PitchShift({ wet: 0 }).connect(filter);
      const sampler = new Tone.Sampler({
        urls: PIANO_SAMPLE_URLS,
        baseUrl: PIANO_SAMPLE_BASE_URL,
        attack: ATTACK_SECONDS,
        release: RELEASE_SECONDS,
      }).connect(pitchShift);
      this.voices.set(voiceId, { sampler, pitchShift, filter });
    }
    return this.voices.get(voiceId);
  }

  noteOn(note, velocity = 1, voiceId = 'default') {
    const { sampler } = this._voiceFor(voiceId);
    // Guards the brief window right after switching into Piano mode
    // where samples are still fetching — without this, triggering a note
    // before any buffer has arrived throws and stalls the render loop.
    if (!sampler.loaded) return;
    sampler.triggerAttack(note, Tone.now(), velocity);
  }

  noteOff(note, voiceId = 'default') {
    this._voiceFor(voiceId).sampler.triggerRelease(note, Tone.now());
  }

  setParam(name, value, voiceId = 'default') {
    if (name === 'detune') {
      const { pitchShift } = this._voiceFor(voiceId);
      pitchShift.pitch = value / 100;
      const wetTarget = Math.min(1, Math.abs(value) / DETUNE_WET_RAMP_CENTS);
      pitchShift.wet.rampTo(wetTarget, WET_RAMP_TIME);
      return;
    }
    this._voiceFor(voiceId).sampler.set({ [name]: value });
  }

  dispose() {
    for (const { sampler, pitchShift, filter } of this.voices.values()) {
      sampler.dispose();
      pitchShift.dispose();
      filter.dispose();
    }
    this.voices.clear();
    this.reverb.dispose();
  }
}
