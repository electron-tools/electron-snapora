import { screen, type IpcMainEvent } from 'electron';
import type {
  ScreenshotBounds,
  ScreenshotResult,
  ScreenshotSnapRegion,
} from '../../types.js';
import { OVERLAY_CHANNELS } from '../protocol/channels.js';
import {
  SCREENSHOT_PROTOCOL_VERSION,
  type CaptureDisplay,
} from '../protocol/messages.js';
import {
  isCancelPayload,
  isReadyPayload,
  isPreparedPayload,
} from '../protocol/validators.js';
import {
  ScreenshotSession,
  type ScreenshotSessionOptions,
} from './screenshot-session.js';
import type { ScreenshotOverlayWindow } from './overlay-window.js';
import { toScreenshotFailure } from './errors.js';

interface Entry {
  display: CaptureDisplay;
  overlay: ScreenshotOverlayWindow;
  loaded: boolean;
  ready: boolean;
  initialized: boolean;
  presented: boolean;
}

/** Owns geometry-only selection on all screens, then delegates one selected screen to the editor. */
export class LiveScreenshotSession {
  readonly #options: ScreenshotSessionOptions;
  readonly #entries = new Map<number, Entry>();
  readonly #abort = new AbortController();
  #inner: ScreenshotSession | undefined;
  #selected: Entry | undefined;
  #settled = false;
  #started = false;
  #resolve: ((result: ScreenshotResult) => void) | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #refresh: ReturnType<typeof setTimeout> | undefined;
  #cleanups: Array<() => void> = [];
  #regions: ScreenshotSnapRegion[] = [];
  #cursorDisplayId = '';

  constructor(options: ScreenshotSessionOptions) {
    this.#options = options;
  }

  run(): Promise<ScreenshotResult> {
    if (this.#started)
      return Promise.resolve({
        status: 'failed',
        code: 'INVALID_REQUEST',
        message: 'Session already started.',
      });
    this.#started = true;
    return new Promise((resolve) => {
      this.#resolve = resolve;
      void this.#start();
    });
  }

  cancel(): boolean {
    if (this.#settled || !this.#started) return false;
    if (this.#inner) this.#inner.cancel();
    else this.#finish({ status: 'cancelled' });
    return true;
  }

  async #start(): Promise<void> {
    try {
      if (process.platform !== 'win32')
        throw new Error('Live selection is only available on Windows.');
      const requested = this.#options.captureOptions.display ?? 'cursor';
      const displays = screen.getAllDisplays();
      this.#cursorDisplayId = String(
        screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id
      );
      const id =
        requested === 'cursor'
          ? this.#cursorDisplayId
          : requested === 'primary'
            ? String(screen.getPrimaryDisplay().id)
            : requested;
      const targets = displays.filter(
        (display) => requested === 'all' || String(display.id) === id
      );
      if (!targets.length) {
        this.#finish({
          status: 'failed',
          code: 'DISPLAY_NOT_FOUND',
          message: 'The selected display is unavailable.',
        });
        return;
      }
      const ipc = this.#options.ipcMain;
      for (const [channel, handler] of [
        [OVERLAY_CHANNELS.ready, this.#ready],
        [OVERLAY_CHANNELS.selectionReady, this.#selectionReady],
        [OVERLAY_CHANNELS.selected, this.#commit],
        [OVERLAY_CHANNELS.cancel, this.#cancelMessage],
      ] as const) {
        ipc.on(channel, handler);
        this.#cleanups.push(() => ipc.removeListener(channel, handler));
      }
      screen.on('display-added', this.#topologyChanged);
      screen.on('display-removed', this.#topologyChanged);
      screen.on('display-metrics-changed', this.#metricsChanged);
      this.#cleanups.push(() => {
        screen.removeListener('display-added', this.#topologyChanged);
        screen.removeListener('display-removed', this.#topologyChanged);
        screen.removeListener('display-metrics-changed', this.#metricsChanged);
      });
      this.#timer = setTimeout(
        () =>
          this.#finish({
            status: 'failed',
            code: 'OVERLAY_LOAD_FAILED',
            message: 'Live selection windows did not initialize in time.',
          }),
        this.#options.overlayReadyTimeoutMs ?? 10000
      );
      for (const target of targets) {
        const display: CaptureDisplay = {
          id: String(target.id),
          bounds: { ...target.bounds },
          scaleFactor: target.scaleFactor,
        };
        const overlay = this.#options.createOverlay(display);
        if (
          !overlay.showSelection ||
          !overlay.nativeHandle ||
          overlay.nativeHandle === '0'
        ) {
          // The window has not entered the session map, so ordinary settlement cannot release it.
          overlay.destroy();
          throw new Error('Overlay does not support live selection.');
        }
        const entry: Entry = {
          display,
          overlay,
          loaded: false,
          ready: overlay.rendererReady ?? false,
          initialized: false,
          presented: false,
        };
        this.#entries.set(overlay.webContentsId, entry);
        this.#cleanups.push(
          overlay.onClosed(() => {
            this.cancel();
          }),
          overlay.onRendererGone(() =>
            this.#finish({
              status: 'failed',
              code: 'OVERLAY_LOAD_FAILED',
              message: 'Selection renderer exited.',
            })
          )
        );
      }
      // Native requests know the exact handles before any selection window appears.
      void this.#discover();
      await Promise.all(
        [...this.#entries.values()].map(async (entry) => {
          await entry.overlay.load();
          entry.loaded = true;
          this.#initialize(entry);
        })
      );
    } catch (error) {
      this.#finish(toScreenshotFailure(error, 'OVERLAY_LOAD_FAILED'));
    }
  }

