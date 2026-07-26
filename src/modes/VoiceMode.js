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

const NON_THUMB_FINGERS = ['index', 'middle', 'ring', 'pinky'];
// See SongPlayerMode.js for why this is an average across all 4 fingers
// (robust to which finger leads a fist-forming motion) rather than a
// per-finger check.
const DELAY_GATE_OPEN_AVG = 0.15;
const DELAY_GATE_CLOSE_AVG = 0.3;
const COMBINED_SPACE_MAX = 0.75;
const VOLUME_NEUTRAL_Y = 0.65;
const VOLUME_RANGE_Y = 0.5;

// Same right/left gesture roles as Song Player's continuous effect
// controls (right hand: tilt = autotune, y = reverb, pinch = delay;
// left hand: height = volume) — reused as-is so muscle memory carries
// over. No fist-drag speed or both-fists lock here: those are Song
// Player transport concepts (playback rate, pausing) that don't apply
// to a live mic feed.
export class VoiceMode {
  constructor() {
    this.autotune = new Autotune();
    this.nostalgia = new NostalgiaChain();
    this.delay = new Delay();
    this.reverb = new Reverb();
    this.volume = new Tone.Gain(0.5);
    this.limiter = new Tone.Limiter(-1);
    this.recorder = new Tone.Recorder();

    this.autotune.output.connect(this.nostalgia.input);
    this.nostalgia.output.connect(this.delay.node);
    this.delay.node.connect(this.reverb.node);
    this.reverb.node.connect(this.volume);
    this.volume.connect(this.limiter);
    // Tapped to the recorder only, not to the speakers — monitoring your
    // own mic live through speakers (rather than headphones) would howl
    // into feedback. You hear the take on playback instead, once it's
    // been captured.
    this.limiter.connect(this.recorder);

    this.mic = new Tone.UserMedia();
    this.mic.connect(this.autotune.input);

    this.player = null;
    this._isRecording = false;

    this._rightSmoothTilt = undefined;
    this._rightSmoothY = undefined;
    this._leftSmoothY = undefined;
    this._delayGateOpen = true;

    this.state = {
      leftPresent: false,
      rightPresent: false,
      volume: 0.5,
      autotuneAmount: 0,
      reverbAmount: 0,
      delayAmount: 0,
      recording: false,
      hasRecording: false,
      playing: false,
    };
  }

  // Pass this to whatever feeds the effects chain — here, the mic itself
  // is wired to it directly in the constructor, so this exists only for
  // symmetry with the other modes' entry point.
  getEntryNode() {
    return this.autotune.input;
  }

  async startRecording() {
    if (this._isRecording) return;
    await Tone.start();
    await this.mic.open();
    await this.recorder.start();
    this._isRecording = true;
    this.state.recording = true;
  }

  async stopRecording() {
    if (!this._isRecording) return null;
    const blob = await this.recorder.stop();
    this.mic.close();
    this._isRecording = false;
    this.state.recording = false;
    this.state.hasRecording = true;

    if (this.player) this.player.dispose();
    const url = URL.createObjectURL(blob);
    this.player = new Tone.Player(url).toDestination();
    return blob;
  }

  get isRecording() {
    return this._isRecording;
  }

  play() {
    if (!this.player || !this.player.loaded || this.player.state === 'started') return;
    this.player.start();
    this.state.playing = true;
  }

  stopPlayback() {
    if (this.player && this.player.state === 'started') this.player.stop();
    this.state.playing = false;
  }

  get isPlaying() {
    return !!this.player && this.player.state === 'started';
  }

  updateInteraction(handsLandmarks, handedness) {
    let leftLandmarks = null;
    let rightLandmarks = null;
    handsLandmarks.forEach((landmarks, i) => {
      const category = handedness[i]?.[0]?.categoryName;
      if (category === 'Left') leftLandmarks = landmarks;
      else if (category === 'Right') rightLandmarks = landmarks;
    });

    this.state.leftPresent = !!leftLandmarks;
    this.state.rightPresent = !!rightLandmarks;

    if (leftLandmarks) {
      this._leftSmoothY = smooth(this._leftSmoothY, handPosition(leftLandmarks).y);
      const volume = Math.min(
        1,
        Math.max(0, 0.5 + ((VOLUME_NEUTRAL_Y - this._leftSmoothY) / VOLUME_RANGE_Y) * 0.5)
      );
      this.volume.gain.linearRampToValueAtTime(volume, Tone.now() + 0.05);
      this.state.volume = volume;
    }

    if (!rightLandmarks) return;

    this._rightSmoothTilt = smooth(this._rightSmoothTilt, handTilt(rightLandmarks));
    const tiltDeg = (this._rightSmoothTilt * 180) / Math.PI;
    const autotuneAmount = Math.min(1, Math.max(0, tiltDeg / 45));
    this.autotune.setAmount(autotuneAmount);
    this.state.autotuneAmount = autotuneAmount;

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

  dispose() {
    if (this._isRecording) this.mic.close();
    this.mic.dispose();
    this.autotune.dispose();
    this.nostalgia.dispose();
    this.reverb.dispose();
    this.delay.dispose();
    this.volume.dispose();
    this.limiter.dispose();
    this.recorder.dispose();
    if (this.player) this.player.dispose();
  }
}
