import type { ContextBridge, IpcRenderer } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_HOST_CANCEL_CHANNEL,
  DEFAULT_HOST_CAPTURE_CHANNEL,
} from '../protocol/channels.js';
import { exposeScreenshotApi } from './host-preload.js';

function createHarness() {
  const exposeInMainWorld = vi.fn();
  const invoke = vi.fn(async () => ({ status: 'cancelled' as const }));
  return {
    exposeInMainWorld,
    invoke,
    options: {
      contextBridge: { exposeInMainWorld } as unknown as ContextBridge,
      ipcRenderer: { invoke } as unknown as IpcRenderer,
    },
  };
}

describe('exposeScreenshotApi', () => {
  it('exposes capture and cancel through the default host channels', async () => {
    const harness = createHarness();
    const api = exposeScreenshotApi(harness.options);

    expect(harness.exposeInMainWorld).toHaveBeenCalledWith('electronSnapora', api);
    await api.capture({ locale: 'zh-CN' });
    await api.cancel();
    expect(harness.invoke).toHaveBeenNthCalledWith(1, DEFAULT_HOST_CAPTURE_CHANNEL, {
      locale: 'zh-CN',
    });
    expect(harness.invoke).toHaveBeenNthCalledWith(2, DEFAULT_HOST_CANCEL_CHANNEL);
  });

  it('derives a matching cancel channel from a custom capture channel', async () => {
    const harness = createHarness();
    const api = exposeScreenshotApi({
      ...harness.options,
      globalName: 'snapora',
      channel: 'app:screenshot',
    });

    expect(harness.exposeInMainWorld).toHaveBeenCalledWith('snapora', api);
    await api.cancel();
    expect(harness.invoke).toHaveBeenCalledWith('app:screenshot:cancel');
  });

  it('uses an explicitly configured cancel channel', async () => {
    const harness = createHarness();
    const api = exposeScreenshotApi({
      ...harness.options,
      channel: 'app:screenshot',
      cancelChannel: 'app:screenshot:abort',
    });

    await api.cancel();
    expect(harness.invoke).toHaveBeenCalledWith('app:screenshot:abort');
  });
});
