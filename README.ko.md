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

```ts
await window.electronSnapora.capture({
  locale: 'ko-KR',
  theme: {
    mode: 'dark',
    accentColor: '#0a84ff',
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

## 오류 코드

| 오류 코드 | 설명 |
| :--- | :--- |
| `CAPTURE_BUSY` | 캡처 작업이 실행 중이거나 대기열이 가득 찼습니다. |
| `INVALID_REQUEST` | 요청 검증에 실패했습니다. |
| `RESOURCE_LIMIT_EXCEEDED` | 허용 리소스 크기를 초과했습니다. |
| `PERMISSION_DENIED` | 화면 녹화 권한이 거부되었습니다. |
| `DISPLAY_NOT_FOUND` | 대상 디스플레이를 찾을 수 없습니다. |
| `CAPTURE_FAILED` | 캡처 생성에 실패했습니다. |
| `OVERLAY_LOAD_FAILED` | 오버레이 로드에 실패했습니다. |
| `EXPORT_FAILED` | 이미지 출력 또는 저장에 실패했습니다. |
| `INVALID_RESULT` | 잘못된 결과 데이터입니다. |
| `UNSUPPORTED_PLATFORM` | 지원되지 않는 플랫폼입니다. |

## 라이선스 및 상표

소스 코드는 [MIT License](https://github.com/electron-tools/electron-snapora/blob/main/LICENSE)에 따라 라이선스가 부여됩니다. `electron-snapora` 명칭과 브랜드는 [상표 정책](https://github.com/electron-tools/electron-snapora/blob/main/TRADEMARKS.md)의 적용을 받습니다.
