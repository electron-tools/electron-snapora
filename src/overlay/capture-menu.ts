import type { ScreenshotOptions } from '../types.js';
import { recordingMessages } from '../i18n/recording.js';

/** Preparation-only menu; its drag gesture cannot fall through into desktop selection. */
export function createCaptureMenu(onChange: () => void = () => {}) {
  const element = document.createElement('nav');
  element.className = 'capture-mode-menu';
  element.hidden = true;
  element.innerHTML =
    '<button type="button" class="capture-menu-grip" aria-label="Move menu"><svg viewBox="0 0 12 18" aria-hidden="true"><circle cx="3" cy="4" r="1.3"/><circle cx="9" cy="4" r="1.3"/><circle cx="3" cy="9" r="1.3"/><circle cx="9" cy="9" r="1.3"/><circle cx="3" cy="14" r="1.3"/><circle cx="9" cy="14" r="1.3"/></svg></button><button type="button" data-mode="screenshot">截图</button><button type="button" data-mode="record">录制</button>';
  document.body.append(element);
  let jobId = '';
  let mode: 'screenshot' | 'record' = 'screenshot';
  const choose = (value: typeof mode) => {
    mode = value;
    document.documentElement.dataset.captureMode = mode;
    for (const button of element.querySelectorAll<HTMLButtonElement>('[data-mode]'))
      button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    onChange();
  };
  for (const button of element.querySelectorAll<HTMLButtonElement>('[data-mode]'))
    button.onclick = () => {
      choose(button.dataset.mode as typeof mode);
      window.snaporaOverlay.setMode(jobId, mode);
    };
  element.addEventListener('pointerdown', (event) => event.stopPropagation());
  const grip = element.querySelector<HTMLButtonElement>('.capture-menu-grip')!;
  let drag: { id: number; x: number; left: number } | undefined;
  grip.onpointerdown = (event) => {
    event.preventDefault();
    grip.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, x: event.clientX, left: element.offsetLeft };
  };
  grip.onpointermove = (event) => {
    if (drag?.id === event.pointerId)
      element.style.left = `${Math.max(8, Math.min(innerWidth - element.offsetWidth - 8, drag.left + event.clientX - drag.x))}px`;
  };
  grip.onpointerup = grip.onpointercancel = () => {
    drag = undefined;
  };
  window.snaporaOverlay.onMode((payload) => {
    if (payload.jobId === jobId) choose(payload.mode);
  });
  return {
    initialize(id: string, options: ScreenshotOptions) {
      jobId = id;
      choose(options.mode ?? 'screenshot');
      const messages = recordingMessages(options.locale);
      grip.setAttribute('aria-label', messages.move);
      element.querySelector<HTMLButtonElement>(
        '[data-mode="screenshot"]'
      )!.textContent = messages.screenshot;
      element.querySelector<HTMLButtonElement>('[data-mode="record"]')!.textContent =
        messages.record;
      element.hidden = false;
      element.style.left = `${Math.max(8, (innerWidth - element.offsetWidth) / 2)}px`;
    },
    hide() {
      element.hidden = true;
    },
    isRecording() {
      return mode === 'record';
    },
  };
}
