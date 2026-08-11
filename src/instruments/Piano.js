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

// A natural decay tail on release, rather than Sampler's fast 0.1s
// default fade, which cuts samples off abruptly.
const RELEASE_SECONDS = 1;

// PitchShift's delay-line algorithm is inherently lossy (it's documented
// as "near-realtime", not transparent) — even parked at 0 semitones it
// still routes audio through dual crossfaded delay lines, which colors
// and thins the tone. Keeping it fully dry (wet 0) by default and only
// fading it in as an actual bend is applied means a still, level hand
// plays the untouched sample, and only deliberate gesture bending pays
// the DSP-artifact cost. Ramps to fully wet within half a semitone of
// deviation, since any deliberate bend should engage it almost at once.
const DETUNE_WET_RAMP_CENTS = 50;
const WET_RAMP_TIME = 0.05;

// Salamander's samples are dry/close-mic'd; a touch of room decay is what
// actually reads as "concert grand" rather than "piano sample". Kept
// subtle — this is a room, not a cathedral. One shared reverb per Piano
// instance (not per voice) models a single physical space both hands
// play into.
const REVERB_DECAY_SECONDS = 1.6;
const REVERB_WET = 0.18;

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
      const pitchShift = new Tone.PitchShift({ wet: 0 }).connect(this.reverb);
      const sampler = new Tone.Sampler({
        urls: PIANO_SAMPLE_URLS,
        baseUrl: PIANO_SAMPLE_BASE_URL,
        release: RELEASE_SECONDS,
      }).connect(pitchShift);
      this.voices.set(voiceId, { sampler, pitchShift });
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
    for (const { sampler, pitchShift } of this.voices.values()) {
      sampler.dispose();
      pitchShift.dispose();
    }
    this.voices.clear();
    this.reverb.dispose();
  }
}
