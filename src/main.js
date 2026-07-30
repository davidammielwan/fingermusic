import * as Tone from 'tone';
import './style.css';
import { setupCamera } from './camera.js';
import { createHandLandmarker, detectForVideo, HandLandmarker } from './handpose/detector.js';
import { smoothLandmarks } from './handpose/landmarkSmoother.js';
import { handPosition } from './handpose/geometry.js';
import {
  FINGER_TIPS,
  FINGER_NOTES_BY_HAND,
  GUITAR_STRING_NOTES,
  octaveShiftFromHeight,
  shiftNoteOctave,
} from './handpose/fingers.js';
import {
  updateInteraction,
  updateGuitarInteraction,
  releaseAllPianoNotes,
  getActivePianoNotes,
  getActiveGuitarNotes,
} from './handpose/interaction.js';
import { Piano } from './instruments/Piano.js';
import { Guitar } from './instruments/Guitar.js';
import { LocalFilePlayer } from './audio/LocalFilePlayer.js';
import { SongPlayerMode } from './modes/SongPlayerMode.js';
import { VoiceMode } from './modes/VoiceMode.js';

const FINGER_COLORS = {
  index: '#ffeb3b',
  middle: '#4caf50',
  ring: '#2196f3',
  pinky: '#e91e63',
};

// Matches the range in SongPlayerMode's speed drag, just for display.
const MIN_SPEED_DISPLAY = 0.5;
const MAX_SPEED_DISPLAY = 2.0;

document.querySelector('#app').innerHTML = `
  <div class="stage">
    <video id="camera-feed" autoplay playsinline muted></video>
    <canvas id="overlay"></canvas>
    <p id="status" class="status"></p>

    <div class="hud-top-left">
      <div class="switcher">
        <button id="mode-piano" class="active">Piano</button>
        <button id="mode-guitar">Guitar</button>
        <button id="mode-songplayer">Song Player</button>
        <button id="mode-voice">Voice</button>
      </div>
    </div>

    <div class="hud-top-right" id="settings-hud" hidden>
      <div class="hand-presence">
        <span>L <span id="left-present" class="presence">○</span></span>
        <span>R <span id="right-present" class="presence">○</span></span>
      </div>
      <div class="hud-meter">
        <span class="hud-meter-label">Volume</span>
        <div class="hud-bar"><div class="hud-fill" id="fill-volume"></div></div>
        <span class="hud-meter-value" id="meter-volume">—</span>
      </div>
      <div class="hud-meter" id="speed-meter-row">
        <span class="hud-meter-label">Speed</span>
        <div class="hud-bar"><div class="hud-fill" id="fill-speed"></div></div>
        <span class="hud-meter-value" id="meter-speed">—</span>
      </div>
      <div class="hud-meter">
        <span class="hud-meter-label">Autotune</span>
        <div class="hud-bar"><div class="hud-fill" id="fill-autotune"></div></div>
        <span class="hud-meter-value" id="meter-autotune">—</span>
      </div>
      <div class="hud-meter">
        <span class="hud-meter-label">Reverb</span>
        <div class="hud-bar"><div class="hud-fill" id="fill-reverb"></div></div>
        <span class="hud-meter-value" id="meter-reverb">—</span>
      </div>
      <div class="hud-meter">
        <span class="hud-meter-label">Delay</span>
        <div class="hud-bar"><div class="hud-fill" id="fill-delay"></div></div>
        <span class="hud-meter-value" id="meter-delay">—</span>
      </div>
      <p id="lock-indicator" class="lock-indicator"></p>
    </div>

    <div class="hud-bottom">
      <div id="note-tags" class="note-tags"></div>

      <div id="song-player-panel" class="song-player-hud" hidden>
        <span id="song-player-status" class="song-player-status"></span>
        <div class="song-player-controls">
          <div class="add-song">
            <button id="add-song-button" class="add-song-button" type="button">+</button>
            <div id="add-song-popover" class="add-song-popover" hidden>
              <label for="file-picker">Audio file from your computer</label>
              <input type="file" id="file-picker" accept="audio/*" />
              <div class="add-song-divider">or</div>
              <label for="url-input">Direct link to an audio file</label>
              <input type="text" id="url-input" placeholder="https://.../song.mp3" />
              <button id="url-load-button" type="button">Load link</button>
            </div>
          </div>
          <div class="transport">
            <button id="play-pause" disabled>Play</button>
            <input type="range" id="seek-bar" min="0" max="1" step="0.001" value="0" disabled />
            <span id="time-display">0:00 / 0:00</span>
          </div>
        </div>
      </div>

      <div id="voice-panel" class="song-player-hud" hidden>
        <span id="voice-status" class="song-player-status"></span>
        <div class="song-player-controls">
          <div class="transport">
            <button id="voice-record" type="button">Record</button>
            <button id="voice-play" type="button" disabled>Play</button>
          </div>
        </div>
      </div>

      <canvas id="waveform" class="waveform" width="1600" height="120"></canvas>
    </div>
  </div>
`;

