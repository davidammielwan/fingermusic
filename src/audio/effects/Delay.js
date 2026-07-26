import * as Tone from 'tone';

// Capped below fully wet, with gentle feedback, so pinching all the way
// closed produces an echo rather than a runaway self-reinforcing wash.
const MAX_AMOUNT = 0.5;

export class Delay {
  constructor() {
    this.node = new Tone.FeedbackDelay({ delayTime: 0.28, feedback: 0.25 });
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
