# electron-snapora — Capturas y anotaciones para Electron

[![npm version](https://img.shields.io/npm/v/electron-snapora?style=flat-square&color=cb3837)](https://www.npmjs.com/package/electron-snapora)
[![npm total downloads](https://img.shields.io/npm/dt/electron-snapora?style=flat-square&color=blue)](https://www.npmjs.com/package/electron-snapora)
[![npm monthly downloads](https://img.shields.io/npm/dm/electron-snapora?style=flat-square&color=2088FF)](https://www.npmjs.com/package/electron-snapora)
[![CI Status](https://img.shields.io/github/actions/workflow/status/electron-tools/electron-snapora/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/electron-tools/electron-snapora/actions)
[![Electron Version](https://img.shields.io/badge/Electron-%3E%3D42-47848F?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Zero Native Addons](https://img.shields.io/badge/Native%20Addons-0-success?style=flat-square)](https://github.com/electron-tools/electron-snapora)
[![License](https://img.shields.io/npm/l/electron-snapora?style=flat-square)](https://github.com/electron-tools/electron-snapora/blob/main/LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/electron-tools/electron-snapora?style=flat-square)](https://github.com/electron-tools/electron-snapora/stargazers)

[English](https://github.com/electron-tools/electron-snapora/blob/main/README.md) | [简体中文](https://github.com/electron-tools/electron-snapora/blob/main/README.zh-CN.md) | [日本語](https://github.com/electron-tools/electron-snapora/blob/main/README.ja.md) | [한국어](https://github.com/electron-tools/electron-snapora/blob/main/README.ko.md) | Español

Añade captura por región, selección interactiva, anotaciones, copia al portapapeles y exportación PNG a aplicaciones Electron.

<p align="center">
  <img src="./docs/assets/preview.jpg" alt="electron-snapora preview" width="800" />
</p>

## Funciones

- Captura de regiones rectangulares mediante una superposición interactiva.
- Anotaciones con rectángulos, elipses, flechas, pincel, texto, mosaico ajustable y marca de agua.
- Deshacer, rehacer, copiar, guardar PNG de forma nativa y fijar capturas en pantalla.
- Compatible con TypeScript, ESM y CommonJS.
- Sin complementos nativos ni compilación posterior a la instalación.

## Inicio rápido

Requisitos: Node.js 20 o posterior y Electron 42 o posterior.

### 1. Instalar

```bash
npm install electron-snapora
```

Mantén el paquete en las `dependencies` de producción de la aplicación.

### 2. Configurar el proceso principal

```ts
import { app, BrowserWindow, ipcMain } from 'electron';
import { setupElectronSnapora } from 'electron-snapora/main';

app.whenReady().then(() => {
  const snapora = setupElectronSnapora({ ipcMain });
  const mainWindow = new BrowserWindow({
    webPreferences: {
      preload: snapora.preloadPath,
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.loadFile('index.html');
  app.once('before-quit', snapora.unregister);
});
```

### 3. Capturar desde el Renderer

```ts
const result = await window.electronSnapora.capture({ display: 'cursor' });

if (result.status === 'completed') {
  console.log(result.data, result.bounds, result.output);
}
```

`result.data` contiene los bytes PNG. Una cancelación devuelve `cancelled` y un error devuelve `failed`.

## Aplicaciones con un Preload existente

Expón la API desde el Preload de la aplicación y empaqueta ese Preload con la herramienta de compilación del host.

```ts
import { contextBridge, ipcRenderer } from 'electron';
import { exposeScreenshotApi } from 'electron-snapora/preload';

exposeScreenshotApi({ contextBridge, ipcRenderer });
```

## Empaquetado

Al empaquetar el proceso principal de Electron, mantén `electron-snapora` como external y como dependencia de producción. Así se instalarán los archivos HTML, CSS y Preload del Overlay junto con la aplicación.

Consulta la [documentación completa en inglés](https://github.com/electron-tools/electron-snapora/blob/main/README.md) para temas, localización, validación del origen IPC, cola de concurrencia, diagnóstico y configuración de empaquetadores.

Repositorio: [github.com/electron-tools/electron-snapora](https://github.com/electron-tools/electron-snapora)

Licencia: [MIT](https://github.com/electron-tools/electron-snapora/blob/main/LICENSE)
