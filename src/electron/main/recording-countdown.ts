import { BrowserWindow } from 'electron';
import type { ScreenshotBounds } from '../../types.js';

/** The countdown owns no capture stream and is destroyed before any encoded frame. */
export async function showRecordingCountdown(
  area: ScreenshotBounds,
  signal: AbortSignal
): Promise<void> {
  if (signal.aborted) throw new Error('Recording cancelled.');
  const win = new BrowserWindow({
    x: Math.round(area.x + (area.width - 88) / 2),
    y: Math.round(area.y + (area.height - 88) / 2),
    width: 88,
    height: 88,
    title: 'Snapora countdown',
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    show: false,
    focusable: false,
    skipTaskbar: true,
    webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true);
  win.setContentProtection(true);
  const abort = () => {
    if (!win.isDestroyed()) win.destroy();
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    await win.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(`<title>Snapora countdown</title><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>body{margin:0;background:transparent}main{width:88px;height:88px;border-radius:50%;background:#555b64e8;color:white;display:grid;place-items:center;font:500 42px system-ui}span{grid-area:1/1;visibility:hidden;animation:count 1s linear}span:nth-child(2){animation-delay:1s}span:nth-child(3){animation-delay:2s}@keyframes count{0%,99%{visibility:visible}100%{visibility:hidden}}</style><main><span>3</span><span>2</span><span>1</span></main>`)}`
    );
    if (signal.aborted) throw new Error('Recording cancelled.');
    win.showInactive();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', cancel);
        resolve();
      }, 3000);
      const cancel = () => {
        clearTimeout(timer);
        reject(new Error('Recording cancelled.'));
      };
      signal.addEventListener('abort', cancel, { once: true });
    });
  } finally {
    signal.removeEventListener('abort', abort);
    if (!win.isDestroyed()) win.destroy();
  }
}
