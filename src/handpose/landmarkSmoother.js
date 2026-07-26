// Smooths raw per-landmark positions before they reach drawing or gesture
// math. Two distinct jobs, both needed:
//
// 1. Outlier rejection — a genuinely bad frame (motion blur, a brief
//    mis-detection) can report a landmark implausibly far from where it
//    was a frame ago. Clamping the per-frame movement to MAX_JUMP stops
//    that from reading as an instant teleport; the display still catches
//    up to fast real movement over the next few frames instead of
//    following a single bad reading straight there.
// 2. Light jitter smoothing (EMA) on top of that clamped movement.
//
// This is intentionally the *only* place raw landmarks get touched —
// every downstream consumer (skeleton drawing, finger curl, pinch,
// tilt, hand position) already assumes its input is reasonably stable,
// so smoothing once here rather than separately in each consumer keeps
// their behavior consistent with each other.
//
// Real limitation worth being upfront about: if the camera captures a
// genuinely motion-blurred frame, the hand-tracking model has no clean
// detail to detect in the first place. No amount of post-processing can
// recover information that was never captured — this reduces visible
// glitching from bad/noisy detections, it doesn't defeat motion blur
// itself.
const SMOOTHING_ALPHA = 0.5;
const MAX_JUMP_PER_FRAME = 0.12;

// smoothedHands[handIndex] = array of 21 {x, y, z} — persists across
// frames like every other per-hand-index tracker in this project.
const smoothedHands = [];

export function smoothLandmarks(handsLandmarks) {
  return handsLandmarks.map((landmarks, handIndex) => {
    const smoothed = (smoothedHands[handIndex] ??= landmarks.map((p) => ({
      x: p.x,
      y: p.y,
      z: p.z ?? 0,
    })));

    return landmarks.map((point, i) => {
      const prev = smoothed[i];
      const rawZ = point.z ?? 0;
      let dx = point.x - prev.x;
      let dy = point.y - prev.y;
      let dz = rawZ - prev.z;

      const dist = Math.hypot(dx, dy, dz);
      if (dist > MAX_JUMP_PER_FRAME) {
        const scale = MAX_JUMP_PER_FRAME / dist;
        dx *= scale;
        dy *= scale;
        dz *= scale;
      }

      prev.x += dx * SMOOTHING_ALPHA;
      prev.y += dy * SMOOTHING_ALPHA;
      prev.z += dz * SMOOTHING_ALPHA;
      return { x: prev.x, y: prev.y, z: prev.z };
    });
  });
}
