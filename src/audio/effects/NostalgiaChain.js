import * as Tone from 'tone';

function dbToGain(db) {
  return 10 ** (db / 20);
}

// Always-on "old cassette/vinyl" coloration — the baseline character
// every gesture control modulates on top of. Deliberately conservative:
//
// - HPF at 80Hz only removes sub-bass rumble below where music actually
//   lives — standard mastering practice, inaudible on its own.
// - LPF at 9000Hz trims only the extreme top-end "air"/sizzle. The
//   earlier version cut at 4000Hz, which is telephone-quality bandwidth
//   and guarantees a muffled result on every sound, at 100% strength,
//   regardless of any gesture — that was the main source of "muffled."
// - No saturation: a "gentle" tanh soft-clip still measurably colors
//   ordinary program material (not just peaks) at any drive worth
//   having, which was a real, confirmed source of "distorted." Cut
//   entirely rather than tuned further.
// - A quiet noise floor mixed in parallel so it doesn't get filtered
//   along with the music.
export class NostalgiaChain {
  constructor() {
    this.input = new Tone.Gain();

    this.highpass = new Tone.Filter({ type: 'highpass', frequency: 80, rolloff: -12 });
    this.lowpass = new Tone.Filter({ type: 'lowpass', frequency: 9000, rolloff: -12 });

    this.input.chain(this.highpass, this.lowpass);

    this.noise = new Tone.Noise('pink');
    this.noiseGain = new Tone.Gain(dbToGain(-40));
    this.noise.connect(this.noiseGain);
    this.noise.start();

    this.output = new Tone.Gain();
    this.lowpass.connect(this.output);
    this.noiseGain.connect(this.output);
  }

  dispose() {
    this.input.dispose();
    this.highpass.dispose();
    this.lowpass.dispose();
    this.noise.dispose();
    this.noiseGain.dispose();
    this.output.dispose();
  }
}
