import { contextBridge, ipcRenderer } from 'electron';

import { exposeScreenshotApi } from './host-preload.js';

// 默认 Preload 已随 npm 包打包，可直接用于保持 sandbox 开启的独立窗口。
exposeScreenshotApi({ contextBridge, ipcRenderer });