const video = document.querySelector('#camera-feed');
const canvas = document.querySelector('#overlay');
const ctx = canvas.getContext('2d');
const status = document.querySelector('#status');
const waveformCanvas = document.querySelector('#waveform');
const waveformCtx = waveformCanvas.getContext('2d');
const noteTagsEl = document.querySelector('#note-tags');
const modePianoButton = document.querySelector('#mode-piano');
const modeGuitarButton = document.querySelector('#mode-guitar');
const modeSongPlayerButton = document.querySelector('#mode-songplayer');
const modeVoiceButton = document.querySelector('#mode-voice');
const songPlayerPanel = document.querySelector('#song-player-panel');
const voicePanel = document.querySelector('#voice-panel');
const voiceStatus = document.querySelector('#voice-status');
const voiceRecordButton = document.querySelector('#voice-record');
const voicePlayButton = document.querySelector('#voice-play');
const settingsHud = document.querySelector('#settings-hud');
const speedMeterRow = document.querySelector('#speed-meter-row');
const addSongButton = document.querySelector('#add-song-button');
const addSongPopover = document.querySelector('#add-song-popover');
const filePicker = document.querySelector('#file-picker');
const urlInput = document.querySelector('#url-input');
const urlLoadButton = document.querySelector('#url-load-button');
const playPauseButton = document.querySelector('#play-pause');
const seekBar = document.querySelector('#seek-bar');
const timeDisplay = document.querySelector('#time-display');
const songPlayerStatus = document.querySelector('#song-player-status');
const leftPresentEl = document.querySelector('#left-present');
const rightPresentEl = document.querySelector('#right-present');
const meterVolume = document.querySelector('#meter-volume');
const meterSpeed = document.querySelector('#meter-speed');
const meterAutotune = document.querySelector('#meter-autotune');
const meterReverb = document.querySelector('#meter-reverb');
const meterDelay = document.querySelector('#meter-delay');
const fillVolume = document.querySelector('#fill-volume');
const fillSpeed = document.querySelector('#fill-speed');
const fillAutotune = document.querySelector('#fill-autotune');
const fillReverb = document.querySelector('#fill-reverb');
const fillDelay = document.querySelector('#fill-delay');
const lockIndicator = document.querySelector('#lock-indicator');

// Taps the master output (post-everything, for any mode) for the live
// waveform display — this doesn't affect what's actually audible, it
// just observes a copy of the signal.
const WAVEFORM_SAMPLE_SIZE = 1024;
const waveform = new Tone.Waveform(WAVEFORM_SAMPLE_SIZE);
Tone.getDestination().connect(waveform);

// Raw per-sample values are too jittery for a clean visual — bucket them
// into bars (RMS energy per bucket, like a real audio meter) and ease
// each bar toward its new value over time instead of snapping, so the
// display reads as a smooth energy contour rather than noise.
const WAVEFORM_BARS = 48;
const WAVEFORM_SMOOTHING = 0.15;
const waveformDisplayValues = new Array(WAVEFORM_BARS).fill(0);

