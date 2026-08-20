import { EventEmitter } from 'node:events';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./resource-paths.js', () => ({
  resolveHostPreloadPath: () =>
    'C:\\app\\node_modules\\electron-snapora\\dist\\preload\\auto.cjs',
}));

import {
  DEFAULT_HOST_CANCEL_CHANNEL,
  DEFAULT_HOST_CAPTURE_CHANNEL,
} from '../protocol/channels.js';
import { ScreenshotManager } from './screenshot-manager.js';
import { registerScreenshotIpc, setupElectronSnapora } from './register-host-ipc.js';

type CaptureHandler = (event: IpcMainInvokeEvent, options: unknown) => unknown;

function createHarness(validateSender?: (event: IpcMainInvokeEvent) => boolean): {
  capture: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  handler: (channel?: string) => CaptureHandler;
  unregister: () => void;
  removeHandler: ReturnType<typeof vi.fn>;
} {
  const registeredHandlers = new Map<string, CaptureHandler>();
  const removeHandler = vi.fn();
  const ipcMain = {
    handle: vi.fn((channel: string, handler: CaptureHandler) => {
      registeredHandlers.set(channel, handler);
    }),
    removeHandler,
  } as unknown as IpcMain;
  const capture = vi.fn(async () => ({ status: 'cancelled' as const }));
  const cancel = vi.fn(() => true);
  const manager = { capture, cancel } as unknown as ScreenshotManager;
  const unregister = registerScreenshotIpc({
    ipcMain,
    manager,
    ...(validateSender ? { validateSender } : {}),
  });

  return {
    capture,
    cancel,
    handler: (channel = DEFAULT_HOST_CAPTURE_CHANNEL) => {
      const registeredHandler = registeredHandlers.get(channel);
      if (!registeredHandler) {
        throw new Error(`Handler was not registered for ${channel}.`);
      }
      return registeredHandler;
    },
    unregister,
    removeHandler,
  };
}

function createEvent(url: string, mainFrame = true): IpcMainInvokeEvent {
  const topFrame = { url };
  const sender = Object.assign(new EventEmitter(), { id: 7, mainFrame: topFrame });
  return {
    sender,
    senderFrame: mainFrame ? topFrame : { url },
  } as unknown as IpcMainInvokeEvent;
}

describe('registerScreenshotIpc', () => {
  it('allows a top-level local file and forwards only parsed options', async () => {
    const harness = createHarness();
    const result = await harness.handler()(createEvent('file:///app/index.html'), {
      display: 'primary',
      tools: ['text', 'text'],
      locale: 'zh-CN',
    });

    expect(result).toEqual({ status: 'cancelled' });
    expect(harness.capture).toHaveBeenCalledWith(
      { display: 'primary', tools: ['text'], locale: 'zh-CN' },
      { senderWebContentsId: 7 }
    );
    harness.unregister();
    expect(harness.removeHandler).toHaveBeenCalledWith(DEFAULT_HOST_CAPTURE_CHANNEL);
    expect(harness.removeHandler).toHaveBeenCalledWith(DEFAULT_HOST_CANCEL_CHANNEL);
  });

  it('rejects remote pages and subframes before capture starts', async () => {
    const harness = createHarness();

    await expect(
      harness.handler()(createEvent('https://example.com'), {})
    ).resolves.toMatchObject({ status: 'failed', code: 'INVALID_REQUEST' });
    await expect(
      harness.handler()(createEvent('file:///app/frame.html', false), {})
    ).resolves.toMatchObject({ status: 'failed', code: 'INVALID_REQUEST' });
    expect(harness.capture).not.toHaveBeenCalled();
  });

  it('allows an authorized custom protocol but still rejects its subframes', async () => {
    const validateSender = vi.fn((event: IpcMainInvokeEvent) => {
      const senderUrl = event.senderFrame?.url;
      return senderUrl ? new URL(senderUrl).protocol === 'app:' : false;
    });
    const harness = createHarness(validateSender);

    await expect(
      harness.handler()(createEvent('app://shell/index.html'), {})
    ).resolves.toEqual({ status: 'cancelled' });
    await expect(
      harness.handler()(createEvent('app://shell/frame.html', false), {})
    ).resolves.toMatchObject({ status: 'failed', code: 'INVALID_REQUEST' });
    expect(harness.capture).toHaveBeenCalledTimes(1);
    expect(validateSender).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed options without calling the manager', async () => {
    const harness = createHarness();

    await expect(
      harness.handler()(createEvent('file:///app/index.html'), { locale: 'fr-FR' })
    ).resolves.toMatchObject({ status: 'failed', code: 'INVALID_REQUEST' });
    expect(harness.capture).not.toHaveBeenCalled();
  });

  it('cancels only through an authorized top-level host renderer', async () => {
    const harness = createHarness();
    const cancelHandler = harness.handler(DEFAULT_HOST_CANCEL_CHANNEL);

    await expect(
      cancelHandler(createEvent('file:///app/index.html'), undefined)
    ).resolves.toBe(true);
    await expect(
      cancelHandler(createEvent('https://example.com'), undefined)
    ).resolves.toBe(false);
    await expect(
      cancelHandler(createEvent('file:///app/frame.html', false), undefined)
    ).resolves.toBe(false);
    expect(harness.cancel).toHaveBeenCalledTimes(1);
    expect(harness.cancel).toHaveBeenCalledWith(7);
  });

  it('cancels an active task when its host WebContents is destroyed', async () => {
    const harness = createHarness();
    let finishCapture: (() => void) | undefined;
    harness.capture.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishCapture = () => resolve({ status: 'cancelled' as const });
        })
    );
    const event = createEvent('file:///app/index.html');
    const result = harness.handler()(event, {});

    event.sender.emit('destroyed');
    expect(harness.cancel).toHaveBeenCalledWith(7);
    finishCapture?.();
    await expect(result).resolves.toEqual({ status: 'cancelled' });
  });
});

describe('setupElectronSnapora', () => {
  it('creates the manager, registers IPC, and returns the bundled preload path', () => {
    const handlers = new Map<string, CaptureHandler>();
    const removeHandler = vi.fn();
    const ipcMain = {
      handle: vi.fn((channel: string, handler: CaptureHandler) => {
        handlers.set(channel, handler);
      }),
      removeHandler,
    } as unknown as IpcMain;

    const snapora = setupElectronSnapora({
      ipcMain,
      managerOptions: {
        runner: async () => ({ status: 'cancelled' }),
      },
    });

    expect(snapora.manager).toBeInstanceOf(ScreenshotManager);
    expect(snapora.preloadPath).toBe(
      'C:\\app\\node_modules\\electron-snapora\\dist\\preload\\auto.cjs'
    );
    expect(handlers.has(DEFAULT_HOST_CAPTURE_CHANNEL)).toBe(true);
    expect(handlers.has(DEFAULT_HOST_CANCEL_CHANNEL)).toBe(true);

    snapora.unregister();
    expect(removeHandler).toHaveBeenCalledWith(DEFAULT_HOST_CAPTURE_CHANNEL);
    expect(removeHandler).toHaveBeenCalledWith(DEFAULT_HOST_CANCEL_CHANNEL);
  });
});
