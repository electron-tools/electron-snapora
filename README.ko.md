# electron-snapora — Electron 스크린샷 및 주석 도구

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

[English](https://github.com/electron-tools/electron-snapora/blob/main/README.md) | [简体中文](https://github.com/electron-tools/electron-snapora/blob/main/README.zh-CN.md) | [日本語](https://github.com/electron-tools/electron-snapora/blob/main/README.ja.md) | 한국어 | [Español](https://github.com/electron-tools/electron-snapora/blob/main/README.es.md)

한 줄 설정과 안전한 Preload IPC로 영역 캡처, 대화형 주석 편집, 클립보드 복사, PNG 내보내기, 화면 핀 고정 창 기능을 제공하는 Electron 스크린샷 라이브러리입니다.

<p align="center">
  <img src="./docs/assets/preview.jpg" alt="electron-snapora preview" width="800" />
</p>

## 주요 기능

- Windows 10 2004+ / macOS 14+의 다중 화면 실시간 선택. 영역 확정 후 화면을 캡처합니다.
- Windows UI Automation / macOS AX 기반 앱 간 창·컨테이너 스냅과 `window / panel / fine` 3단계 설정.
- 호스트용 macOS 권한 조회, 명시적 권한 요청 및 구조화된 캡처 오류.
- **영역 스크린샷**：디스플레이 또는 커서 위치 기준 화면 캡처.
- **대화형 선택 오버레이**：자유 드래그 선택 및 8방향 리사이즈 핸들.
- **다양한 주석 도구**：사각형, 타원, 화살표, 브러시, 텍스트(일반/배경 채우기/외곽선 프리셋), 강도 조절 모자이크 및 워터마크.
- **편리한 조작**：그리기 도구가 활성화된 상태에서도 기존 주석을 직접 드래그하여 이동 가능.
- **출력 및 화면 고정**：클립보드 복사, 네이티브 PNG 저장, 최상위 핀 고정 창 생성.
- **비율 유지 크기 조절**：최상위 고정 유지, 비율 유지 드래그 리사이즈, 우클릭 메뉴 지원.
- **TypeScript, ESM, CommonJS 완벽 지원**：타입 정의 파일 기본 내장.
- **0 네이티브 애드온 (Zero Native Addons)**：C++ 네이티브 모듈 불필요, 별도 컴파일 과정 없음.

저장소: [github.com/electron-tools/electron-snapora](https://github.com/electron-tools/electron-snapora)  
지원: [GitHub Issues](https://github.com/electron-tools/electron-snapora/issues) · [@novratools on X](https://x.com/novratools)  
상표 정책: [TRADEMARKS.md](https://github.com/electron-tools/electron-snapora/blob/main/TRADEMARKS.md)

## 빠른 시작

**최소 요구 사양:** Electron 42 이상, Node.js 20 이상.

### 1. 설치

```bash
npm install electron-snapora
```

호스트 앱에 Electron이 설치되어 있지 않은 경우:

```bash
npm install --save-dev electron
```

### 2. 메인 프로세스 초기화

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

### 3. 렌더러 프로세스에서 호출

```ts
const result = await window.electronSnapora.capture({ display: 'cursor' });

if (result.status === 'completed') {
  console.log(result.data, result.bounds, result.output);
}
```

취소 시 `cancelled`, 실패 시 `failed`가 반환됩니다.

동일 렌더러에서 진행 중인 캡처 작업을 취소하려면:

```ts
await window.electronSnapora.cancel();
```

TypeScript 타입 선언:

```ts
import type { ScreenshotRendererApi } from 'electron-snapora/types';

declare global {
  interface Window {
    electronSnapora: ScreenshotRendererApi;
  }
}
```

## 기존 Preload를 사용하는 경우

독립된 Preload 스크립트를 사용하는 경우 `snapora.preloadPath`를 생략하고 Preload 내에서 API를 직접 노출하세요:

```ts
import { contextBridge, ipcRenderer } from 'electron';
import { exposeScreenshotApi } from 'electron-snapora/preload';

exposeScreenshotApi({ contextBridge, ipcRenderer });
```

## 발신자 오리진 검증

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

## 고급 설정

### 테마 및 현지화

지원 언어는 영어(`en-US`, 기본값), 중국어 간체(`zh-CN`), 일본어(`ja-JP`), 한국어(`ko-KR`), 스페인어(`es-ES`)입니다. 언어 리소스는 `src/i18n`에 있습니다.

복사 완료 알림은 기본적으로 꺼져 있습니다. `showCopyFeedback: true`로 켜면 흰색 배경, 검은색 글자, 연한 녹색 테두리와 녹색 체크 표시로 3초간 표시됩니다. 밝은 테마와 어두운 테마에서 같은 색상을 사용합니다. 문구는 `messages.copied`, 색상은 아래 `copyFeedback*` 필드로 변경할 수 있습니다.

```ts
await window.electronSnapora.capture({
  locale: 'ko-KR',
  showCopyFeedback: true,
  messages: { copied: '클립보드에 복사되었습니다' },
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

### 리소스 제한

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

## 번들링 및 패키징

메인 프로세스를 빌드할 때 `electron-snapora`를 external로 설정하세요 (electron-vite, Webpack, electron-builder, Forge 지원).

## macOS 단축키와 호스트 창 보호

캡처를 시작하는 전역 단축키는 호스트가 등록합니다. 캡처 화면 안의 Escape, R(사각형), T(텍스트) 등의 키는 Snapora가 처리합니다. macOS에서는 오버레이를 표시할 때 창이 포커스를 받을 수 있도록 복원하고 앱, 창, 웹 콘텐츠의 포커스를 요청합니다. 호스트에서 같은 포커스 호출을 반복하거나 Escape/R/T를 전역 단축키로 등록할 필요는 없습니다.

**호스트 창 보호는 필수 설정이 아닙니다.** 기존 포커스 관리나 백그라운드 창이 앞으로 나오는 것을 막는 로직이 있다면 다음 규칙을 따르세요.

- 명시적인 창 참조 또는 호스트가 관리하는 창 목록을 사용해 호스트 소유의 창만 변경하세요. `BrowserWindow.getAllWindows()`의 모든 창에 `setFocusable(false)`를 적용하지 마세요. 여기에는 다음 캡처에서 재사용하는 숨겨진 오버레이도 포함됩니다. 오버레이, 고정 이미지, 복사 알림 창은 보호 대상에서 제외하세요.
- macOS 전용 보호 로직은 `process.platform === 'darwin'` 분기 안에 두어 Windows 동작을 유지하세요. 앱의 활성 상태는 `app.isActive()`로 확인하세요. 설정이나 회의 창에 포커스가 있어도 호스트는 활성 상태이므로 메인 창의 포커스만으로 판단하면 안 됩니다.
- 창 상태를 변경하기 전에 `manager.activeJobId`를 확인하세요. `capture()` 바깥에서 비동기 포커스 복원을 추가한다면 캡처부터 복원 완료까지 전체 과정의 중복 실행도 막아야 합니다.
- 원래 상태를 기록하고 취소 및 실패 시에도 `finally`에서 복원하세요. 이번 작업이 변경한 창 중 아직 파괴되지 않은 창만 복원하세요. 이전 캡처의 지연 콜백이 다음 캡처 상태를 바꾸지 않도록 하세요.

Snapora는 캡처 종료 시 `app.hide()`를 호출하지 않습니다. 이 호출은 호스트와 고정 이미지를 포함한 앱의 모든 창을 숨기기 때문입니다. 캡처 전에 포커스가 있던 호스트 창에만 포커스를 복원합니다. 이전에 활성화되어 있던 외부 앱으로 돌아갈지는 호스트의 정책이며, Snapora는 외부 앱 자동 복원 기능을 제공하지 않습니다. `app.hide()`를 일반적인 캡처 정리 단계로 사용하지 마세요.

오버레이가 보이지만 키가 반응하지 않으면 `app.isActive()`, 오버레이의 `isFocusable()` 및 `isFocused()`, `webContents.isFocused()`, `before-input-event` 도달 여부를 확인하세요. 화면이 보인다고 키보드 포커스가 확보된 것은 아니며, 해당 WebContents에 도달하지 않은 키는 `before-input-event`에서도 받을 수 없습니다. 첫 캡처는 되고 두 번째는 실패한다면 호스트가 재사용 오버레이의 포커스를 비활성화했는지 먼저 확인하세요. 실제 Mac에서 다른 앱이 앞에 있는 상태로 최초 캡처와 연속 캡처를 검증하세요. 포커스 API 호출만으로 키보드 입력 전달이 확인되지는 않습니다.

## 오류 코드

| 오류 코드                 | 설명                                              |
| :------------------------ | :------------------------------------------------ |
| `CAPTURE_BUSY`            | 캡처 작업이 실행 중이거나 대기열이 가득 찼습니다. |
| `INVALID_REQUEST`         | 요청 검증에 실패했습니다.                         |
| `RESOURCE_LIMIT_EXCEEDED` | 허용 리소스 크기를 초과했습니다.                  |
| `PERMISSION_DENIED`       | 화면 녹화 권한이 거부되었습니다.                  |
| `DISPLAY_NOT_FOUND`       | 대상 디스플레이를 찾을 수 없습니다.               |
| `CAPTURE_FAILED`          | 캡처 생성에 실패했습니다.                         |
| `OVERLAY_LOAD_FAILED`     | 오버레이 로드에 실패했습니다.                     |
| `EXPORT_FAILED`           | 이미지 출력 또는 저장에 실패했습니다.             |
| `INVALID_RESULT`          | 잘못된 결과 데이터입니다.                         |
| `UNSUPPORTED_PLATFORM`    | 지원되지 않는 플랫폼입니다.                       |

## 다중 화면 실시간 선택, 컨테이너 스냅 및 호스트 권한

이 기능들은 npm 패키지의 공개 API입니다. `demo/`는 소스 저장소의 테스트 앱이며 npm에 포함되지 않습니다. 기본 연동은 정지 화면의 단일 모니터 캡처를 유지합니다. 설치만으로 스냅 provider나 권한 UI가 자동 등록되지는 않습니다.

`interactionMode: 'live'`는 모니터 사이 포인터 이동, 호버 스냅, 클릭 선택, 자유 드래그를 지원합니다. 드래그는 시작한 화면 안에 제한되고, 선택 확정 후 해당 화면을 캡처하여 기존 편집기로 전환합니다. `display: 'all'`은 live 전용이며 여러 화면을 한 이미지로 합치는 옵션이 아닙니다. 기존 모드는 `interactionMode: 'frozen', display: 'cursor'`입니다.

| 단계           | 동작                                                         |
| -------------- | ------------------------------------------------------------ |
| `window`       | 전체 앱 창만 선택하며 접근성 트리를 탐색하지 않습니다.       |
| `panel` (provider API 기본값) | 주요 패널과 사이드바. 작은 컨트롤 및 중첩 카드를 제외합니다. |
| `fine`         | 카드와 목록 항목 등 더 작은 접근성 컨테이너.                 |

Windows는 UI Automation, macOS는 CoreGraphics 창 경계, AX, ScreenCaptureKit을 사용합니다. 두 provider 모두 `prepare()` / `dispose()`를 제공하고 창을 먼저, 컨테이너를 나중에 전달합니다. Mac 시스템 합성·상태 레이어는 히트 테스트 및 가림 판정에서 제외하며 실제 전체 화면 앱은 유지합니다. Canvas/사용자 정의 UI는 창 단위만 지원할 수 있습니다. live는 Windows build 19041+ 또는 macOS 14+가 필요하며 Linux live는 지원하지 않습니다.

### 호스트 메인 프로세스

`app.whenReady()` 완료 후 아래의 preload로 호스트 창을 만들고, 페이지를 로드하기 전에 `setupHostScreenshot(hostWindow, trustedUrl)`을 호출합니다. 신뢰할 수 있는 전체 `file://` URL 또는 개발 URL을 전달하여 렌더러 초기화 전에 IPC를 등록하세요. 앞의 `setupElectronSnapora()` 초기화를 대체하므로 같은 IPC를 중복 등록하지 마세요. 반환된 정리 함수를 창 종료/앱 종료 시 호출하세요. 여러 호스트 창에서는 하나의 manager/provider를 공유하고 승인된 각 발신자를 검증합니다.

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

### 호스트 Preload와 렌더러

다음 preload를 단일 CommonJS 파일로 번들링하고 절대 출력 경로를 `BrowserWindow.webPreferences.preload`에 지정합니다. `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`를 유지합니다. preload의 `electron-snapora/preload`는 번들에 포함하고 `electron`만 external로 둡니다. 메인 프로세스 패키지는 external로 유지합니다. [Electron 샌드박스 문서](https://www.electronjs.org/docs/latest/tutorial/sandbox)를 참고하세요.

```ts
import { contextBridge, ipcRenderer } from 'electron';
import { exposeScreenshotApi } from 'electron-snapora/preload';

exposeScreenshotApi({ contextBridge, ipcRenderer });
contextBridge.exposeInMainWorld('snaporaPermissions', {
  get: () => ipcRenderer.invoke('host:snapora-permissions', false),
  request: () => ipcRenderer.invoke('host:snapora-permissions', true),
});
```

`host:snapora-permissions`와 `window.snaporaPermissions`는 호스트가 정의한 예제 API이며 패키지 내장 API가 아닙니다. 렌더러 타입 선언을 추가하세요. `get()`은 `{ liveSupported, macPermissions: null | { screenRecording, accessibility } }`를 반환하며 `null`은 지원되는 Mac provider가 없음을 뜻합니다. 조회 실패는 IPC reject로 전달되며 권한 거부와 구분해 표시해야 합니다.

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

### 권한 처리 책임

| 상태                  | 패키지 동작                                                                               | 호스트 처리                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 화면 기록 권한 없음   | live `capture()`가 `status: 'failed', code: 'PERMISSION_DENIED'`를 기존 IPC로 반환합니다. | 용도와 권한/설정 진입점을 표시합니다.                                                  |
| 손쉬운 사용 권한 없음 | 창 스냅/자유 선택으로 제한됩니다. 캡처 성공은 AX 권한을 의미하지 않습니다.                | `getPermissions()` 또는 provider `onDiagnostic`의 `accessibility: false`를 확인합니다. |
| helper 누락/실행 불가 | 조회 reject, 캡처는 `CAPTURE_FAILED`가 될 수 있습니다.                                    | 권한 대신 패키징·경로·서명을 먼저 수정합니다.                                          |

`macProvider.getPermissions()`는 실제 helper 권한만 조회하며 팝업을 띄우지 않습니다. 사용자가 권한 버튼을 누를 때만 `window.snaporaPermissions.request()`를 호출하세요. 이는 `getPermissions(true)`로 연결되어 화면 기록과 손쉬운 사용 권한을 요청합니다. 설정 변경 완료를 기다리는 API가 아니므로 다시 조회하고 필요하면 서명된 앱을 재시작합니다. `false`는 미요청·거부·제한을 구분하지 않습니다. 캡처 도중에는 요청하지 마세요.

권한 변경 자동 알림과 내장 권한 렌더러 브리지는 없습니다. UI, IPC 검증·해제, 새로고침은 호스트 책임입니다. live는 native backend 권한을 기준으로 판단하며 Electron 호스트 상태만으로 대체할 수 없습니다. frozen은 기존 Electron 검사를 유지하며 이미 거부된 경우 화면 기록 설정을 엽니다. 일반 캡처/스냅에는 마이크, 카메라, 입력 모니터링, 전체 디스크 접근, 자동화가 필요 없습니다. demo의 AppleScript 포커스 복원 폴백만 자동화를 요청할 수 있으며 필수 연동 코드가 아닙니다.

### Mac helper 배포

패키지를 production `dependencies`에 두고 메인 진입점을 external로 유지하세요. 릴리스에는 **arm64 + x86_64 universal** 실행 파일 `dist/native/snapora-macos`가 포함되어야 합니다. 실행 환경에는 Swift, Xcode, `koffi`, demo 파일이 필요 없습니다. helper는 별도 프로세스이며 Node native addon이 아닙니다.

저장소와 같은 **electron-builder 26**에서는 다음과 같이 압축에서 제외합니다.

```json
{
  "build": {
    "asarUnpack": ["node_modules/electron-snapora/dist/native/**"]
  }
}
```

Windows에는 미리 컴파일한 `dist/native/snapora-windows-snap.exe`(UI Automation)와 `dist/native/snapora-windows-capture.exe`(화면 캡처)가 포함됩니다. Electron이 직접 실행하므로 런타임 PowerShell, C# 컴파일, 다운로드, 임시 exe 생성이 없습니다. Windows .NET Framework 런타임을 사용하는 AnyCPU 프로그램이며 자체 포함 .NET 배포는 아닙니다. 사용자는 컴파일러나 SDK가 필요하지 않습니다. 두 exe를 ASAR 밖에 배치하고 HTML/CSS/JS는 ASAR 안에 유지할 수 있습니다.

Windows에서 `pnpm run build` / `pnpm demo`는 helper를 먼저 컴파일합니다. 별도 빌드는 `pnpm run build:native:windows`, 바이너리와 소스 해시 검증은 `pnpm run verify:native:windows`입니다. API, 사전 준비, 프로세스 재사용, 취소, 세 단계 흡착과 이미지 편집은 동일합니다.

macOS/Linux에서 배포할 때는 같은 리비전을 Windows에서 빌드하고 두 exe와 `windows-helpers.json`을 배포 머신의 `src/electron/native`에 복사하세요. CI 산출물 이름은 `windows-native-helpers`입니다. `release:check`는 Windows 및 Mac universal helper를 모두 요구하며 누락·손상·오래된 Windows 빌드를 거부합니다. C#/PowerShell/Swift 소스는 npm에 포함하지 않습니다. Windows helper의 제품 서명은 호스트 패키징 단계에서 적용할 수 있습니다.

기본 경로는 `app.asar`를 `app.asar.unpacked`로 변환합니다. 실행 권한을 유지하고 호스트의 Developer ID 서명·공증에 helper를 포함하세요. 개발용 ad-hoc 서명은 배포용 서명이 아닙니다. [builder 26](https://www.electron.build/v26/docs/mac/)의 `mac.binaries`로 추가 실행 파일 서명을 지정할 수 있습니다. builder 27은 `asar.unpack`과 `mac.sign` 설정을 사용하며 Forge도 실행 파일 압축 해제와 서명이 필요합니다.

`extraResources`를 사용한다면 같은 절대 경로를 `createMacSnapProvider({ executablePath })`와 `new ElectronCaptureAdapter({ macHelperPath })`에 전달하고 `managerOptions.captureAdapter`로 주입하세요. 주입한 adapter는 manager/provider 외에 호스트에서 직접 `dispose()`해야 합니다. 최종 서명된 앱의 신원으로 권한을 검증하세요.

### 소스 demo, 릴리스 및 검증

저장소 개발은 `pnpm demo`(별칭 `pnpm run demo:mac`)로 실행합니다. macOS 14+에서는 helper를 먼저 빌드하므로 빌드 머신에만 Xcode Command Line Tools가 필요합니다. demo 기본값은 live + window(전체 창)이며 panel / fine으로 전환하여 비교할 수 있습니다. 또한 패키지는 demo 권한 IPC나 포커스 복원 코드를 참조하지 않습니다.

게시 전에 Mac에서 실행합니다.

```bash
pnpm run test:native:mac
pnpm run build:native:mac:universal
pnpm run release:check
```

`release:check`는 누락·단일 아키텍처·손상된 helper를 거부하며 Mac에서는 실행 권한과 서명도 검사합니다. `dist/native`에는 미리 빌드한 helper와 검증 정보만 복사하고 C#/PowerShell/Swift 소스는 제외합니다. CI는 Windows 산출물, Mac Swift 회귀, universal 산출물, 실제 tgz에서 설치한 ESM/CommonJS 소비 프로젝트를 검증합니다.

시스템 창 필터링 이후 사용자가 Mac demo 캡처와 스냅이 동작한다고 확인했습니다. 서명 앱 배포, 두 CPU의 실기기, 전체 Lark/브라우저/Ping 조합은 릴리스 검증이 더 필요합니다. [구현 및 검증 기록](https://github.com/electron-tools/electron-snapora/blob/main/docs/macos-container-snap.md)을 참고하세요.

## 라이선스 및 상표

소스 코드는 [MIT License](https://github.com/electron-tools/electron-snapora/blob/main/LICENSE)에 따라 라이선스가 부여됩니다. `electron-snapora` 명칭과 브랜드는 [상표 정책](https://github.com/electron-tools/electron-snapora/blob/main/TRADEMARKS.md)의 적용을 받습니다.
