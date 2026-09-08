const { contextBridge, ipcRenderer } = require('electron');

// electron-snapora 预设 IPC 通信通道
const DEFAULT_HOST_CAPTURE_CHANNEL = 'electron-snapora:host:capture';
const DEFAULT_HOST_CANCEL_CHANNEL = 'electron-snapora:host:cancel';

// 暴露 electronSnapora 截图 API（兼容沙箱环境，无需 node:path）
contextBridge.exposeInMainWorld('electronSnapora', {
  capture: (options) => ipcRenderer.invoke(DEFAULT_HOST_CAPTURE_CHANNEL, options),
  cancel: () => ipcRenderer.invoke(DEFAULT_HOST_CANCEL_CHANNEL),
});

// 暴露 demo 专属的全局快捷键配置 API
contextBridge.exposeInMainWorld('demoShortcutApi', {
  getShortcut: () => ipcRenderer.invoke('demo:get-shortcut'),
  setShortcut: (accelerator) => ipcRenderer.invoke('demo:set-shortcut', accelerator),
});
