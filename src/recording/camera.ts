import './camera.css';
import type { RecordingApi } from './protocol.js';
import type { CameraStyle } from './camera-layout.js';

/** The unprotected camera window is part of the desktop capture, so preview and output positions agree. */
const api = (window as unknown as { snaporaRecording: RecordingApi }).snaporaRecording;
const video = document.querySelector('video')!;
// Settings live in a separate, capture-protected window rather than on the recorded video.
video.onpointerenter = () => {
  void api.request('camera-hover', true);
};
video.onpointerleave = () => {
  if (!drag) void api.request('camera-hover', false);
};
document.addEventListener('camera-style', ((event: CustomEvent<CameraStyle>) => {
  document.body.dataset.shape = event.detail.shape;
}) as EventListener);
let stream: MediaStream | undefined;
let drag: { x: number; y: number } | undefined;
let moving = false;
let latest: { dx: number; dy: number } | undefined;
async function move() {
  if (moving) return;
  moving = true;
  try {
    while (latest) {
      const point = latest;
      latest = undefined;
      await api.request('camera-move', point);
    }
  } finally {
    moving = false;
  }
}
video.onpointerdown = (event) => {
  video.setPointerCapture(event.pointerId);
  drag = { x: event.screenX, y: event.screenY };
  void api.request('camera-drag');
};
video.onpointermove = (event) => {
  if (!drag) return;
  latest = { dx: event.screenX - drag.x, dy: event.screenY - drag.y };
  void move();
};
video.onpointerup = video.onpointercancel = () => {
  drag = undefined;
  void api.request('camera-hover', true);
};
void (async () => {
  try {
    const { deviceId, style } = (await api.request('camera-init')) as {
      deviceId?: string;
      style: CameraStyle;
    };
    document.body.dataset.shape = style.shape;
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        width: { ideal: 640 },
        height: { ideal: 360 },
        frameRate: { ideal: 30, max: 30 },
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      },
    });
    video.srcObject = stream;
    await video.play();
    stream.getVideoTracks()[0]!.addEventListener('ended', () => {
      void api.request('camera-error', 'Camera disconnected.');
    });
    video.requestVideoFrameCallback(() => {
      void api.request('camera-ready');
    });
  } catch (error) {
    await api.request('camera-error', String(error));
  }
})();
window.addEventListener('beforeunload', () =>
  stream?.getTracks().forEach((track) => track.stop())
);

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') void api.request('camera-escape');
});
