import { BrowserWindow, type Session } from 'electron';
import type { ScreenshotBounds } from '../../types.js';
import { recordingOutline } from '../../recording/policy.js';

/** Click-through dimming and outline; every painted pixel stays outside the recorded region. */
export async function createRecordingOutline(
  display: ScreenshotBounds,
  selection: ScreenshotBounds,
  session: Session
): Promise<BrowserWindow | undefined> {
  const geometry = recordingOutline(display, selection);
  if (!geometry) return undefined;
  const win = new BrowserWindow({
    ...display,
    title: 'Snapora recording outline',
    frame: false,
    thickFrame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      session,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setIgnoreMouseEvents(true);
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setContentProtection(true);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // No script, preload or host data: the page contains only validated numeric rectangles.
  const lines = geometry.lines
    .map(
      (r) =>
        `<i style="left:${r.x + geometry.bounds.x - display.x}px;top:${r.y + geometry.bounds.y - display.y}px;width:${r.width}px;height:${r.height}px"></i>`
    )
    .join('');
  // Keep a one-DIP clear gap at fractional DPI so dimming never darkens captured edge pixels.
  const left = Math.max(0, Math.floor(selection.x) - 1);
  const top = Math.max(0, Math.floor(selection.y) - 1);
  const right = Math.min(display.width, Math.ceil(selection.x + selection.width) + 1);
  const bottom = Math.min(
    display.height,
    Math.ceil(selection.y + selection.height) + 1
  );
  const masks = [
    { x: 0, y: 0, width: display.width, height: top },
    { x: 0, y: bottom, width: display.width, height: display.height - bottom },
    { x: 0, y: top, width: left, height: bottom - top },
    { x: right, y: top, width: display.width - right, height: bottom - top },
  ]
    .filter((r) => r.width > 0 && r.height > 0)
    .map(
      (r) =>
        `<b style="left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px"></b>`
    )
    .join('');
  try {
    await win.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(
        `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>body{margin:0;background:transparent;overflow:hidden}i,b{position:absolute}i{background:#f06454}b{background:rgba(0,0,0,.4)}</style>${masks}${lines}`
      )}`
    );
    return win;
  } catch (error) {
    win.destroy();
    throw error;
  }
}
