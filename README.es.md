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

## Actualización a 1.0.26: configuración del host

La captura congelada de una sola pantalla no tiene nuevos argumentos obligatorios. Actualizar el paquete no activa automáticamente la selección en vivo ni el ajuste automático.

| Objetivo | Configuración del host |
| --- | --- |
| Selección en vivo en varias pantallas | Llama a `capture({ interactionMode: 'live', display: 'all' })` en Windows 10 2004+ / macOS 14+. Conserva `frozen` + `cursor` en plataformas no compatibles. |
| Ajuste automático | Crea `createWindowsSnapProvider(...)` / `createMacSnapProvider(...)` en el proceso principal y pásalo a `setupElectronSnapora({ ipcMain, managerOptions: { getWindowSnapRegions: provider } })`. Con `ScreenshotManager`, pasa directamente `{ getWindowSnapRegions: provider }`. Sin provider se puede seleccionar manualmente, pero no hay ajuste automático. |
| Solo ventanas completas | Crea el provider con `{ granularity: 'window' }` explícitamente. El valor predeterminado de la API es `panel`, que puede seleccionar una parte de la ventana; `fine` selecciona regiones más pequeñas. |
| Permisos de macOS | Consulta `macProvider.getPermissions()`, llama a `getPermissions(true)` tras una acción de autorización del usuario y vuelve a consultar. La captura live necesita grabación de pantalla; los contenedores AX necesitan accesibilidad. Si el producto exige ambos permisos antes de cualquier captura, el host debe aplicar esa política. La biblioteca no impone esa restricción ni incluye una interfaz de permisos. |
| Aplicación empaquetada | Extrae `node_modules/electron-snapora/dist/native/**` fuera de ASAR y aplica la firma del host. La estructura npm estándar no necesita un argumento de ruta del helper; para otras ubicaciones, consulta las instrucciones de `extraResources` más abajo. |

Crea y reutiliza el provider en el proceso principal y llama a `dispose()` al cerrar. `prepare()` es un precalentamiento opcional. No es necesario pasar objetos del demo, nodos DOM, listas de ventanas ni booleanos de permisos. Los ejemplos completos de integración, puente de permisos y firma están en la sección de selección en varias pantallas más abajo.

## Características principales

- Selección en varias pantallas en Windows 10 2004+ y macOS 14+, con captura después de confirmar el área.
- Ajuste a ventanas y contenedores entre aplicaciones mediante UI Automation / AX, con niveles `window / panel / fine`.
- Consulta de permisos de macOS, solicitud explícita de autorización y errores estructurados para el host.
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

Los idiomas incluidos son inglés (`en-US`, predeterminado), chino simplificado (`zh-CN`), japonés (`ja-JP`), coreano (`ko-KR`) y español (`es-ES`). Los recursos se encuentran en `src/i18n`.

El aviso de copia está desactivado de forma predeterminada. Con `showCopyFeedback: true`, se muestra durante 3 segundos con fondo blanco, texto negro, borde verde claro y una marca de verificación verde, tanto en el tema claro como en el oscuro. Personaliza el texto con `messages.copied` y los colores con los campos `copyFeedback*` siguientes.