// Web Audio requires a real user gesture to unlock; any click anywhere
// covers hand-gesture play regardless of which mode is active.
document.body.addEventListener('pointerdown', () => Tone.start(), { once: true });

let activeMode = 'piano';
let activeInstrument = new Piano();

function switchMode(mode) {
  if (mode === activeMode) return;

  if (activeMode === 'piano') releaseAllPianoNotes(activeInstrument);
  if (activeMode === 'piano' || activeMode === 'guitar') activeInstrument.dispose();
  if (mode === 'piano') activeInstrument = new Piano();
  else if (mode === 'guitar') activeInstrument = new Guitar();

  // Leaving Voice mode mid-recording would otherwise leave the mic open
  // and recording silently in the background.
  if (activeMode === 'voice' && voiceMode.isRecording) voiceMode.stopRecording();

  activeMode = mode;
  modePianoButton.classList.toggle('active', mode === 'piano');
  modeGuitarButton.classList.toggle('active', mode === 'guitar');
  modeSongPlayerButton.classList.toggle('active', mode === 'songplayer');
  modeVoiceButton.classList.toggle('active', mode === 'voice');
  songPlayerPanel.hidden = mode !== 'songplayer';
  voicePanel.hidden = mode !== 'voice';
  settingsHud.hidden = mode !== 'songplayer' && mode !== 'voice';
  speedMeterRow.hidden = mode !== 'songplayer';
}

modePianoButton.addEventListener('click', () => switchMode('piano'));
modeGuitarButton.addEventListener('click', () => switchMode('guitar'));
modeSongPlayerButton.addEventListener('click', () => switchMode('songplayer'));
modeVoiceButton.addEventListener('click', () => switchMode('voice'));

// --- Song Player: mouse-driven transport + two-hand gesture control ---

const localFilePlayer = new LocalFilePlayer();
const songPlayerMode = new SongPlayerMode();
localFilePlayer.connectEffectsChain(songPlayerMode.getEntryNode());
let seekBarDragging = false;

async function loadSongFile(file) {
  songPlayerStatus.textContent = `Loading ${file.name}…`;
  playPauseButton.disabled = true;
  seekBar.disabled = true;
  try {
    await Tone.start();
    await localFilePlayer.load(file);
  } catch (err) {
    console.error('Failed to load audio file:', err);
    songPlayerStatus.textContent = `Couldn't load ${file.name} — ${err.message}`;
    return;
  }
  songPlayerStatus.textContent = `Loaded: ${file.name}`;
  playPauseButton.disabled = false;
  seekBar.disabled = false;
  closeAddSongPopover();
  updateTransportUI();
}

// Loads a direct link to an audio file (e.g. a Bandcamp or Free Music
// Archive download link) — not a YouTube/streaming page. There's no
// legitimate client-side way to extract audio from those, and no
// backend in this project to do it server-side either.
async function loadSongFromUrl(url) {
  if (!url) return;
  songPlayerStatus.textContent = `Fetching ${url}…`;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const filename = url.split('/').pop().split('?')[0] || 'audio';
    await loadSongFile(new File([blob], filename, { type: blob.type }));
  } catch (err) {
    console.error('Failed to load audio from URL:', err);
    songPlayerStatus.textContent = `Couldn't load that link — ${err.message}. Many hosts block cross-origin fetches (CORS); this only works for direct audio links that allow it.`;
  }
}

function openAddSongPopover() {
  addSongPopover.hidden = false;
  addSongButton.classList.add('open');
}
function closeAddSongPopover() {
  addSongPopover.hidden = true;
  addSongButton.classList.remove('open');
}

addSongButton.addEventListener('click', () => {
  if (addSongPopover.hidden) openAddSongPopover();
  else closeAddSongPopover();
});

document.addEventListener('click', (e) => {
  if (!addSongPopover.hidden && !e.target.closest('.add-song')) {
    closeAddSongPopover();
  }
});

