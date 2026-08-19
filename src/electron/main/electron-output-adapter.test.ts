import { describe, expect, it, vi } from 'vitest';

import type { ScreenshotOutputPayload } from '../protocol/messages.js';
import { SCREENSHOT_PROTOCOL_VERSION } from '../protocol/messages.js';
import { ElectronOutputAdapter } from './electron-output-adapter.js';

function createPayload(action: 'save' | 'copy'): ScreenshotOutputPayload {
  return {
    protocolVersion: SCREENSHOT_PROTOCOL_VERSION,
    jobId: 'job-1',
    action,
    result: {
      status: 'completed',
      data: new Uint8Array([1, 2, 3]),
      mimeType: 'image/png',
      bounds: { x: 0, y: 0, width: 10, height: 10 },
      displayId: 'display-1',
    },
  };
}

describe('ElectronOutputAdapter', () => {
  it('copies the PNG to the Electron clipboard', async () => {
    const copyImage = vi.fn();
    const adapter = new ElectronOutputAdapter({ copyImage });

    await expect(
      adapter.execute(createPayload('copy'), { senderWebContentsId: 7 })
    ).resolves.toEqual({ status: 'completed', action: 'copy' });
    expect(copyImage).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
  });

  it('returns the selected save path or preserves the overlay when cancelled', async () => {
    let saveResult: string | undefined = 'D:\\shots\\capture.png';
    const saveFile = vi.fn(async () => saveResult);
    const adapter = new ElectronOutputAdapter({
      saveFile,
      createSuggestedName: () => 'screenshot.png',
    });
    await expect(
      adapter.execute(createPayload('save'), { senderWebContentsId: 7 })
    ).resolves.toEqual({
      status: 'completed',
      action: 'save',
      filePath: 'D:\\shots\\capture.png',
    });
    expect(saveFile).toHaveBeenCalledWith(
      new Uint8Array([1, 2, 3]),
      'screenshot.png',
      7
    );

    saveResult = undefined;
    await expect(
      adapter.execute(createPayload('save'), { senderWebContentsId: 7 })
    ).resolves.toEqual({ status: 'cancelled' });
  });
});
