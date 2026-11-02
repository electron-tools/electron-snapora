import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  powerMonitor,
  powerSaveBlocker,
  screen,
  session,
  systemPreferences,
} from 'electron';
import { copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import type {
  RecordingOptions,
  ScreenshotBounds,
  ScreenshotOptions,
  ScreenshotResult,
} from '../../types.js';
import type { CaptureDisplay } from '../protocol/messages.js';
import {
  controlPosition,
  preparationPosition,
  DEFAULT_MP4_SECONDS,
  MAX_GIF_SECONDS,
  parseRecordingOptions,
  recordingSize,
  RecordingClock,
} from '../../recording/policy.js';
import {
  RECORDING_CHANNEL,
  RECORDING_COMMAND,
  type RecordingInit,
} from '../../recording/protocol.js';
import { RecordingFile } from './recording-file.js';
import { createRecordingOutline } from './recording-outline.js';
import { RecordingCamera } from './recording-camera.js';
import { showRecordingCountdown } from './recording-countdown.js';
import { MacRecordingSource } from './mac-recording-source.js';
import { recordingMessages } from '../../i18n/recording.js';
import { RecordingDeviceMenu } from './recording-device-menu.js';

let recordingOwner = false;
const STOP_SHORTCUT = 'CommandOrControl+Alt+Shift+R';
const PAUSE_SHORTCUT = 'CommandOrControl+Alt+Shift+P';

/** Owns one isolated recorder window, desktop grant and recoverable spool through save/cancel. */
export class RecordingSession {
  #nativeVideo: MacRecordingSource | undefined;
  #nativeId = 0;
  #window: BrowserWindow | undefined;
  #deviceMenu: RecordingDeviceMenu | undefined;
  #outline: BrowserWindow | undefined;
  #camera: RecordingCamera | undefined;
  #changingCamera = false;
  #abort = new AbortController();
  #previewWindow: BrowserWindow | undefined;
  #barOrigin: ScreenshotBounds | undefined;
  #file: RecordingFile | undefined;
  #phase:
    'prepare' | 'arming' | 'recording' | 'paused' | 'stopping' | 'preview' | 'closed' =
    'prepare';
  #options: RecordingOptions;
  #clock: RecordingClock | undefined;
  #resolve: ((result: ScreenshotResult) => void) | undefined;
  #cleanups: Array<() => void> = [];
  #timer: ReturnType<typeof setInterval> | undefined;
  #stopTimer: ReturnType<typeof setTimeout> | undefined;
  #duration = 0;
  #lastHeartbeat = 0;
  #blocker: number | undefined;
  #finishing = false;
  #starting = false;
  #saving = false;
  #hideControls = false;
  #controlBounds: ScreenshotBounds | undefined;
  #shortcut = false;

  constructor(
    private readonly display: CaptureDisplay,
    private readonly selection: ScreenshotBounds,
    private readonly captureOptions: ScreenshotOptions,
    private readonly hideSelection: () => void = () => {}
  ) {
    this.#options = parseRecordingOptions(captureOptions.recording);
  }

  run(): Promise<ScreenshotResult> {
    if (recordingOwner)
      return Promise.resolve({
        status: 'failed',
        code: 'CAPTURE_BUSY',
        message: 'Another recording is active.',
      });
    recordingOwner = true;
    return new Promise((resolveResult) => {
      this.#resolve = resolveResult;
      void this.#open().catch((e) => this.#fail(e));
    });
  }

  cancel(): boolean {
    if (this.#phase === 'closed') return false;
    // Caller destruction must not silently throw away minutes of already recorded content.
    if (this.#file?.bytes)
      void this.#fail(new Error('Recording was interrupted by its owner.'));
    else void this.#finish({ status: 'cancelled' }, true);
    return true;
  }

  async #open(): Promise<void> {
    const ses = session.fromPartition(`snapora-recording-${randomUUID()}`, {
      cache: false,
    });
    const allowed = (wc: Electron.WebContents | null, permission: string) =>
      (wc === this.#window?.webContents &&
        permission === 'media' &&
        ['prepare', 'arming'].includes(this.#phase)) ||
      (wc === this.#window?.webContents &&
        permission === 'display-capture' &&
        ['prepare', 'arming'].includes(this.#phase)) ||
      (wc === this.#camera?.window?.webContents &&
        permission === 'media' &&
        this.#phase === 'prepare');
    ses.setPermissionCheckHandler((wc, permission) => allowed(wc, permission));
    ses.setPermissionRequestHandler((wc, permission, callback) =>
      callback(allowed(wc, permission))
    );
    ses.setDisplayMediaRequestHandler(async (request, callback) => {
      let replied = false;
      const respond = (streams: Parameters<typeof callback>[0]) => {
        if (replied) return;
        replied = true;
        try {
          callback(streams);
        } catch {
          /* Chromium may have cancelled the request with its renderer. */
        }
      };
      try {
        if (
          request.frame !== this.#window?.webContents.mainFrame ||
          !['prepare', 'arming'].includes(this.#phase)
        )
          return respond({});
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: 0, height: 0 },
        });
        const source = sources.find((s) => s.display_id === this.display.id);
        if (!source || !['prepare', 'arming'].includes(this.#phase)) return respond({});
        respond({
          video: source,
          ...(['system', 'both'].includes(this.#options.audio ?? '')
            ? { audio: 'loopback' as const }
            : {}),
        });
      } catch {
        respond({});
      }
    });
    this.#cleanups.push(() => {
      ses.setDisplayMediaRequestHandler(null);
      ses.setPermissionCheckHandler(null);
      ses.setPermissionRequestHandler(null);
    });
    this.#controlBounds = controlPosition(this.display.bounds, this.selection, 320, 52);
    this.#hideControls = !this.#controlBounds;
    const win = new BrowserWindow({
      ...preparationPosition(
        this.display.bounds,
        this.selection,
        340,
        this.#hideControls ? 200 : 156
      ),
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: false,
      show: false,
      alwaysOnTop: true,
      webPreferences: {
        preload: resolve(__dirname, '../recording/preload.cjs'),
        session: ses,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    this.#window = win;
    const outline = await createRecordingOutline(
      this.display.bounds,
      this.selection,
      ses
    );
    if (this.#finishing) {
      outline?.destroy();
      return;
    }
    this.#outline = outline;
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setContentProtection(true);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    win.on('closed', () => {
      if (!this.#finishing) this.cancel();
    });
    win.webContents.on('render-process-gone', () => {
      void this.#fail(new Error('Recording renderer exited.'));
    });
    ipcMain.handle(
      RECORDING_CHANNEL,
      async (event, action: unknown, payload: unknown) => {
        if (!this.#finishing && this.#deviceMenu?.owns(event))
          return this.#deviceMenu.request(action, payload);
        if (
          !this.#finishing &&
          typeof action === 'string' &&
          this.#camera?.owns(event)
        ) {
          if (action === 'camera-escape' && this.#phase === 'prepare')
            return this.cancel();
          return this.#camera.request(action, payload, event);
        }
        if (
          !this.#finishing &&
          event.sender === this.#previewWindow?.webContents &&
          event.senderFrame === this.#previewWindow.webContents.mainFrame
        ) {
          if (action === 'preview-init') return this.#previewData();
          if (action === 'save' || action === 'cancel')
            return this.#request(action, payload);
          throw new Error('Unauthorized preview action.');
        }
        if (
          event.sender !== win.webContents ||
          event.senderFrame !== win.webContents.mainFrame ||
          typeof action !== 'string' ||
          this.#finishing
        )
          throw new Error('Unauthorized recording request.');
        return this.#request(action, payload);
      }
    );
    this.#cleanups.push(() => ipcMain.removeHandler(RECORDING_CHANNEL));
    const displayChanged = () => this.#stopOrCancel();
    const metricsChanged = (
      _event: unknown,
      display: Electron.Display,
      metrics: string[]
    ) => {
      if (
        String(display.id) === this.display.id &&
        metrics.some((m) => ['bounds', 'scaleFactor', 'rotation'].includes(m))
      )
        displayChanged();
    };
    screen.on('display-removed', displayChanged);
    screen.on('display-metrics-changed', metricsChanged);
    powerMonitor.on('suspend', displayChanged);
    powerMonitor.on('lock-screen', displayChanged);
    this.#cleanups.push(() => {
      screen.removeListener('display-removed', displayChanged);
      screen.removeListener('display-metrics-changed', metricsChanged);
      powerMonitor.removeListener('suspend', displayChanged);
      powerMonitor.removeListener('lock-screen', displayChanged);
    });
    await win.loadFile(resolve(__dirname, '../overlay/recording.html'));
    if (!this.#finishing) win.show();
  }

  async #request(action: string, raw: unknown): Promise<unknown> {
    if (action.startsWith('native-') && process.platform === 'darwin') {
      if (action === 'native-prepare' && this.#phase === 'prepare') {
        this.#nativeVideo?.dispose();
        const source = new MacRecordingSource();
        this.#nativeVideo = source;
        const id = ++this.#nativeId;
        const size = recordingSize(
          this.selection.width * this.display.scaleFactor,
          this.selection.height * this.display.scaleFactor,
          this.#options.format ?? 'mp4'
        );
        await source.command('prepare', {
          displayId: this.display.id,
          region: this.selection,
          ...size,
          fps: this.#options.format === 'gif' ? 10 : 30,
          excludedWindowIds: [],
        });
        return { id, ...size };
      }
      const p = raw as {
        id?: number;
        sequence?: number;
        paused?: boolean;
        elapsed?: number;
      };
      if (!p || p.id !== this.#nativeId || !this.#nativeVideo) {
        if (action === 'native-release') return true;
        throw new Error('Stale native recording request.');
      }
      const source = this.#nativeVideo;
      if (action === 'native-release') {
        source.dispose();
        this.#nativeVideo = undefined;
        return true;
      }
      if (action === 'native-start' && this.#phase === 'recording') {
        const start = (excludedWindowIds: string[]) =>
          source.command('start', { excludedWindowIds });
        return this.#camera ? this.#camera.withCaptureExclusion(start) : start([]);
      }
      if (
        action === 'native-next' &&
        ['recording', 'paused', 'stopping'].includes(this.#phase)
      ) {
        if (
          p.sequence !== undefined &&
          (!Number.isInteger(p.sequence) || p.sequence < 1)
        )
          throw new Error('Invalid native frame acknowledgement.');
        return source.next(p.sequence);
      }
      if (
        action === 'native-pause' &&
        ['recording', 'paused'].includes(this.#phase) &&
        typeof p.paused === 'boolean' &&
        typeof p.elapsed === 'number' &&
        Number.isFinite(p.elapsed) &&
        p.elapsed >= 0
      )
        return source.command('pause', { paused: p.paused, elapsed: p.elapsed });
      if (
        action === 'native-stop' &&
        ['recording', 'paused', 'stopping'].includes(this.#phase)
      ) {
        await source.stop();
        return true;
      }
      throw new Error('Native recording action is unavailable.');
    }
    if (action === 'configure' && this.#phase === 'prepare' && !this.#starting) {
      const settings = parseRecordingOptions(raw);
      this.#options = {
        ...settings,
        maxMp4DurationSeconds:
          this.#options.maxMp4DurationSeconds ?? DEFAULT_MP4_SECONDS,
      };
      if (
        process.platform === 'darwin' &&
        ['microphone', 'both'].includes(settings.audio ?? '') &&
        !(await systemPreferences.askForMediaAccess('microphone'))
      )
        throw new Error('Microphone permission denied.');
      return this.#options;
    }
    if (action === 'bar-drag' && ['recording', 'paused'].includes(this.#phase)) {
      this.#window!.moveTop();
      this.#barOrigin = this.#window!.getBounds();
      return true;
    }
    if (
      action === 'bar-move' &&
      this.#barOrigin &&
      ['recording', 'paused'].includes(this.#phase)
    ) {
      const p = raw as { dx: number; dy: number };
      if (!p || !Number.isFinite(p.dx) || !Number.isFinite(p.dy))
        throw new Error('Invalid toolbar movement.');
      const d = this.display.bounds,
        r = this.selection,
        b = this.#barOrigin;
      const x = Math.round(
        Math.max(d.x, Math.min(d.x + d.width - b.width, b.x + p.dx))
      );
      const y = Math.round(
        Math.max(d.y, Math.min(d.y + d.height - b.height, b.y + p.dy))
      );
      const left = d.x + r.x,
        top = d.y + r.y;
      if (
        process.platform === 'win32' ||
        x + b.width <= left ||
        x >= left + r.width ||
        y + b.height <= top ||
        y >= top + r.height
      ) {
        this.#window!.setBounds({ x, y, width: b.width, height: b.height });
        this.#window!.moveTop();
      }
      return true;
    }
    if (
      action === 'device-permission' &&
      this.#phase === 'prepare' &&
      (raw === 'camera' || raw === 'microphone')
    ) {
      if (
        process.platform === 'darwin' &&
        !(await systemPreferences.askForMediaAccess(raw))
      )
        throw new Error(`${raw} permission denied.`);
      return true;
    }
    if (action === 'device-menu-close') {
      this.#deviceMenu?.close();
      return true;
    }
    if (action === 'device-menu' && this.#phase === 'prepare' && !this.#starting) {
      const p = raw as {
        kind: string;
        devices: Array<{ id: string; label: string }>;
        selected: string;
        x: number;
        y: number;
      };
      if (
        !p ||
        !['camera', 'microphone'].includes(p.kind) ||
        !Array.isArray(p.devices) ||
        p.devices.length > 128 ||
        typeof p.selected !== 'string' ||
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        p.devices.some(
          (d) =>
            !d ||
            typeof d.id !== 'string' ||
            d.id.length > 1024 ||
            typeof d.label !== 'string' ||
            d.label.length > 512
        )
      )
        throw new Error('Invalid device menu.');
      this.#deviceMenu?.close();
      const messages = recordingMessages(this.captureOptions.locale);
      const items = [{ id: '', label: messages.defaultDevice }, ...p.devices];
      const selected = items.some((d) => d.id === p.selected) ? p.selected : '';
      const menu = new RecordingDeviceMenu(this.#window!, this.display.bounds, p, {
        items: p.devices.length ? items : [],
        selected,
        label: `${messages.chooseDevice}: ${p.kind === 'camera' ? messages.camera : messages.microphone}`,
        empty: messages.noDevices,
        locale: this.captureOptions.locale ?? 'en',
      });
      this.#deviceMenu = menu;
      try {
        return await menu.open();
      } finally {
        if (this.#deviceMenu === menu) this.#deviceMenu = undefined;
      }
    }
    if (
      action === 'camera' &&
      this.#phase === 'prepare' &&
      !this.#starting &&
      !this.#changingCamera
    ) {
      const options = parseRecordingOptions(raw);
      this.#changingCamera = true;
      try {
        this.#camera?.close();
        this.#camera = undefined;
        if (!options.camera) return true;
        if (
          process.platform === 'darwin' &&
          !(await systemPreferences.askForMediaAccess('camera'))
        )
          throw new Error('Camera permission denied.');
        if (this.#finishing) throw new Error('Recording cancelled.');
        const camera = new RecordingCamera(
          {
            ...this.selection,
            x: this.selection.x + this.display.bounds.x,
            y: this.selection.y + this.display.bounds.y,
          },
          this.#window!.webContents.session,
          options.cameraDeviceId,
          (error) => {
            void this.#fail(error);
          },
          this.captureOptions.locale
        );
        this.#camera = camera;
        try {
          await camera.open();
        } catch (error) {
          this.#camera = undefined;
          throw error;
        }
        return true;
      } finally {
        this.#changingCamera = false;
      }
    }
    if (action === 'init')
      return {
        nativeVideo: process.platform === 'darwin',
        display: this.display,
        selection: this.selection,
        options: this.#options,
        locale: this.captureOptions.locale ?? 'en-US',
        stopShortcut: STOP_SHORTCUT,
        hideControls: this.#hideControls,
      } satisfies RecordingInit;
    if (action === 'begin') {
      if (this.#phase !== 'prepare' || this.#starting || this.#changingCamera)
        throw new Error('Recording already started.');
      this.#starting = true;
      this.#deviceMenu?.close();
      this.#window!.hide();
      const settings = parseRecordingOptions(raw);
      if (settings.camera && !this.#camera?.window)
        throw new Error('Camera is not ready.');
      this.#options = {
        ...settings,
        maxMp4DurationSeconds:
          this.#options.maxMp4DurationSeconds ?? DEFAULT_MP4_SECONDS,
      };
      if (this.#options.format === 'gif') this.#options.audio = 'none';
      if (this.#finishing) throw new Error('Recording cancelled.');
      this.#shortcut = globalShortcut.register(STOP_SHORTCUT, () =>
        this.#stopOrCancel()
      );
      if (this.#shortcut)
        this.#cleanups.push(() => globalShortcut.unregister(STOP_SHORTCUT));
      if (
        globalShortcut.register(PAUSE_SHORTCUT, () =>
          this.#window?.webContents.send(RECORDING_COMMAND, 'pause')
        )
      )
        this.#cleanups.push(() => globalShortcut.unregister(PAUSE_SHORTCUT));
      if (this.#hideControls && !this.#shortcut)
        throw new Error(
          'Stop shortcut is occupied. Select a smaller area with room for controls.'
        );
      const file = await RecordingFile.create(
        join(app.getPath('temp'), 'electron-snapora-recordings'),
        this.#options.format ?? 'mp4'
      );
      if (this.#finishing) {
        await file.discard();
        throw new Error('Recording cancelled.');
      }
      this.#file = file;
      this.#phase = 'arming';
      this.#window!.hide();
      this.hideSelection();
      this.#camera?.beginRecording();
      this.#outline?.showInactive();
      return this.#options;
    }
    if (action === 'countdown' && this.#phase === 'arming') {
      await showRecordingCountdown(
        {
          ...this.selection,
          x: this.selection.x + this.display.bounds.x,
          y: this.selection.y + this.display.bounds.y,
        },
        this.#abort.signal
      );
      return true;
    }
    if (action === 'activate' && this.#phase === 'arming') {
      if (this.#hideControls) this.#window?.hide();
      else {
        this.#window?.setBounds(this.#controlBounds!);
        this.#window?.showInactive();
        // The click-through shade/camera share the topmost band; controls must be above both.
        this.#window?.moveTop();
      }
      this.#phase = 'recording';
      this.#clock = new RecordingClock(performance.now());
      this.#lastHeartbeat = Date.now();
      this.#blocker = powerSaveBlocker.start('prevent-display-sleep');
      this.#timer = setInterval(() => {
        const limit =
          this.#options.format === 'gif'
            ? MAX_GIF_SECONDS
            : this.#options.maxMp4DurationSeconds!;
        if (this.#clock!.seconds(performance.now()) >= limit) this.#stopOrCancel();
        if (Date.now() - this.#lastHeartbeat > 15000)
          void this.#fail(new Error('Recording encoder stopped responding.'));
      }, 250);
      return true;
    }
    if (action === 'heartbeat') {
      this.#lastHeartbeat = Date.now();
      return true;
    }
    if (
      action === 'paused' &&
      typeof raw === 'boolean' &&
      ['recording', 'paused'].includes(this.#phase)
    ) {
      this.#phase = raw ? 'paused' : 'recording';
      if (raw) this.#clock?.pause(performance.now());
      else this.#clock?.resume(performance.now());
      return true;
    }
    if (
      action === 'write' &&
      ['recording', 'paused', 'stopping'].includes(this.#phase)
    ) {
      const chunk = raw as { data: Uint8Array; offset: number };
      await this.#file!.append(chunk?.data, chunk?.offset);
      return true;
    }
    if (
      action === 'stopping' &&
      ['recording', 'paused', 'stopping'].includes(this.#phase)
    ) {
      this.#duration = Math.min(
        this.#clock!.seconds(performance.now()),
        this.#options.format === 'gif'
          ? MAX_GIF_SECONDS
          : (this.#options.maxMp4DurationSeconds ?? DEFAULT_MP4_SECONDS)
      );
      this.#phase = 'stopping';
      this.#outline?.hide();
      clearInterval(this.#timer);
      this.#stopTimer ??= setTimeout(() => {
        void this.#fail(new Error('Recording finalization timed out.'));
      }, 30000);
      return true;
    }
    if (action === 'complete' && this.#phase === 'stopping') {
      this.#camera?.close();
      this.#camera = undefined;
      await this.#file!.close();
      if (!this.#file!.bytes) throw new Error('Recording contains no data.');
      clearTimeout(this.#stopTimer);
      this.#releaseBlocker();
      this.#phase = 'preview';
      this.#window!.hide();
      const preview = new BrowserWindow({
        x: this.display.bounds.x + 40,
        y: this.display.bounds.y + 40,
        width: Math.min(760, this.display.bounds.width - 80),
        height: Math.min(560, this.display.bounds.height - 80),
        title: this.captureOptions.locale?.startsWith('zh')
          ? '录制预览'
          : 'Recording preview',
        backgroundColor: '#f6f7f9',
        show: false,
        autoHideMenuBar: true,
        webPreferences: {
          session: this.#window!.webContents.session,
          preload: resolve(__dirname, '../recording/preload.cjs'),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      this.#previewWindow = preview;
      preview.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      preview.webContents.on('will-navigate', (e) => e.preventDefault());
      preview.on('closed', () => {
        if (!this.#finishing) void this.#finish({ status: 'cancelled' }, true);
      });
      await preview.loadFile(resolve(__dirname, '../overlay/recording-preview.html'));
      if (!this.#finishing) preview.show();
      return this.#previewData();
    }
    if (action === 'save' && this.#phase === 'preview' && !this.#saving) {
      this.#saving = true;
      try {
        const format = this.#options.format ?? 'mp4';
        const result = await dialog.showSaveDialog(
          this.#previewWindow ?? this.#window!,
          {
            defaultPath: `Recording-${Date.now()}.${format}`,
            filters: [{ name: format.toUpperCase(), extensions: [format] }],
          }
        );
        if (result.canceled || !result.filePath || this.#finishing) return false;
        await copyFile(this.#file!.path, result.filePath);
        await this.#finish(
          {
            status: 'recorded',
            filePath: result.filePath,
            format,
            mimeType: format === 'mp4' ? 'video/mp4' : 'image/gif',
            durationSeconds: this.#duration,
            bytes: this.#file!.bytes,
            displayId: this.display.id,
            bounds: {
              ...this.selection,
              x: this.selection.x + this.display.bounds.x,
              y: this.selection.y + this.display.bounds.y,
            },
          },
          true
        );
        return true;
      } finally {
        this.#saving = false;
      }
    }
    if (action === 'cancel') {
      await this.#finish({ status: 'cancelled' }, true);
      return true;
    }
    if (action === 'fail') {
      await this.#fail(new Error(String(raw).slice(0, 1024)));
      return true;
    }
    throw new Error('Invalid recording action for current state.');
  }

  #stopOrCancel(): void {
    if (['recording', 'paused'].includes(this.#phase)) {
      this.#window?.webContents.send(RECORDING_COMMAND, 'stop');
      this.#stopTimer ??= setTimeout(() => {
        void this.#fail(new Error('Recording stop timed out.'));
      }, 30000);
    } else if (this.#phase === 'prepare' || this.#phase === 'arming') this.cancel();
  }

  async #fail(error: unknown): Promise<void> {
    await this.#finish(
      {
        status: 'failed',
        code: 'CAPTURE_FAILED',
        message: error instanceof Error ? error.message : String(error),
        ...(this.#file?.bytes ? { recoveryPath: this.#file.path } : {}),
      },
      !this.#file?.bytes
    );
  }

  #previewData() {
    return {
      url: pathToFileURL(this.#file!.path).href,
      bytes: this.#file!.bytes,
      durationSeconds: this.#duration,
      format: this.#options.format ?? 'mp4',
      locale: this.captureOptions.locale ?? 'en-US',
    };
  }

  #releaseBlocker() {
    if (this.#blocker !== undefined) {
      powerSaveBlocker.stop(this.#blocker);
      this.#blocker = undefined;
    }
  }

  async #finish(result: ScreenshotResult, discard: boolean): Promise<void> {
    if (this.#finishing) return;
    this.#finishing = true;
    this.#deviceMenu?.close();
    this.#nativeVideo?.dispose();
    this.#nativeVideo = undefined;
    this.#phase = 'closed';
    this.#abort.abort();
    clearInterval(this.#timer);
    clearTimeout(this.#stopTimer);
    this.#releaseBlocker();
    for (const cleanup of this.#cleanups.splice(0)) cleanup();
    this.#window?.destroy();
    this.#previewWindow?.destroy();
    this.#outline?.destroy();
    this.#camera?.close();
    this.#camera = undefined;
    try {
      if (discard) await this.#file?.discard();
      else await this.#file?.close();
    } catch {
      /* Preserve the original failure and the spool path for manual recovery. */
    }
    recordingOwner = false;
    this.#resolve?.(result);
  }
}