filePicker.addEventListener('change', () => {
  const file = filePicker.files[0];
  if (file) loadSongFile(file);
});

urlLoadButton.addEventListener('click', () => loadSongFromUrl(urlInput.value.trim()));

// Dropping a file anywhere on screen also works, not just via the popover.
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  if (activeMode !== 'songplayer') return;
  const file = e.dataTransfer.files[0];
  if (file) loadSongFile(file);
});

playPauseButton.addEventListener('click', async () => {
  try {
    await Tone.start();
    if (localFilePlayer.isPlaying) {
      localFilePlayer.pause();
    } else {
      localFilePlayer.play();
    }
  } catch (err) {
    console.error('Play/pause failed:', err);
    songPlayerStatus.textContent = `Playback error — ${err.message}`;
  }
});

seekBar.addEventListener('input', () => {
  seekBarDragging = true;
});
seekBar.addEventListener('change', () => {
  localFilePlayer.seek(parseFloat(seekBar.value));
  seekBarDragging = false;
});

// --- Voice: mic recording through the same gesture-controlled effects ---

const voiceMode = new VoiceMode();
// Visual-only tap (Tone.Waveform has no output of its own) so the HUD
// waveform reflects the live take while recording, without also routing
// the mic to the speakers the way connecting to Destination would.
voiceMode.limiter.connect(waveform);

voiceRecordButton.addEventListener('click', async () => {
  try {
    if (voiceMode.isRecording) {
      await voiceMode.stopRecording();
      voiceRecordButton.textContent = 'Record';
      voiceStatus.textContent = 'Recording captured.';
      voicePlayButton.disabled = false;
    } else {
      voiceMode.stopPlayback();
      await voiceMode.startRecording();
      voiceRecordButton.textContent = 'Stop';
      voiceStatus.textContent = 'Recording — use your hands to shape the sound live.';
      voicePlayButton.disabled = true;
    }
  } catch (err) {
    console.error('Voice recording failed:', err);
    voiceStatus.textContent = `Microphone error — ${err.message}`;
  }
});

voicePlayButton.addEventListener('click', () => {
  if (voiceMode.isPlaying) {
    voiceMode.stopPlayback();
    voicePlayButton.textContent = 'Play';
  } else {
    voiceMode.play();
    voicePlayButton.textContent = 'Stop';
  }
});

