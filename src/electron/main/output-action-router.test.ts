import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import { OVERLAY_CHANNELS } from '../protocol/channels.js';
import { SCREENSHOT_PROTOCOL_VERSION } from '../protocol/messages.js';
import { ScreenshotOutputRouter } from './output-action-router.js';

const payload = {
  protocolVersion: SCREENSHOT_PROTOCOL_VERSION,
  jobId: 'job-1',
  action: 'copy' as const,
  result: {
    status: 'completed' as const,
    data: new Uint8Array([1, 2, 3]),
    mimeType: 'image/png' as const,
    bounds: { x: 0, y: 0, width: 10, height: 10 },
    displayId: 'display-1',
  },
};

describe('ScreenshotOutputRouter', () => {
  it('routes only the active job from its expected overlay renderer', async () => {
    let invokeHandler:
      ((event: IpcMainInvokeEvent, payload: unknown) => unknown) | undefined;
    const ipcMain = {
      handle: vi.fn((channel, handler) => {
        expect(channel).toBe(OVERLAY_CHANNELS.output);
        invokeHandler = handler;
      }),
    } as unknown as Pick<IpcMain, 'handle'>;
    const router = new ScreenshotOutputRouter(ipcMain);
    const handler = vi.fn(async () => ({
      status: 'completed' as const,
      action: 'copy' as const,
    }));
    const unregister = router.register(7, 'job-1', handler);

    const expectedEvent = { sender: { id: 7 } } as IpcMainInvokeEvent;
    await expect(invokeHandler?.(expectedEvent, payload)).resolves.toEqual({
      status: 'completed',
      action: 'copy',
    });
    expect(handler).toHaveBeenCalledWith(payload, { senderWebContentsId: 7 });

    const unrelatedEvent = { sender: { id: 99 } } as IpcMainInvokeEvent;
    await expect(invokeHandler?.(unrelatedEvent, payload)).resolves.toMatchObject({
      status: 'failed',
    });
    unregister();
    await expect(invokeHandler?.(expectedEvent, payload)).resolves.toMatchObject({
      status: 'failed',
    });
  });
});
