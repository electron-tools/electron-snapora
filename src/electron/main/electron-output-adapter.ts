import { BrowserWindow, webContents } from 'electron';

import type { ScreenshotOptions } from '../../types.js';
import type {
  ScreenshotOutputPayload,
  ScreenshotOutputResponse,
} from '../protocol/messages.js';
import type { ScreenshotOutputContext } from './output-action-router.js';
import {
  copyPngToClipboard,
  createSuggestedName,
  savePngWithDialog,
} from './image-output.js';
import { PinnedWindowManager } from './pinned-window.js';

export interface ElectronOutputAdapterOptions {
  saveFile?: (
    data: Uint8Array,
    suggestedName: string,
    senderWebContentsId: number
  ) => Promise<string | undefined>;
  copyImage?: (data: Uint8Array) => void;
  pinImage?: (
    result: ScreenshotOutputPayload['result'],
    options: ScreenshotOptions
  ) => Promise<void>;
  createSuggestedName?: () => string;
}

export interface ScreenshotOutputExecutor {
  execute(
    payload: ScreenshotOutputPayload,
    context: ScreenshotOutputContext
  ): Promise<ScreenshotOutputResponse>;
}

export class ElectronOutputAdapter implements ScreenshotOutputExecutor {
  readonly #saveFile: NonNullable<ElectronOutputAdapterOptions['saveFile']>;
  readonly #copyImage: NonNullable<ElectronOutputAdapterOptions['copyImage']>;
  readonly #pinImage: NonNullable<ElectronOutputAdapterOptions['pinImage']>;
  readonly #createSuggestedName: NonNullable<
    ElectronOutputAdapterOptions['createSuggestedName']
  >;

  constructor(options: ElectronOutputAdapterOptions = {}) {
    this.#saveFile =
      options.saveFile ??
      ((data, suggestedName, senderWebContentsId) =>
        savePngWithDialog(
          data,
          suggestedName,
          resolveOwnerWindow(senderWebContentsId)
        ));
    this.#copyImage = options.copyImage ?? copyPngToClipboard;
    let pinnedWindows: PinnedWindowManager | undefined;
    this.#pinImage =
      options.pinImage ??
      ((result, captureOptions) => {
        pinnedWindows ??= new PinnedWindowManager();
        return pinnedWindows.pin(result, captureOptions);
      });
    this.#createSuggestedName = options.createSuggestedName ?? createSuggestedName;
  }

  async execute(
    payload: ScreenshotOutputPayload,
    context: ScreenshotOutputContext
  ): Promise<ScreenshotOutputResponse> {
    if (payload.action === 'copy') {
      this.#copyImage(payload.result.data);
      return { status: 'completed', action: 'copy' };
    }

    if (payload.action === 'pin') {
      await this.#pinImage(payload.result, context.captureOptions ?? {});
      return { status: 'completed', action: 'pin' };
    }

    const filePath = await this.#saveFile(
      payload.result.data,
      this.#createSuggestedName(),
      context.senderWebContentsId
    );
    return filePath
      ? { status: 'completed', action: 'save', filePath }
      : { status: 'cancelled' };
  }
}

function resolveOwnerWindow(senderWebContentsId: number): BrowserWindow | null {
  const sender = webContents.fromId(senderWebContentsId);
  return sender ? BrowserWindow.fromWebContents(sender) : null;
}