  #entry(event: IpcMainEvent): Entry | undefined {
    if (this.#settled || event.senderFrame !== event.sender.mainFrame) return undefined;
    return this.#entries.get(event.sender.id);
  }

  #ready = (event: IpcMainEvent, payload: unknown): void => {
    const entry = this.#entry(event);
    if (!entry || !isReadyPayload(payload)) return;
    entry.ready = true;
    this.#initialize(entry);
  };

  #initialize(entry: Entry): void {
    if (
      this.#settled ||
      this.#selected ||
      !entry.ready ||
      !entry.loaded ||
      entry.initialized
    )
      return;
    entry.initialized = true;
    entry.overlay.showSelection!(
      {
        protocolVersion: SCREENSHOT_PROTOCOL_VERSION,
        jobId: this.#options.jobId,
        display: entry.display,
        options: this.#options.captureOptions,
        windowSnapRegions: this.#regions,
      },
      entry.display.id === this.#cursorDisplayId || this.#entries.size === 1
    );
  }

  #selectionReady = (event: IpcMainEvent, payload: unknown): void => {
    const entry = this.#entry(event);
    if (!entry || !isPreparedPayload(payload, this.#options.jobId)) return;
    entry.presented = true;
    // A ready window already permits cancellation; loading any other window remains bounded.
    if ([...this.#entries.values()].every((entry) => entry.presented))
      clearTimeout(this.#timer);
  };

  async #discover(): Promise<void> {
    const provider = this.#options.getWindowSnapRegions;
    if (!provider || this.#abort.signal.aborted) return;
    const previous = this.#regions;
    const update = (regions: ScreenshotSnapRegion[], complete = false) => {
      if (this.#abort.signal.aborted) return;
      this.#regions = complete ? regions : retainStableContainers(previous, regions);
      for (const entry of this.#entries.values())
        if (entry.initialized)
          entry.overlay.sendSnapRegions?.({
            protocolVersion: SCREENSHOT_PROTOCOL_VERSION,
            jobId: this.#options.jobId,
            regions: this.#regions,
          });
    };
    try {
      update(
        await provider(this.#abort.signal, update, {
          excludedWindowHandles: [...this.#entries.values()].map(
            (entry) => entry.overlay.nativeHandle!
          ),
        }),
        true
      );
    } catch {
      /* Free selection stays usable when UIA is unavailable. */
    }
    if (!this.#abort.signal.aborted)
      this.#refresh = setTimeout(() => {
        void this.#discover();
      }, 600);
  }

  #commit = (event: IpcMainEvent, raw: unknown): void => {
    const entry = this.#entry(event);
    if (
      !entry ||
      !entry.presented ||
      this.#selected ||
      !isPreparedPayload(raw, this.#options.jobId)
    )
      return;
    const payload = raw as { displayId?: unknown; selection?: unknown };
    if (
      payload.displayId !== entry.display.id ||
      !isLiveSelection(payload.selection, entry.display.bounds)
    )
      return;
    this.#selected = entry;
    clearTimeout(this.#timer);
    clearTimeout(this.#refresh);
    this.#abort.abort();
    for (const other of this.#entries.values())
      if (other !== entry) other.overlay.hide?.();
    // The existing editor performs capture only now; no full-screen pixels were read while selecting.
    const editorOptions = { ...this.#options };
    delete editorOptions.getWindowSnapRegions;
    this.#inner = new ScreenshotSession({
      ...editorOptions,
      captureOptions: { ...this.#options.captureOptions, display: entry.display.id },
      captureAdapter: {
        resolveTargetDisplay: () => entry.display,
        capture: (options, display, signal) =>
          this.#options.captureAdapter.capture(options, display, signal),
        ...(this.#options.captureAdapter.captureFallback
          ? {
              captureFallback: this.#options.captureAdapter.captureFallback.bind(
                this.#options.captureAdapter
              ),
            }
          : {}),
      },
      initialSelection: { ...payload.selection },
      createOverlay: () => entry.overlay,
      onSettled: (result) => this.#finish(result),
    });
    void this.#inner.run();
  };

  #cancelMessage = (event: IpcMainEvent, payload: unknown): void => {
    const entry = this.#entry(event);
    if (
      entry &&
      (!this.#selected || entry === this.#selected) &&
      isCancelPayload(payload, this.#options.jobId)
    )
      this.cancel();
  };

  #topologyChanged = (): void => {
    this.#finish({
      status: 'failed',
      code: 'DISPLAY_NOT_FOUND',
      message: 'Display layout changed; restart the capture.',
    });
  };

  #metricsChanged = (_event: unknown, _display: unknown, metrics: string[]): void => {
    if (
      metrics.some((metric) => ['bounds', 'scaleFactor', 'rotation'].includes(metric))
    )
      this.#topologyChanged();
  };

  #finish(result: ScreenshotResult): void {
    if (this.#settled) return;
    this.#settled = true;
    this.#abort.abort();
    clearTimeout(this.#timer);
    clearTimeout(this.#refresh);
    for (const cleanup of this.#cleanups.splice(0)) cleanup();
    this.#inner?.cancel();
    for (const entry of this.#entries.values()) {
      // The delegated editor owns its final hide/copy-feedback state after successful settlement.
      if (entry === this.#selected && result.status === 'completed') continue;
      if (entry.overlay.hide) entry.overlay.hide();
      else entry.overlay.destroy();
    }
    this.#options.onSettled?.(result);
    this.#resolve?.(result);
    this.#resolve = undefined;
  }
}

/** Validate screen-local DIP bounds without trusting renderer coordinates or display identifiers. */
export function isLiveSelection(
  value: unknown,
  display: ScreenshotBounds
): value is ScreenshotBounds {
  if (!value || typeof value !== 'object') return false;
  const r = value as ScreenshotBounds;
  return (
    [r.x, r.y, r.width, r.height].every(Number.isFinite) &&
    r.x >= 0 &&
    r.y >= 0 &&
    r.width >= 4 &&
    r.height >= 4 &&
    r.x + r.width <= display.width &&
    r.y + r.height <= display.height
  );
}

/** Keep stable-window panels during a streamed refresh; moved/removed windows lose old candidates immediately. */
export function retainStableContainers(
  previous: ScreenshotSnapRegion[],
  next: ScreenshotSnapRegion[]
): ScreenshotSnapRegion[] {
  const key = (r: ScreenshotSnapRegion) =>
    `${r.displayId}:${r.sourceProcessId}:${r.windowZOrder}:${r.x}:${r.y}:${r.width}:${r.height}`;
  const windows = new Set(next.filter((r) => r.kind === 'window').map(key));
  const stable = new Set(
    previous
      .filter((r) => r.kind === 'window' && windows.has(key(r)))
      .map((r) => `${r.displayId}:${r.sourceProcessId}:${r.windowZOrder}`)
  );
  const seen = new Set(next.map(key));
  return [
    ...next,
    ...previous.filter(
      (r) =>
        r.kind === 'container' &&
        stable.has(`${r.displayId}:${r.sourceProcessId}:${r.windowZOrder}`) &&
        !seen.has(key(r))
    ),
  ];
}