```ts
await window.electronSnapora.capture({
  locale: 'es-ES',
  showCopyFeedback: true,
  messages: { copied: 'Copiado al portapapeles' },
  theme: {
    mode: 'dark',
    accentColor: '#0a84ff',
    copyFeedbackBackground: '#ffffff',
    copyFeedbackForeground: '#111111',
    copyFeedbackBorderColor: '#dff3eb',
    copyFeedbackIconColor: '#20b88a',
    copyFeedbackIconBackground: '#e4f8ef',
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

## Selección en varias pantallas, ajuste a contenedores y permisos del host

Estas funciones pertenecen a la API pública del paquete. `demo/` es una aplicación de prueba del repositorio y no se publica en npm. La integración predeterminada conserva la captura congelada de una pantalla; instalar el paquete no registra automáticamente un proveedor de ajuste ni una interfaz de permisos.

`interactionMode: 'live'` permite mover el puntero entre pantallas, ajustar el área al pasar sobre una ventana, seleccionar con un clic y arrastrar libremente. El arrastre queda limitado a la pantalla donde comienza. La imagen se obtiene después de confirmar el área y se abre el editor existente. `display: 'all'` requiere live y no une varias pantallas en una imagen. El modo anterior usa `interactionMode: 'frozen', display: 'cursor'`.

| Nivel                    | Comportamiento                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------- |
| `window`                 | Ventanas completas, sin recorrer el árbol de accesibilidad.                                 |
| `panel` (predeterminado de la API del proveedor) | Paneles principales y barras laterales; excluye controles pequeños y tarjetas anidadas.     |
| `fine`                   | Contenedores más pequeños expuestos por accesibilidad, como tarjetas y elementos de listas. |

Windows usa UI Automation; macOS usa límites de CoreGraphics, AX y ScreenCaptureKit. Ambos proveedores ofrecen `prepare()` / `dispose()` y publican ventanas antes que contenedores. En Mac se excluyen las superficies de composición e indicadores del sistema antes de detectar el objetivo y calcular oclusiones; las aplicaciones realmente a pantalla completa se conservan. Canvas y las interfaces propias pueden ofrecer solo la ventana. Live requiere Windows build 19041+ o macOS 14+; no está disponible en Linux.

### Proceso principal del host

Después de `app.whenReady()`, cree la ventana con el preload indicado abajo y llame a `setupHostScreenshot(hostWindow, trustedUrl)` antes de cargar la página. Pase la URL completa de confianza (`file://` o de desarrollo) para registrar IPC antes de inicializar el Renderer. Sustituye la inicialización anterior de `setupElectronSnapora()`; no registre los mismos canales dos veces. Ejecute la función de limpieza devuelta al cerrar la ventana o la aplicación. Para varios hosts, comparta un manager/proveedor y valide cada remitente autorizado.

```ts
import { release } from 'node:os';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { ipcMain } from 'electron';
import {
  setupElectronSnapora,
  createMacSnapProvider,
  createWindowsSnapProvider,
} from 'electron-snapora/main';

export function setupHostScreenshot(hostWindow: BrowserWindow, trustedUrl: string) {
  const liveSupported =
    (process.platform === 'win32' && Number(release().split('.')[2]) >= 19041) ||
    (process.platform === 'darwin' && Number(release().split('.')[0]) >= 23);
  const macProvider =
    process.platform === 'darwin' && liveSupported
      ? createMacSnapProvider({ granularity: 'panel', onDiagnostic: console.info })
      : undefined;
  const provider =
    macProvider ??
    (process.platform === 'win32' && liveSupported
      ? createWindowsSnapProvider({ granularity: 'panel', keepAlive: true })
      : undefined);
  const validateSender = (event: IpcMainInvokeEvent) =>
    !hostWindow.isDestroyed() &&
    event.sender === hostWindow.webContents &&
    event.senderFrame === hostWindow.webContents.mainFrame &&
    event.senderFrame?.url === trustedUrl;

  const snapora = setupElectronSnapora({
    ipcMain,
    validateSender,
    managerOptions: { getWindowSnapRegions: provider },
  });
  ipcMain.handle('host:snapora-permissions', async (event, prompt: unknown) => {
    if (!validateSender(event) || typeof prompt !== 'boolean')
      throw new Error('Unauthorized permission request.');
    if (snapora.manager.activeJobId)
      throw new Error('Finish or cancel the current capture first.');
    return {
      liveSupported,
      macPermissions: macProvider ? await macProvider.getPermissions(prompt) : null,
    };
  });

  return () => {
    ipcMain.removeHandler('host:snapora-permissions');
    snapora.unregister();
    provider?.dispose();
  };
}
```

### Preload y Renderer del host

