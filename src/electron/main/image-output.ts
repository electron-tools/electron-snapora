import { writeFile } from 'node:fs/promises';

import * as electron from 'electron';
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

export async function copyPngToClipboard(data: Uint8Array): Promise<void> {
  const image = nativeImage.createFromBuffer(Buffer.from(data));
  if (image.isEmpty()) {
    throw new Error('The exported PNG could not be decoded for the clipboard.');
  }
  // Electron 42/43 保留同步接口；44 起改为 ClipboardItem 异步写入。
  const legacyClipboard = clipboard as unknown as {
    writeImage?: (image: ReturnType<typeof nativeImage.createFromBuffer>) => void;
  };
  if (typeof legacyClipboard.writeImage === 'function') {
    legacyClipboard.writeImage(image);
    return;
  }

  // 使用局部类型兼容旧版 Electron 类型声明，避免静态导入新版专有导出。
  const modernElectron = electron as unknown as {
    ClipboardItem: new (data: Record<string, Blob>) => unknown;
    clipboard: { write(items: unknown[]): Promise<void> };
  };
  await modernElectron.clipboard.write([
    new modernElectron.ClipboardItem({
      'image/png': new Blob([Uint8Array.from(image.toPNG())], {
        type: 'image/png',
      }),
    }),
  ]);
}

export function createSuggestedName(): string {
  const timestamp = new Date()
    .toISOString()
    .replaceAll(':', '-')
    .replace(/\.\d{3}Z$/, '');
  return `screenshot-${timestamp}.png`;
}
