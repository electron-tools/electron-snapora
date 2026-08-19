import { writeFile } from 'node:fs/promises';

import { BrowserWindow, clipboard, dialog, nativeImage, webContents } from 'electron';
import type { SaveDialogOptions } from 'electron';

import type {
  ScreenshotOutputPayload,
  ScreenshotOutputResponse,
} from '../protocol/messages.js';
import type { ScreenshotOutputContext } from './output-action-router.js';

export interface ElectronOutputAdapterOptions {
  saveFile?: (
    data: Uint8Array,
    suggestedName: string,
    senderWebContentsId: number
  ) => Promise<string | undefined>;
  copyImage?: (data: Uint8Array) => void;
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
  readonly #createSuggestedName: NonNullable<
    ElectronOutputAdapterOptions['createSuggestedName']
  >;

  constructor(options: ElectronOutputAdapterOptions = {}) {
    this.#saveFile = options.saveFile ?? savePngWithDialog;
    this.#copyImage = options.copyImage ?? copyPngToClipboard;
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

async function savePngWithDialog(
  data: Uint8Array,
  suggestedName: string,
  senderWebContentsId: number
): Promise<string | undefined> {
  const sender = webContents.fromId(senderWebContentsId);
  const owner = sender ? BrowserWindow.fromWebContents(sender) : null;
  const options: SaveDialogOptions = {
    title: 'Save screenshot',
    defaultPath: suggestedName,
    filters: [{ name: 'PNG image', extensions: ['png'] }],
    properties: ['createDirectory', 'showOverwriteConfirmation'],
  };
  const result = owner
    ? await dialog.showSaveDialog(owner, options)
    : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) {
    return undefined;
  }

  await writeFile(result.filePath, data);
  return result.filePath;
}

function copyPngToClipboard(data: Uint8Array): void {
  const image = nativeImage.createFromBuffer(Buffer.from(data));
  if (image.isEmpty()) {
    throw new Error('The exported PNG could not be decoded for the clipboard.');
  }
  clipboard.writeImage(image);
}

function createSuggestedName(): string {
  const timestamp = new Date()
    .toISOString()
    .replaceAll(':', '-')
    .replace(/\.\d{3}Z$/, '');
  return `screenshot-${timestamp}.png`;
}
