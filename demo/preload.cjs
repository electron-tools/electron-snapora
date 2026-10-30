const { contextBridge, ipcRenderer } = require('electron');

// Define the capture and cancellation IPC channels.
const DEFAULT_HOST_CAPTURE_CHANNEL = 'electron-snapora:host:capture';
const DEFAULT_HOST_CANCEL_CHANNEL = 'electron-snapora:host:cancel';

// Demo-only preference bridge; production screenshot IPC remains unchanged.
contextBridge.exposeInMainWorld('demoSnapApi', {
  get: () => ipcRenderer.invoke('demo:get-snap-granularity'),
  set: (value) => ipcRenderer.invoke('demo:set-snap-granularity', value),
});
contextBridge.exposeInMainWorld('demoInteractionApi', {
  get: () => ipcRenderer.invoke('demo:get-interaction'),
  set: (mode) => ipcRenderer.invoke('demo:set-interaction', mode),
});
// Explicit user click is the only path that can request macOS privacy permissions.
contextBridge.exposeInMainWorld('demoMacPermissions', {
  get: () => ipcRenderer.invoke('demo:mac-permissions', false),
  request: () => ipcRenderer.invoke('demo:mac-permissions', true),
});

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
