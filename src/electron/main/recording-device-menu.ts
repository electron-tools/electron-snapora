import { BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { resolve } from 'node:path';
import type { ScreenshotBounds } from '../../types.js';

/** A separate light popup keeps the preparation window's bounds and host theme unchanged. */
export class RecordingDeviceMenu {
  #window: BrowserWindow;
  #resolve: ((id: string | null) => void) | undefined;
  #closed = false;
  constructor(
    private readonly parent: BrowserWindow,
    area: ScreenshotBounds,
    anchor: { x: number; y: number },
    private readonly data: {
      items: Array<{ id: string; label: string }>;
      selected: string;
      label: string;
      empty: string;
      locale: string;
    }
  ) {
    const p = parent.getContentBounds();
    const width = Math.min(280, area.width);
    const height = Math.min(268, Math.max(1, data.items.length) * 32 + 12, area.height);
    const below = p.y + Math.max(0, Math.min(p.height, anchor.y));
    const x = Math.max(area.x, Math.min(area.x + area.width - width, p.x + anchor.x));
    const y = Math.max(
      area.y,
      Math.min(
        area.y + area.height - height,
        below + height <= area.y + area.height ? below : below - 40 - height
      )
    );
    const win = new BrowserWindow({
      x: Math.round(x),
      y: Math.round(y),
      width,
      height,
      parent,
      title: 'Snapora device menu',
      frame: false,
      thickFrame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      show: false,
      skipTaskbar: true,
      // Keep device choices clickable on the first click after another app was active (macOS).
      acceptFirstMouse: true,
      webPreferences: {
        session: parent.webContents.session,
        preload: resolve(__dirname, '../recording/preload.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    this.#window = win;
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setContentProtection(true);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    win.on('blur', () => this.close());
    win.on('closed', () => this.close());
    win.webContents.on('render-process-gone', () => this.close());
  }

  owns(event: IpcMainInvokeEvent) {
    return (
      !this.#closed &&
      event.sender === this.#window.webContents &&
      event.senderFrame === this.#window.webContents.mainFrame
    );
  }

  request(action: unknown, payload: unknown) {
    if (action === 'device-menu-init') return this.data;
    if (action === 'device-menu-ready') {
      this.#window.show();
      this.#window.focus();
      return true;
    }
    if (action === 'device-menu-dismiss') {
      this.close(null, true);
      return true;
    }
    if (
      action === 'device-menu-select' &&
      typeof payload === 'string' &&
      this.data.items.some((item) => item.id === payload)
    ) {
      this.close(payload, true);
      return true;
    }
    throw new Error('Unauthorized device menu action.');
  }

  open(): Promise<string | null> {
    return new Promise((resolveMenu, reject) => {
      this.#resolve = resolveMenu;
      void this.#window
        .loadFile(resolve(__dirname, '../overlay/recording-devices.html'))
        .catch((error) => {
          this.#resolve = undefined;
          this.close();
          reject(error);
        });
    });
  }

  close(value: string | null = null, restoreFocus = false) {
    if (this.#closed) return;
    this.#closed = true;
    this.#resolve?.(value);
    this.#resolve = undefined;
    if (!this.#window.isDestroyed()) this.#window.destroy();
    if (restoreFocus && !this.parent.isDestroyed()) this.parent.focus();
  }
}
