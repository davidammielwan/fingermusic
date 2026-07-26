import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

const WASM_BASE_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

let handLandmarker = null;

export async function createHandLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(WASM_BASE_URL);
  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: MODEL_URL,
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numHands: 2,
    // When a hand nears the frame edge, presence/tracking confidence drops
    // below the default 0.5 and the model discards its tracked ROI, falling
    // back to the expensive full palm-detector every frame — that's the
    // lag. Lower thresholds let it keep using the cheaper tracker longer.
    minHandPresenceConfidence: 0.3,
    minTrackingConfidence: 0.3,
  });
  return handLandmarker;
}

export function detectForVideo(videoElement, timestampMs) {
  return handLandmarker.detectForVideo(videoElement, timestampMs);
}

export { HandLandmarker };
