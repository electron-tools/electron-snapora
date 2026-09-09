# electron-snapora — Capturas y anotaciones para Electron

[![npm version](https://img.shields.io/npm/v/electron-snapora?style=flat-square&color=cb3837)](https://www.npmjs.com/package/electron-snapora)
[![npm total downloads](https://img.shields.io/npm/dt/electron-snapora?style=flat-square&color=blue)](https://www.npmjs.com/package/electron-snapora)
[![npm monthly downloads](https://img.shields.io/npm/dm/electron-snapora?style=flat-square&color=2088FF)](https://www.npmjs.com/package/electron-snapora)
[![License](https://img.shields.io/npm/l/electron-snapora?style=flat-square)](https://github.com/electron-tools/electron-snapora/blob/main/LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square)](https://github.com/electron-tools/electron-snapora)
[![Modules](https://img.shields.io/badge/Modules-ESM%20%7C%20CJS-informational?style=flat-square)](https://github.com/electron-tools/electron-snapora)
[![Electron Version](https://img.shields.io/badge/Electron-%3E%3D42-47848F?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Zero Native Addons](https://img.shields.io/badge/Native%20Addons-0-success?style=flat-square)](https://github.com/electron-tools/electron-snapora)
[![CI Status](https://img.shields.io/github/actions/workflow/status/electron-tools/electron-snapora/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/electron-tools/electron-snapora/actions)

[English](https://github.com/electron-tools/electron-snapora/blob/main/README.md) | [简体中文](https://github.com/electron-tools/electron-snapora/blob/main/README.zh-CN.md) | [日本語](https://github.com/electron-tools/electron-snapora/blob/main/README.ja.md) | [한국어](https://github.com/electron-tools/electron-snapora/blob/main/README.ko.md) | Español

Una biblioteca de capturas de pantalla para Electron con configuración en una línea, IPC seguro mediante Preload, selección por región, anotaciones interactivas, copia al portapapeles, exportación PNG y ventanas fijas en pantalla.

<p align="center">
  <img src="./docs/assets/preview.jpg" alt="electron-snapora preview" width="800" />
</p>

## Características principales

- **Captura por región**：Captura de pantalla por pantalla seleccionada o posición del cursor.
- **Superposición interactiva**：Selección libre mediante arrastre y 8 manejadores de redimensionamiento.
- **Herramientas de anotación**：Rectángulos, elipses, flechas, pincel, texto (estilos estándar/fondo relleno/trazo), mosaico regulable y marca de agua.
- **Experiencia fluida**：Arrastra anotaciones existentes directamente sin salir de la herramienta de dibujo activa.
- **Salida y fijación**：Copia al portapapeles, guardado PNG nativo y ventanas flotantes fijadas siempre visibles.
- **Ventana fija escalable**：Siempre visible en el nivel superior, redimensionamiento proporcional por arrastre y menú contextual.
- **Soporte para TypeScript, ESM y CommonJS**：Tipos integrados.
- **Cero dependencias nativas (Zero Native Addons)**：Sin módulos C++ nativos ni compilación posterior a la instalación.

Repositorio: [github.com/electron-tools/electron-snapora](https://github.com/electron-tools/electron-snapora)  
Soporte: [GitHub Issues](https://github.com/electron-tools/electron-snapora/issues) · [@novratools on X](https://x.com/novratools)  
Política de marcas: [TRADEMARKS.md](https://github.com/electron-tools/electron-snapora/blob/main/TRADEMARKS.md)

## Inicio rápido

**Requisitos mínimos:** Electron 42 o posterior, Node.js 20 o posterior.

### 1. Instalación

```bash
npm install electron-snapora
```

Si la aplicación host no tiene Electron instalado:

```bash
npm install --save-dev electron
```

### 2. Configuración en el proceso principal

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

Devuelve `cancelled` si el usuario cancela o `failed` si se produce un error.

Para cancelar una tarea de captura en curso desde el mismo Renderer:

```ts
await window.electronSnapora.cancel();
```

Declaración de tipos para TypeScript:

```ts
import type { ScreenshotRendererApi } from 'electron-snapora/types';

declare global {
  interface Window {
    electronSnapora: ScreenshotRendererApi;
  }
}
```

## Aplicaciones con un Preload existente

Si la aplicación tiene su propio script Preload, ignora `snapora.preloadPath` y expón la API dentro de tu Preload:

```ts
import { contextBridge, ipcRenderer } from 'electron';
import { exposeScreenshotApi } from 'electron-snapora/preload';

exposeScreenshotApi({ contextBridge, ipcRenderer });
```

## Validación del origen del remitente

```ts
const snapora = setupElectronSnapora({
  ipcMain,
  validateSender(event) {
    const senderUrl = event.senderFrame?.url;
    if (!senderUrl) return false;

    const url = new URL(senderUrl);
    return (
      url.protocol === 'app:' ||
      (process.env.NODE_ENV === 'development' && url.origin === 'http://localhost:5173')
    );
  },
});
```

## Configuración avanzada

### Temas y localización

```ts
await window.electronSnapora.capture({
  locale: 'es-ES',
  theme: {
    mode: 'dark',
    accentColor: '#0a84ff',
  },
});
```

### Límites de recursos

```ts
const snapora = setupElectronSnapora({
  ipcMain,
  managerOptions: {
    resourceLimits: {
      maxCapturePixels: 32 * 1024 * 1024,
      maxCaptureDataUrlBytes: 96 * 1024 * 1024,
      maxOutputBytes: 32 * 1024 * 1024,
    },
  },
});
```

## Empaquetado y compilación

Al empaquetar el proceso principal, mantén `electron-snapora` como external (compatible con electron-vite, Webpack, electron-builder y Forge).

## Atajos de macOS y protección de las ventanas del host

El host registra el atajo global que inicia la captura. Dentro de la superposición, Snapora procesa Escape, R (rectángulo), T (texto) y las demás teclas de edición. En macOS, al mostrar la superposición, restaura su capacidad de recibir el foco y solicita el foco de la aplicación, la ventana y el contenido web. El host no necesita repetir estas llamadas ni registrar Escape/R/T como atajos globales.

**La protección de ventanas del host es opcional.** Si el host ya gestiona el foco o impide que sus ventanas en segundo plano pasen al frente, respete estas reglas:

- Modifique solo las ventanas propias del host mediante referencias explícitas o una colección mantenida por el host. No aplique `setFocusable(false)` a todas las ventanas devueltas por `BrowserWindow.getAllWindows()`: también incluye ventanas de Snapora, como las superposiciones ocultas que se reutilizan en capturas posteriores. Excluya las superposiciones, las imágenes fijadas y las notificaciones de copia.
- Limite la protección específica de macOS a una rama `process.platform === 'darwin'` para mantener el comportamiento de Windows. Compruebe la actividad de la aplicación con `app.isActive()`; si una ventana de ajustes o de reunión tiene el foco, el host también está activo aunque su ventana principal no lo esté.
- Compruebe `manager.activeJobId` antes de modificar el estado de las ventanas. Si añade una restauración asíncrona del foco alrededor de `capture()`, evite también las ejecuciones duplicadas durante toda la operación de captura y restauración.
- Registre el estado original y restaure los cambios en `finally`, incluso tras cancelaciones o errores. Restaure solo las ventanas que sigan existiendo y que esta operación haya modificado. Evite que las llamadas diferidas de una captura alteren el estado de la siguiente.

Snapora no llama a `app.hide()` al finalizar una captura, porque ocultaría todas las ventanas de la aplicación, incluidas las del host y las imágenes fijadas. Solo devuelve el foco a la ventana del host si esta lo tenía antes de capturar. Volver a la aplicación externa que estaba activa es una decisión del host; Snapora no proporciona restauración automática de aplicaciones externas. No utilice `app.hide()` como paso general de limpieza.

Si la superposición es visible pero las teclas no responden, compruebe `app.isActive()`, `isFocusable()` e `isFocused()` de la superposición, `webContents.isFocused()` y si `before-input-event` llega a ella. La visibilidad no demuestra que exista foco de teclado, y `before-input-event` no puede recibir teclas que nunca llegaron a ese WebContents. Si la primera captura funciona pero la segunda falla, revise si la protección del host deshabilitó el foco de la superposición reutilizada. Valide la primera captura y las capturas consecutivas en un Mac real con otra aplicación en primer plano; las llamadas a las API de foco no bastan para confirmar la recepción del teclado.

## Tabla de códigos de error

| Código                    | Significado                                          |
| :------------------------ | :--------------------------------------------------- |
| `CAPTURE_BUSY`            | La tarea o la cola de captura está ocupada.          |
| `INVALID_REQUEST`         | Error de validación en la solicitud o parámetros.    |
| `RESOURCE_LIMIT_EXCEEDED` | Se superaron los límites de tamaño o memoria.        |
| `PERMISSION_DENIED`       | Permiso de grabación de pantalla denegado por el SO. |
| `DISPLAY_NOT_FOUND`       | No se encontró la pantalla objetivo.                 |
| `CAPTURE_FAILED`          | No se pudo capturar el fotograma de la pantalla.     |
| `OVERLAY_LOAD_FAILED`     | Error al cargar los recursos del Overlay.            |
| `EXPORT_FAILED`           | Falló la salida PNG, el portapapeles o el guardado.  |
| `INVALID_RESULT`          | Datos de resultado no válidos.                       |
| `UNSUPPORTED_PLATFORM`    | Plataforma o protocolo de pantalla no compatible.    |

## Licencia y marcas

El código fuente está licenciado bajo la [Licencia MIT](https://github.com/electron-tools/electron-snapora/blob/main/LICENSE). El nombre y la marca de `electron-snapora` se rigen por la [Política de marcas](https://github.com/electron-tools/electron-snapora/blob/main/TRADEMARKS.md).
