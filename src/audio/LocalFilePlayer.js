import * as Tone from 'tone';

const MIN_SPEED = 0.5;
const MAX_SPEED = 2.0;

export class LocalFilePlayer {
  constructor() {
    this.player = new Tone.Player().toDestination();
    // Buffer position is tracked as an anchor (position + the real time
    // it was set) rather than a single "startedAt" timestamp, because
    // speed can change mid-playback — a plain `now - startedAt` elapsed
    // calculation only matches buffer position at a constant rate. Every
    // rate change re-anchors from the current position, so position
    // stays accurate across any number of speed changes.
    this._positionAnchor = 0;
    this._anchorTime = 0;
    this._rate = 1;
    this.pausedAt = 0;
    // Tracks whether the last position read saw the player still going,
    // so a track finishing on its own (no explicit pause() call) can be
    // told apart from a fresh, never-played state — see getCurrentPosition.
    this._wasPlaying = false;
  }

  async load(file) {
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await Tone.getContext().rawContext.decodeAudioData(arrayBuffer);
    this.player.buffer = audioBuffer;
    this.pausedAt = 0;
    return audioBuffer;
  }

  // Derived from Tone's own playback state (rather than a separately
  // tracked flag) so it self-corrects the instant a track finishes
  // naturally — otherwise play() would wrongly no-op forever afterward.
  get isPlaying() {
    return this.player.state === 'started';
  }

  play() {
    if (!this.player.loaded || this.isPlaying) return;
    if (this.pausedAt >= this.getDuration()) this.pausedAt = 0;
    this.player.start(Tone.now(), this.pausedAt);
    this._positionAnchor = this.pausedAt;
    this._anchorTime = Tone.now();
  }

  pause() {
    if (!this.isPlaying) return;
    this.pausedAt = this.getCurrentPosition();
    this.player.stop();
    // pausedAt is already correct — mark this as a handled stop so the
    // natural-end detection in getCurrentPosition doesn't also fire and
    // overwrite it with the duration.
    this._wasPlaying = false;
  }

  seek(positionRatio) {
    const wasPlaying = this.isPlaying;
    if (wasPlaying) this.player.stop();
    this.pausedAt = positionRatio * this.getDuration();
    this._positionAnchor = this.pausedAt;
    this._anchorTime = Tone.now();
    if (wasPlaying) this.player.start(Tone.now(), this.pausedAt);
  }

  // Changes speed and pitch together (like a tape or turntable speeding
  // up/slowing down), not decoupled — this is a native resample-rate
  // change rather than granular processing, so unlike a pitch shifter it
  // adds no grain artifacts of its own.
  setSpeed(rate) {
    const clamped = Math.min(MAX_SPEED, Math.max(MIN_SPEED, rate));
    if (this.isPlaying) {
      this._positionAnchor = this.getCurrentPosition();
      this._anchorTime = Tone.now();
    }
    this._rate = clamped;
    this.player.playbackRate = clamped;
  }

  getSpeed() {
    return this._rate;
  }

  getDuration() {
    return this.player.loaded ? this.player.buffer.duration : 0;
  }

  getCurrentPosition() {
    if (!this.player.loaded) return 0;
    if (this.isPlaying) {
      this._wasPlaying = true;
      const position = this._positionAnchor + (Tone.now() - this._anchorTime) * this._rate;
      return Math.min(Math.max(position, 0), this.getDuration());
    }
    // Just stopped since the last time this was read. If that wasn't
    // through an explicit pause() (which already set pausedAt itself),
    // the track ran to its natural end — report the true end position
    // instead of leaving pausedAt stale at wherever it last was (0 for
    // a track that's never been explicitly paused).
    if (this._wasPlaying) {
      this._wasPlaying = false;
      this.pausedAt = this.getDuration();
    }
    return Math.min(Math.max(this.pausedAt, 0), this.getDuration());
  }

  connectEffectsChain(chain) {
    this.player.disconnect();
    this.player.connect(chain);
  }

  dispose() {
    this.player.dispose();
  }
}
