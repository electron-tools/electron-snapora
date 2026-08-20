# electron-snapora — Capturas y anotaciones para Electron

[English](https://github.com/electron-tools/electron-snapora/blob/main/README.md) | [简体中文](https://github.com/electron-tools/electron-snapora/blob/main/README.zh-CN.md) | [日本語](https://github.com/electron-tools/electron-snapora/blob/main/README.ja.md) | [한국어](https://github.com/electron-tools/electron-snapora/blob/main/README.ko.md) | Español

Añade captura por región, selección interactiva, anotaciones, copia al portapapeles y exportación PNG a aplicaciones Electron.

## Funciones

- Captura de regiones rectangulares mediante una superposición interactiva.
- Anotaciones con rectángulos, elipses, flechas, pincel, texto y mosaico.
- Deshacer, rehacer, copiar al portapapeles y guardar PNG de forma nativa.
- Compatible con TypeScript, ESM y CommonJS.
- Sin complementos nativos ni compilación posterior a la instalación.

## Inicio rápido

Requisitos: Node.js 20 o posterior y Electron `>=42 <44`.

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
