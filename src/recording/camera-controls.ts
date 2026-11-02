import './camera-controls.css';
import '../overlay/tooltip.css';
import { positionTooltipHorizontally } from '../overlay/tooltip.js';
import type { RecordingApi } from './protocol.js';
import type { CameraStyle } from './camera-layout.js';
import { recordingMessages } from '../i18n/recording.js';

/** Only camera presentation actions are accepted from this independent settings window. */
const api = (window as unknown as { snaporaRecording: RecordingApi }).snaporaRecording;
const buttons = [...document.querySelectorAll<HTMLButtonElement>('button')];
let style: CameraStyle;
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
function render() {
  for (const button of buttons)
    button.setAttribute(
      'aria-pressed',
      String(button.dataset.shape === style.shape || button.dataset.size === style.size)
    );
}
for (const button of buttons)
  button.onclick = async () => {
    buttons.forEach((b) => (b.disabled = true));
    try {
      style = (await api.request('camera-style', {
        ...style,
        ...(button.dataset.shape
          ? { shape: button.dataset.shape }
          : { size: button.dataset.size }),
      })) as CameraStyle;
      render();
    } finally {
      buttons.forEach((b) => (b.disabled = false));
    }
  };
document.body.onpointerenter = () => {
  void api.request('camera-hover', true);
};
document.body.onpointerleave = () => {
  if (!drag) void api.request('camera-hover', false);
};
document.body.onpointerdown = (event) => {
  document.documentElement.dataset.tooltipPointer = 'down';
  if ((event.target as Element).closest('main') || event.button !== 0) return;
  document.body.setPointerCapture(event.pointerId);
  drag = { x: event.screenX, y: event.screenY };
  document.body.dataset.dragging = 'true';
  void api.request('camera-drag');
};
document.body.onpointermove = (event) => {
  if (!drag) return;
  latest = { dx: event.screenX - drag.x, dy: event.screenY - drag.y };
  void move();
};
document.body.onpointerup = document.body.onpointercancel = (event) => {
  drag = undefined;
  delete document.body.dataset.dragging;
  delete document.documentElement.dataset.tooltipPointer;
  void api.request(
    'camera-hover',
    event.clientX >= 0 &&
      event.clientY >= 0 &&
      event.clientX < innerWidth &&
      event.clientY < innerHeight
  );
};
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') void api.request('camera-settings-hide');
});
void api.request('camera-settings-init').then((raw) => {
  const data = raw as { style: CameraStyle; locale: string };
  style = data.style;
  document.body.dataset.shape = style.shape;
  const messages = recordingMessages(data.locale);
  document.documentElement.lang = data.locale;
  document.querySelector('#shapes')!.setAttribute('aria-label', messages.shape);
  document.querySelector('#sizes')!.setAttribute('aria-label', messages.size);
  for (const button of buttons) {
    const key = (button.dataset.shape || button.dataset.size) as
      CameraStyle['shape'] | CameraStyle['size'];
    button.dataset.tooltip = messages[key];
    button.setAttribute('aria-label', messages[key]);
    button.onpointerenter = button.onfocus = () => positionTooltipHorizontally(button);
  }
  render();
});
