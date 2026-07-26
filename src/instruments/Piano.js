import * as Tone from 'tone';
import { Instrument } from './Instrument.js';

// Params like detune apply per-PolySynth, so each voiceId (e.g. one per
// tracked hand) gets its own synth — otherwise one hand's pitch bend
// would overwrite another's, and only whichever hand set it last would
// ever audibly take effect.
export class Piano extends Instrument {
  constructor() {
    super();
    this.synths = new Map();
  }

  _synthFor(voiceId) {
    if (!this.synths.has(voiceId)) {
      this.synths.set(voiceId, new Tone.PolySynth(Tone.Synth).toDestination());
    }
    return this.synths.get(voiceId);
  }

  noteOn(note, velocity = 1, voiceId = 'default') {
    this._synthFor(voiceId).triggerAttack(note, Tone.now(), velocity);
  }

  noteOff(note, voiceId = 'default') {
    this._synthFor(voiceId).triggerRelease(note, Tone.now());
  }

  setParam(name, value, voiceId = 'default') {
    this._synthFor(voiceId).set({ [name]: value });
  }

  dispose() {
    for (const synth of this.synths.values()) {
      synth.dispose();
    }
    this.synths.clear();
  }
}
