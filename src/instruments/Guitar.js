import * as Tone from 'tone';
import { Instrument } from './Instrument.js';

// PluckSynth (Karplus-Strong string synthesis) isn't compatible with
// Tone.PolySynth's voice-allocation model (it doesn't extend Monophonic),
// so each string gets its own dedicated synth instead of sharing a pool.
export class Guitar extends Instrument {
  constructor() {
    super();
    this.synths = new Map();
  }

  _synthFor(note) {
    if (!this.synths.has(note)) {
      this.synths.set(note, new Tone.PluckSynth().toDestination());
    }
    return this.synths.get(note);
  }

  noteOn(note) {
    this._synthFor(note).triggerAttack(note, Tone.now());
  }

  noteOff(note) {
    this._synthFor(note).triggerRelease(Tone.now());
  }

  setParam(name, value) {
    for (const synth of this.synths.values()) {
      synth.set({ [name]: value });
    }
  }

  dispose() {
    for (const synth of this.synths.values()) {
      synth.dispose();
    }
    this.synths.clear();
  }
}
