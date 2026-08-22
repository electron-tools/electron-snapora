import { writeFile } from 'node:fs/promises';

import { clipboard, dialog, nativeImage } from 'electron';
import type { BrowserWindow, SaveDialogOptions } from 'electron';

export async function savePngWithDialog(
  data: Uint8Array,
  suggestedName: string,
  owner?: BrowserWindow | null
): Promise<string | undefined> {
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

export function copyPngToClipboard(data: Uint8Array): void {
  const image = nativeImage.createFromBuffer(Buffer.from(data));
  if (image.isEmpty()) {
    throw new Error('The exported PNG could not be decoded for the clipboard.');
  }
  clipboard.writeImage(image);
}

export function createSuggestedName(): string {
  const timestamp = new Date()
    .toISOString()
    .replaceAll(':', '-')
    .replace(/\.\d{3}Z$/, '');
  return `screenshot-${timestamp}.png`;
}