function updateVoiceUI() {
  if (voiceMode.isPlaying) {
    voicePlayButton.textContent = 'Stop';
  } else if (voicePlayButton.textContent === 'Stop') {
    voicePlayButton.textContent = 'Play';
  }
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function updateTransportUI() {
  const duration = localFilePlayer.getDuration();
  const position = localFilePlayer.getCurrentPosition();
  if (!seekBarDragging) {
    seekBar.value = duration > 0 ? position / duration : 0;
  }
  timeDisplay.textContent = `${formatTime(position)} / ${formatTime(duration)}`;
  playPauseButton.textContent = localFilePlayer.isPlaying ? 'Pause' : 'Play';
}

async function main() {
  status.textContent = 'Requesting camera access…';
  const cameraReady = await setupCamera(video);
  if (!cameraReady) {
    status.textContent =
      'Camera access denied. Piano/Guitar need it, and Voice needs it for live effect control, but Song Player and Voice recording/playback still work without a camera.';
  } else {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    status.textContent = 'Loading hand tracking model…';
    await createHandLandmarker();
    status.textContent = 'Show your hand(s) to the camera.';
  }

  // Started regardless of camera success: Song Player's transport UI
  // doesn't depend on the camera, and renderLoop already guards the
  // hand-tracking work behind video.readyState.
  requestAnimationFrame(renderLoop);
}

function renderLoop() {
  if (video.readyState >= 2) {
    const result = detectForVideo(video, performance.now());
    // Smoothed once here, centrally, rather than separately in every
    // consumer — outlier rejection + light EMA so a single bad/blurred
    // frame (e.g. from fast hand motion) can't produce a visible
    // teleport in the skeleton or a spike in any gesture reading.
    const landmarks = smoothLandmarks(result.landmarks);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawLandmarks(landmarks, result.handedness);
    if (activeMode === 'piano') {
      updateInteraction(landmarks, activeInstrument, result.handedness);
    } else if (activeMode === 'guitar') {
      updateGuitarInteraction(landmarks, activeInstrument);
    } else if (activeMode === 'songplayer') {
      songPlayerMode.updateInteraction(landmarks, result.handedness, localFilePlayer);
      updateGestureReadout(songPlayerMode.state, true);
    } else if (activeMode === 'voice') {
      voiceMode.updateInteraction(landmarks, result.handedness);
      updateGestureReadout(voiceMode.state, false);
    }
  }
  // Playback/recording isn't tied to the camera, so this runs regardless
  // of whether a hand is currently being tracked this frame.
  if (activeMode === 'songplayer') {
    updateTransportUI();
  } else if (activeMode === 'voice') {
    updateVoiceUI();
  }
  drawWaveform();
  updateNoteTags();
  requestAnimationFrame(renderLoop);
}

// Shared by Song Player and Voice mode, whose states overlap on
// leftPresent/rightPresent/volume/autotuneAmount/reverbAmount/delayAmount.
// Voice mode has no speed or lock concept, so those rows are skipped
// (they're also hidden in the HUD for that mode).
function updateGestureReadout(s, showSpeedAndLock) {
  leftPresentEl.textContent = s.leftPresent ? '●' : '○';
  rightPresentEl.textContent = s.rightPresent ? '●' : '○';

  setMeter(fillVolume, meterVolume, s.volume, `${Math.round(s.volume * 100)}%`);
  if (showSpeedAndLock) {
    setMeter(
      fillSpeed,
      meterSpeed,
      (s.speed - MIN_SPEED_DISPLAY) / (MAX_SPEED_DISPLAY - MIN_SPEED_DISPLAY),
      `${s.speed.toFixed(2)}x`
    );
  }
  setMeter(fillAutotune, meterAutotune, s.autotuneAmount, `${Math.round(s.autotuneAmount * 100)}%`);
  setMeter(fillReverb, meterReverb, s.reverbAmount, `${Math.round(s.reverbAmount * 100)}%`);
  setMeter(fillDelay, meterDelay, s.delayAmount, `${Math.round(s.delayAmount * 100)}%`);

  lockIndicator.textContent = showSpeedAndLock && s.locked
    ? '🔒 Locked — close both fists again to unlock'
    : '';
}

function setMeter(fillEl, valueEl, ratio, text) {
  fillEl.style.width = `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`;
  valueEl.textContent = text;
}

// Layered, undulating traces rather than flat bars — each layer reads
// the same smoothed energy envelope but at a different frequency/phase,
// giving the dense, organic multi-line look of a real oscilloscope
// rather than a plain bar meter.
const WAVEFORM_LAYERS = 3;

function drawWaveform() {
  const samples = waveform.getValue();
  const bucketSize = Math.floor(samples.length / WAVEFORM_BARS);

  for (let bar = 0; bar < WAVEFORM_BARS; bar++) {
    let sumSquares = 0;
    const start = bar * bucketSize;
    for (let j = 0; j < bucketSize; j++) {
      const v = samples[start + j];
      sumSquares += v * v;
    }
    const rms = Math.sqrt(sumSquares / bucketSize);
    const target = Math.min(1, rms * 3.5); // typical program material rarely hits full-scale RMS
    waveformDisplayValues[bar] += WAVEFORM_SMOOTHING * (target - waveformDisplayValues[bar]);
  }

  const w = waveformCanvas.width;
  const h = waveformCanvas.height;
  waveformCtx.clearRect(0, 0, w, h);

  const midY = h / 2;
  const t = performance.now() / 1000;

  for (let layer = 0; layer < WAVEFORM_LAYERS; layer++) {
    const phase = layer * 1.7;
    const freqMult = 1 + layer * 0.5;
    const ampScale = 1 - layer * 0.22;
    const opacity = 1 - layer * 0.32;

    waveformCtx.beginPath();
    waveformCtx.strokeStyle = `rgba(212, 175, 55, ${opacity})`;
    waveformCtx.lineWidth = 2;

    for (let i = 0; i <= WAVEFORM_BARS; i++) {
      const energy = waveformDisplayValues[Math.min(i, WAVEFORM_BARS - 1)];
      const x = (i / WAVEFORM_BARS) * w;
      const wobble = Math.sin(i * 0.5 * freqMult + t * 2 + phase) * energy * (h * 0.4) * ampScale;
      const y = midY + wobble;
      if (i === 0) waveformCtx.moveTo(x, y);
      else waveformCtx.lineTo(x, y);
    }
    waveformCtx.stroke();
  }
}

function updateNoteTags() {
  let notes = [];
  if (activeMode === 'piano') notes = getActivePianoNotes();
  else if (activeMode === 'guitar') notes = getActiveGuitarNotes();

  noteTagsEl.innerHTML = notes
    .map((note) => `<span class="note-tag">${note}</span>`)
    .join('');
}

function drawLandmarks(landmarksList, handedness) {
  landmarksList.forEach((landmarks, handIndex) => {
    ctx.strokeStyle = 'rgba(212, 175, 55, 0.55)';
    ctx.lineWidth = 1.5;
    for (const { start, end } of HandLandmarker.HAND_CONNECTIONS) {
      const a = landmarks[start];
      const b = landmarks[end];
      ctx.beginPath();
      ctx.moveTo(a.x * canvas.width, a.y * canvas.height);
      ctx.lineTo(b.x * canvas.width, b.y * canvas.height);
      ctx.stroke();
    }

    ctx.fillStyle = '#f0d78c';
    for (const point of landmarks) {
      ctx.beginPath();
      ctx.arc(point.x * canvas.width, point.y * canvas.height, 2.5, 0, 2 * Math.PI);
      ctx.fill();
    }

    // Song Player and Voice modes don't map fingers to notes — instead
    // label which physical hand MediaPipe thinks this is, since that
    // assignment (and therefore which gesture role applies) is exactly
    // the kind of thing worth confirming visually rather than assuming.
    if (activeMode === 'songplayer' || activeMode === 'voice') {
      const category = handedness[handIndex]?.[0]?.categoryName;
      if (category) {
        const wrist = landmarks[0];
        drawNoteLabel(
          category,
          wrist.x * canvas.width,
          wrist.y * canvas.height + 24,
          category === 'Left' ? '#ffeb3b' : '#2196f3'
        );
      }
      return;
    }

    // Audio pitch glides continuously with hand height, but note names
    // are discrete — round to the nearest octave for the label.
    const octaveShift =
      activeMode === 'piano' ? Math.round(octaveShiftFromHeight(handPosition(landmarks).y)) : 0;
    // Each hand has its own 4-note set in Piano mode (see fingers.js) —
    // look up by which hand this is, same as updateInteraction does.
    const pianoCategory = handedness[handIndex]?.[0]?.categoryName ?? 'Right';
    const pianoNotes = FINGER_NOTES_BY_HAND[pianoCategory] ?? FINGER_NOTES_BY_HAND.Right;
    for (const [finger, tipIndex] of Object.entries(FINGER_TIPS)) {
      const tip = landmarks[tipIndex];
      const label =
        activeMode === 'piano'
          ? shiftNoteOctave(pianoNotes[finger], octaveShift)
          : GUITAR_STRING_NOTES[finger];
      drawNoteLabel(
        label,
        tip.x * canvas.width,
        tip.y * canvas.height - 14,
        FINGER_COLORS[finger]
      );
    }
  });
}

// The canvas itself is CSS-mirrored (scaleX(-1)) to match the selfie-style
// video, which would make fillText render backwards. Locally un-mirror
// just the text so labels stay readable.
function drawNoteLabel(text, x, y, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(-1, 1);
  ctx.fillStyle = color;
  ctx.font = 'bold 14px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

main();
