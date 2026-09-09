const { contextBridge, ipcRenderer } = require('electron');

// Define the capture and cancellation IPC channels.
const DEFAULT_HOST_CAPTURE_CHANNEL = 'electron-snapora:host:capture';
const DEFAULT_HOST_CANCEL_CHANNEL = 'electron-snapora:host:cancel';

// Expose the capture API through the sandboxed preload.
contextBridge.exposeInMainWorld('electronSnapora', {
  capture: (options) => ipcRenderer.invoke(DEFAULT_HOST_CAPTURE_CHANNEL, options),
  cancel: () => ipcRenderer.invoke(DEFAULT_HOST_CANCEL_CHANNEL),
});

// Expose the demo shortcut configuration API.
contextBridge.exposeInMainWorld('demoShortcutApi', {
  getShortcut: () => ipcRenderer.invoke('demo:get-shortcut'),
  setShortcut: (accelerator) => ipcRenderer.invoke('demo:set-shortcut', accelerator),
});
