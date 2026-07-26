import * as Tone from 'tone';

// Freeverb over the convolution-based Tone.Reverb: no async impulse-response
// generation to wait on, so it's usable the instant it's constructed.
// dampening=3500 gives a noticeably darker, more diffuse tail than a
// bright hi-fi reverb (a dampening this low is standard for "distant"
// character) without going so dark it reads as muffled the way an
// earlier, more extreme setting did. Capped below fully wet so it can
// never wash the signal into mush on its own — see SongPlayerMode for
// the additional shared budget with delay.
const MAX_AMOUNT = 0.6;

export class Reverb {
  constructor() {
    this.node = new Tone.Freeverb({ roomSize: 0.8, dampening: 3500 });
    this.node.wet.value = 0;
  }

  setAmount(ratio) {
    this.node.wet.value = Math.min(MAX_AMOUNT, Math.max(0, ratio));
  }

  getAmount() {
    return this.node.wet.value;
  }

  dispose() {
    this.node.dispose();
  }
}
