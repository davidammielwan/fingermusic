const FINGER_JOINTS = {
  thumb: [1, 2, 3, 4],
  index: [5, 6, 7, 8],
  middle: [9, 10, 11, 12],
  ring: [13, 14, 15, 16],
  pinky: [17, 18, 19, 20],
};

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function handScale(landmarks) {
  return dist(landmarks[0], landmarks[9]);
}

// Fingertip landmarks sit on the surface of the fingers, which have real
// width, so the raw distance never reaches 0 even when the pads are
// touching — it bottoms out around the finger's own thickness. Rescale
// so that floor reads as 0 and 1x hand-scale reads as fully open. Tune
// these to taste for your hand/camera setup.
const PINCH_MIN_DIST = 0.1;
const PINCH_MAX_DIST = 1.0;

export function pinchDistance(landmarks, fingerTipIndex) {
  const raw = dist(landmarks[4], landmarks[fingerTipIndex]) / handScale(landmarks);
  const normalized = (raw - PINCH_MIN_DIST) / (PINCH_MAX_DIST - PINCH_MIN_DIST);
  return Math.min(1, Math.max(0, normalized));
}

// Joint-angle math (PIP/DIP interior angles) is numerically unstable at
// high curl: as the finger folds, those segments foreshorten toward
// zero length in the 2D projection, so ordinary landmark jitter turns
// into large, non-monotonic angle swings. Use tip-to-wrist distance
// instead — wrist and MCP stay a full hand-length apart even at full
// curl, so the measurement never depends on a near-zero-length vector.
// Extended: tip is far past the MCP (ratio > 1). Curled: tip folds back
// toward the palm, landing near or below the MCP (ratio <= ~1). Tune
// these to taste if your fist doesn't quite hit 1.
const EXTENDED_RATIO = 1.8;
const CURLED_RATIO = 0.8;

export function fingerCurl(landmarks, fingerName) {
  const [mcp, , , tip] = FINGER_JOINTS[fingerName].map((i) => landmarks[i]);
  const wrist = landmarks[0];
  const ratio = dist(tip, wrist) / dist(mcp, wrist);
  const curl = (EXTENDED_RATIO - ratio) / (EXTENDED_RATIO - CURLED_RATIO);
  return Math.min(1, Math.max(0, curl));
}

export function handTilt(landmarks) {
  const wrist = landmarks[0];
  const middleMcp = landmarks[9];
  return Math.atan2(middleMcp.x - wrist.x, -(middleMcp.y - wrist.y));
}

export function handPosition(landmarks) {
  return { x: landmarks[0].x, y: landmarks[0].y };
}
