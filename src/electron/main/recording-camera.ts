import { BrowserWindow, screen, type Session, type IpcMainInvokeEvent } from 'electron';
import { resolve } from 'node:path';
import type { ScreenshotBounds } from '../../types.js';
import {
  cameraBounds,
  parseCameraStyle,
  type CameraStyle,
} from '../../recording/camera-layout.js';

/** Camera lifetime is bound to one recording. It has no file-write or general recorder IPC access. */
export class RecordingCamera {
  window: BrowserWindow | undefined;
  #origin: ScreenshotBounds | undefined;
  #ready: (() => void) | undefined;
  #reject: ((error: Error) => void) | undefined;
  #closing = false;
  #controls: BrowserWindow | undefined;
  #hideTimer: ReturnType<typeof setTimeout> | undefined;
  #style: CameraStyle = { shape: 'square', size: 'medium' };
  #filtering = false;
  constructor(
    private readonly area: ScreenshotBounds,
    private readonly session: Session,
    private readonly deviceId: string | undefined,
    private readonly onError: (error: Error) => void,
    private readonly locale = 'en'
  ) {}

  owns(event: IpcMainInvokeEvent) {
    return [this.window, this.#controls].some(
      (win) =>
        win &&
        !win.isDestroyed() &&
        event.sender === win.webContents &&
        event.senderFrame === win.webContents.mainFrame
    );
  }