Compile este preload como un único archivo CommonJS y use su ruta absoluta en `BrowserWindow.webPreferences.preload`. Mantenga `contextIsolation: true`, `sandbox: true` y `nodeIntegration: false`. Incluya `electron-snapora/preload` en el bundle y deje solo `electron` como external. El paquete del proceso principal debe permanecer external. Consulte [el sandbox de Electron](https://www.electronjs.org/docs/latest/tutorial/sandbox).

```ts
import { contextBridge, ipcRenderer } from 'electron';
import { exposeScreenshotApi } from 'electron-snapora/preload';

exposeScreenshotApi({ contextBridge, ipcRenderer });
contextBridge.exposeInMainWorld('snaporaPermissions', {
  get: () => ipcRenderer.invoke('host:snapora-permissions', false),
  request: () => ipcRenderer.invoke('host:snapora-permissions', true),
});
```

`host:snapora-permissions` y `window.snaporaPermissions` son APIs de ejemplo definidas por el host, no exportaciones integradas de Snapora. Añada sus declaraciones de tipos al Renderer. `get()` devuelve `{ liveSupported, macPermissions: null | { screenRecording, accessibility } }`; `null` indica que el ejemplo no tiene un proveedor Mac compatible. Los errores de consulta rechazan la llamada IPC y deben distinguirse de un permiso denegado.

```ts
import type { MacSnapPermissions } from 'electron-snapora/main';
import type { ScreenshotRendererApi } from 'electron-snapora/types';

interface HostPermissionState {
  liveSupported: boolean;
  macPermissions: MacSnapPermissions | null;
}
declare global {
  interface Window {
    electronSnapora: ScreenshotRendererApi;
    snaporaPermissions: {
      get(): Promise<HostPermissionState>;
      request(): Promise<HostPermissionState>;
    };
  }
}
```

```ts
const state = await window.snaporaPermissions.get();
const result = await window.electronSnapora.capture({
  interactionMode: state.liveSupported ? 'live' : 'frozen',
  display: state.liveSupported ? 'all' : 'cursor',
});
if (result.status === 'failed' && result.code === 'PERMISSION_DENIED') {
  console.info(result.message);
}
```

### Responsabilidad sobre los permisos

| Estado                                | Respuesta del paquete                                                                               | Responsabilidad del host                                                               |
| ------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Sin Grabación de pantalla             | `capture()` en live devuelve `status: 'failed', code: 'PERMISSION_DENIED'` por el IPC habitual.     | Explicar el motivo y ofrecer autorización o ajustes.                                   |
| Sin Accesibilidad                     | Se conserva el ajuste a ventanas y la selección libre; una captura correcta no confirma permiso AX. | Consultar `getPermissions()` o `accessibility: false` en `onDiagnostic` del proveedor. |
| Helper ausente o imposible de iniciar | La consulta se rechaza; la captura puede devolver `CAPTURE_FAILED`.                                 | Corregir distribución, ruta o firma antes de pedir permiso.                            |

`macProvider.getPermissions()` consulta al helper real sin abrir diálogos. Llame a `window.snaporaPermissions.request()` únicamente desde el botón de autorización del usuario; se traduce a `getPermissions(true)` y solicita Grabación de pantalla y Accesibilidad. No espera a que el usuario termine de modificar los ajustes: consulte de nuevo y reinicie la aplicación firmada si es necesario. `false` no distingue entre permiso aún no solicitado, denegado o restringido. No solicite permisos durante una captura.

No hay notificaciones automáticas de cambios ni un puente de permisos integrado para el Renderer. El host controla UI, validación y limpieza de IPC y actualización de estado. Live usa los permisos del backend nativo, no solo los del host Electron. Frozen conserva las comprobaciones de Electron y abre los ajustes de Grabación de pantalla si el permiso ya está denegado. La captura y el ajuste normales no necesitan micrófono, cámara, monitorización de entrada, acceso total al disco ni Automatización. Solo el fallback AppleScript de restauración de foco del demo puede pedir Automatización; no es una dependencia de la integración.

### Distribución del helper de Mac

Mantenga el paquete en production `dependencies` y su entrada principal como external. La publicación debe incluir `dist/native/snapora-macos`, un ejecutable universal **arm64 + x86_64**. Los equipos de los usuarios no necesitan Swift, Xcode, `koffi` ni archivos del demo. Los helpers son procesos separados, no addons nativos de Node.

Con **electron-builder 26**, la versión del repositorio, desempaquete el helper:

```json
{
  "build": {
    "asarUnpack": ["node_modules/electron-snapora/dist/native/**"]
  }
}
```

Windows incluye dos ejecutables precompilados: `dist/native/snapora-windows-snap.exe` (UI Automation) y `dist/native/snapora-windows-capture.exe` (captura de píxeles). Electron los inicia directamente, sin PowerShell, compilación C#, descargas ni ejecutables temporales durante el uso. Son programas AnyCPU que usan el runtime de .NET Framework de Windows, no distribuciones .NET autocontenidas. El usuario no necesita compilador ni SDK. Desempaquete ambos fuera de ASAR; HTML/CSS/JS pueden permanecer dentro.

En Windows, `pnpm run build` y `pnpm demo` compilan primero los helpers. Use `pnpm run build:native:windows` para compilarlos por separado y `pnpm run verify:native:windows` para validar los binarios y hashes del código fuente. No cambian las API, la preparación, la reutilización, la cancelación, los tres niveles de ajuste ni la edición de capturas.

Para publicar desde macOS/Linux, compile la misma revisión en Windows y copie ambos exe y `windows-helpers.json` a `src/electron/native` en el equipo de publicación. CI proporciona el artefacto `windows-native-helpers`. `release:check` exige los helpers de Windows y Mac universal y rechaza archivos Windows ausentes, corruptos u obsoletos. No se publica código C#/PowerShell/Swift en npm. La firma de producción de los helpers Windows puede realizarse al empaquetar el host.

La búsqueda predeterminada convierte `app.asar` en `app.asar.unpacked`. Conserve el permiso de ejecución e incluya el helper en la firma Developer ID y notarización del host; la firma ad-hoc de desarrollo no sustituye a la de distribución. [builder 26](https://www.electron.build/v26/docs/mac/) documenta `mac.binaries` para ejecutables adicionales. En builder 27 use `asar.unpack` y `mac.sign`; Forge también debe desempaquetar y firmar el ejecutable.

Si usa `extraResources`, pase la misma ruta absoluta a `createMacSnapProvider({ executablePath })` y `new ElectronCaptureAdapter({ macHelperPath })`, e inyecte el adaptador mediante `managerOptions.captureAdapter`. El host debe ejecutar `dispose()` en el adaptador inyectado además del manager y proveedor. Verifique los permisos con la identidad de la aplicación final firmada.

### Demo de código fuente, publicación y verificación

Para desarrollar en el repositorio, ejecute `pnpm demo` (alias `pnpm run demo:mac`). En macOS 14+ compila primero el helper; solo el equipo de compilación necesita Xcode Command Line Tools. El demo usa live + window (ventanas completas) por defecto; permite cambiar a panel / fine para comparar. El paquete no importa su IPC de permisos ni su restauración de foco.

Antes de publicar, ejecute en un Mac:

```bash
pnpm run test:native:mac
pnpm run build:native:mac:universal
pnpm run release:check
```

`release:check` rechaza helpers ausentes, de una sola arquitectura o malformados; en macOS también comprueba permiso de ejecución y firma. El build copia helpers precompilados y datos de verificación a `dist/native`, sin publicar fuentes C#/PowerShell/Swift. CI verifica los artefactos Windows, ejecuta regresiones Swift en Mac, comprueba el artefacto universal y verifica consumidores ESM/CommonJS instalados desde un tgz real.

El usuario ha confirmado que la captura y el ajuste funcionan en el demo Mac después del filtro de ventanas del sistema. La distribución firmada, ambas CPU en hardware real y la matriz completa Lark/navegador/Ping aún requieren validación de lanzamiento. Consulte [las notas de implementación y validación](https://github.com/electron-tools/electron-snapora/blob/main/docs/macos-container-snap.md).

## Licencia y marcas

El código fuente está licenciado bajo la [Licencia MIT](https://github.com/electron-tools/electron-snapora/blob/main/LICENSE). El nombre y la marca de `electron-snapora` se rigen por la [Política de marcas](https://github.com/electron-tools/electron-snapora/blob/main/TRADEMARKS.md).
