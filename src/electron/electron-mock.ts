function unavailable(): never {
  throw new Error('Electron runtime APIs are unavailable in unit tests.');
}

export const desktopCapturer = {
  getSources: unavailable,
};

export const screen = {
  getAllDisplays: unavailable,
  getCursorScreenPoint: unavailable,
  getDisplayNearestPoint: unavailable,
  getPrimaryDisplay: unavailable,
};

export const systemPreferences = {
  getMediaAccessStatus: unavailable,
};

export const shell = {
  openExternal: unavailable,
};

export const ipcMain = {
  on: unavailable,
  removeListener: unavailable,
};

export const webContents = {
  fromId: unavailable,
};

export class BrowserWindow {
  static getAllWindows(): BrowserWindow[] {
    return [];
  }

  constructor() {
    unavailable();
  }
}