  async open(): Promise<void> {
    const bounds = cameraBounds(this.area, this.#style);
    const { width, height } = bounds;
    const win = new BrowserWindow({
      ...bounds,
      width,
      height,
      minWidth: width,
      maxWidth: width,
      minHeight: height,
      maxHeight: height,
      title: 'Snapora camera',
      frame: false,
      thickFrame: false,
      resizable: false,
      movable: false,
      show: false,
      hasShadow: false,
      skipTaskbar: true,
      transparent: true,
      backgroundColor: '#00000000',
      webPreferences: {
        session: this.session,
        preload: resolve(__dirname, '../recording/preload.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    this.window = win;
    win.setAlwaysOnTop(true, 'screen-saver');
    // Intentionally capture this window. Excluding it would omit the camera from the saved file.
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    win.webContents.on('render-process-gone', () =>
      this.#error(new Error('Camera renderer exited.'))
    );
    win.on('closed', () => {
      if (!this.#closing) this.#error(new Error('Camera window closed.'));
    });
    let timer: ReturnType<typeof setTimeout>;
    const ready = new Promise<void>((resolveReady, reject) => {
      this.#ready = resolveReady;
      this.#reject = reject;
      timer = setTimeout(
        () => reject(new Error('Camera initialization timed out.')),
        15000
      );
    });
    try {
      await Promise.all([
        ready,
        win.loadFile(resolve(__dirname, '../overlay/camera.html')),
        this.#openControls(),
      ]);
      if (!this.#closing) {
        // Windows may round native dimensions at fractional DPI; anchor using the actual size.
        const bounds = win.getBounds();
        win.setBounds({
          ...bounds,
          x: Math.floor(this.area.x + this.area.width - bounds.width),
          y: Math.floor(this.area.y + this.area.height - bounds.height),
        });
        win.showInactive();
      }
    } catch (error) {
      this.close();
      throw error;
    } finally {
      clearTimeout(timer!);
      this.#ready = this.#reject = undefined;
    }
  }

  request(action: string, raw: unknown, event: IpcMainInvokeEvent): unknown {
    if (action === 'camera-hover' && typeof raw === 'boolean') {
      if (this.#filtering) return true;
      clearTimeout(this.#hideTimer);
      if (raw) this.#showControls();
      else
        this.#hideTimer = setTimeout(() => {
          const bounds = this.window?.getBounds();
          const point = screen.getCursorScreenPoint();
          // Entering the overlapping controls generates a synthetic camera leave. Only the
          // desktop cursor leaving the combined area may hide controls, never window handoff.
          if (
            bounds &&
            point.x >= bounds.x &&
            point.y >= bounds.y &&
            point.x < bounds.x + bounds.width &&
            point.y < bounds.y + bounds.height
          )
            return;
          this.#controls?.hide();
        }, 80);
      return true;
    }
    if (event.sender === this.#controls?.webContents) {
      if (action === 'camera-settings-init')
        return { style: this.#style, locale: this.locale };
      if (action === 'camera-settings-hide') {
        this.#controls.hide();
        return true;
      }
      if (action === 'camera-style') return this.#setStyle(raw);
      if (!['camera-drag', 'camera-move'].includes(action))
        throw new Error('Unauthorized camera settings action.');
    }
    if (action === 'camera-init')
      return { deviceId: this.deviceId, style: this.#style };
    if (action === 'camera-ready') {
      this.#ready?.();
      return true;
    }
    if (action === 'camera-error') {
      this.#error(new Error(String(raw).slice(0, 512)));
      return true;
    }
    if (action === 'camera-drag') {
      clearTimeout(this.#hideTimer);
      if (event.sender !== this.#controls?.webContents) this.#controls?.hide();
      this.#origin = this.window!.getBounds();
      return true;
    }
    if (action === 'camera-move' && this.#origin) {
      const p = raw as { dx: number; dy: number };
      if (!p || !Number.isFinite(p.dx) || !Number.isFinite(p.dy))
        throw new Error('Invalid camera movement.');
      const r = this.#origin;
      this.window!.setBounds({
        x: Math.round(
          Math.max(
            this.area.x,
            Math.min(this.area.x + this.area.width - r.width, r.x + p.dx)
          )
        ),
        y: Math.round(
          Math.max(
            this.area.y,
            Math.min(this.area.y + this.area.height - r.height, r.y + p.dy)
          )
        ),
        width: r.width,
        height: r.height,
      });
      if (this.#controls?.isVisible()) this.#positionControls();
      return true;
    }
    throw new Error('Unauthorized camera action.');
  }

  async #openControls() {
    const win = new BrowserWindow({
      width: 184,
      height: 40,
      title: 'Snapora camera settings',
      frame: false,
      thickFrame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: false,
      show: false,
      skipTaskbar: true,
      webPreferences: {
        session: this.session,
        preload: resolve(__dirname, '../recording/preload.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    this.#controls = win;
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setContentProtection(true);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    await win.loadFile(resolve(__dirname, '../overlay/camera-controls.html'));
  }

  /** The native recorder excludes this stable window ID, while retaining the camera itself. */
  get controlsWindowId(): string | undefined {
    return this.#controls?.getMediaSourceId().split(':')[1];
  }

  /** Order the window once so SCK can resolve even controls that have never been hovered. */
  async withCaptureExclusion<T>(apply: (ids: string[]) => Promise<T>): Promise<T> {
    const win = this.#controls!;
    const visible = win.isVisible();
    this.#filtering = true;
    clearTimeout(this.#hideTimer);
    if (!visible) {
      win.setOpacity(0.001);
      win.showInactive();
    }
    try {
      return await apply([this.controlsWindowId!]);
    } finally {
      this.#filtering = false;
      if (!win.isDestroyed() && !visible) {
        win.hide();
        win.setOpacity(1);
      }
    }
  }

  /** Hide preparation hover state once; hovering during recording remains available on both OSes. */
  beginRecording() {
    clearTimeout(this.#hideTimer);
    this.#controls?.hide();
  }

  #showControls() {
    const win = this.#controls;
    if (!win || win.isDestroyed() || this.#closing || !this.window?.isVisible()) return;
    if (win.isVisible()) return;
    this.#positionControls();
    win.showInactive();
    win.moveTop();
  }

  #positionControls() {
    this.#controls!.setBounds(this.window!.getBounds());
  }

  async #setStyle(raw: unknown) {
    const style = parseCameraStyle(raw);
    const win = this.window!;
    this.#origin = undefined;
    const bounds = cameraBounds(this.area, style, win.getBounds());
    // Relax the previous size constraints before applying the new fixed dimensions.
    win.setMinimumSize(1, 1);
    win.setMaximumSize(Math.ceil(this.area.width), Math.ceil(this.area.height));
    win.setBounds(bounds);
    win.setMinimumSize(bounds.width, bounds.height);
    win.setMaximumSize(bounds.width, bounds.height);
    const actual = win.getBounds();
    win.setBounds({
      ...actual,
      x: Math.max(
        this.area.x,
        Math.min(this.area.x + this.area.width - actual.width, actual.x)
      ),
      y: Math.max(
        this.area.y,
        Math.min(this.area.y + this.area.height - actual.height, actual.y)
      ),
    });
    this.#style = style;
    await win.webContents.executeJavaScript(
      `document.dispatchEvent(new CustomEvent('camera-style', { detail: ${JSON.stringify(style)} }))`
    );
    this.#positionControls();
    await this.#controls!.webContents.executeJavaScript(
      `document.body.dataset.shape = ${JSON.stringify(style.shape)}`
    );
    return style;
  }

  #error(error: Error) {
    if (!this.#closing) {
      if (this.#reject) this.#reject(error);
      else this.onError(error);
    }
  }
  close() {
    this.#closing = true;
    clearTimeout(this.#hideTimer);
    this.#controls?.destroy();
    this.#reject?.(new Error('Camera cancelled.'));
    this.window?.destroy();
  }
}
