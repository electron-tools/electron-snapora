function unavailable(): never {
  throw new Error('Electron runtime APIs are unavailable in unit tests.');
}

export const app = {
  whenReady: async () => undefined,
  focus: () => undefined,
  hide: () => undefined,
};

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

export const globalShortcut = {
  register: () => true,
  unregister: () => undefined,
  isRegistered: () => false,
  unregisterAll: () => undefined,
};

export const webContents = {
  fromId: () => undefined,
};

export class BrowserWindow {
  static getAllWindows(): BrowserWindow[] {
    return [];
  }

  static getFocusedWindow(): BrowserWindow | null {
    return null;
  }

  static fromWebContents(): BrowserWindow | null {
    return null;
  }

  constructor() {
    unavailable();
  }
}
