export async function setupCamera(videoElement) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480 },
      audio: false,
    });
    videoElement.srcObject = stream;
    await new Promise((resolve) => {
      videoElement.onloadedmetadata = resolve;
    });
    await videoElement.play();
    return true;
  } catch (err) {
    console.error('Camera setup failed:', err);
    return false;
  }
}
