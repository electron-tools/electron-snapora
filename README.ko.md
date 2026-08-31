# electron-snapora — Electron 스크린샷 및 주석 도구

[![npm version](https://img.shields.io/npm/v/electron-snapora?style=flat-square&color=cb3837)](https://www.npmjs.com/package/electron-snapora)
[![npm total downloads](https://img.shields.io/npm/dt/electron-snapora?style=flat-square&color=blue)](https://www.npmjs.com/package/electron-snapora)
[![npm monthly downloads](https://img.shields.io/npm/dm/electron-snapora?style=flat-square&color=2088FF)](https://www.npmjs.com/package/electron-snapora)
[![CI Status](https://img.shields.io/github/actions/workflow/status/electron-tools/electron-snapora/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/electron-tools/electron-snapora/actions)
[![Electron Version](https://img.shields.io/badge/Electron-%3E%3D42-47848F?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Zero Native Addons](https://img.shields.io/badge/Native%20Addons-0-success?style=flat-square)](https://github.com/electron-tools/electron-snapora)
[![License](https://img.shields.io/npm/l/electron-snapora?style=flat-square)](https://github.com/electron-tools/electron-snapora/blob/main/LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/electron-tools/electron-snapora?style=flat-square)](https://github.com/electron-tools/electron-snapora/stargazers)

[English](https://github.com/electron-tools/electron-snapora/blob/main/README.md) | [简体中文](https://github.com/electron-tools/electron-snapora/blob/main/README.zh-CN.md) | [日本語](https://github.com/electron-tools/electron-snapora/blob/main/README.ja.md) | 한국어 | [Español](https://github.com/electron-tools/electron-snapora/blob/main/README.es.md)

Electron 애플리케이션에 영역 캡처, 대화형 선택 영역, 이미지 주석, 클립보드 복사 및 PNG 저장 기능을 추가합니다.

<p align="center">
  <img src="./docs/assets/preview.jpg" alt="electron-snapora preview" width="800" />
</p>

## 기능

- 사각형 영역 캡처와 대화형 오버레이.
- 사각형, 타원, 화살표, 브러시, 텍스트, 강도 조절 모자이크 및 워터마크 주석.
- 실행 취소, 다시 실행, 클립보드 복사, 네이티브 PNG 저장 및 화면 고정.
- TypeScript, ESM 및 CommonJS 지원.
- 네이티브 애드온과 설치 후 컴파일이 필요하지 않음.

## 빠른 시작

요구 사항: Node.js 20 이상, Electron 42 이상.

### 1. 설치

```bash
npm install electron-snapora
```

이 패키지는 애플리케이션의 프로덕션 `dependencies`에 포함해야 합니다.

### 2. 메인 프로세스 설정

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

### 3. Renderer에서 캡처

```ts
const result = await window.electronSnapora.capture({ display: 'cursor' });

if (result.status === 'completed') {
  console.log(result.data, result.bounds, result.output);
}
```

`result.data`는 PNG 바이트 데이터입니다. 사용자가 취소하면 `cancelled`, 실패하면 `failed`가 반환됩니다.

## 기존 Preload를 사용하는 애플리케이션

애플리케이션의 Preload에서 API를 노출하고 해당 Preload를 호스트 빌드 도구로 번들링하세요.

```ts
import { contextBridge, ipcRenderer } from 'electron';
import { exposeScreenshotApi } from 'electron-snapora/preload';

exposeScreenshotApi({ contextBridge, ipcRenderer });
```

## 패키징

Electron 메인 프로세스를 번들링할 때 `electron-snapora`를 external로 유지하고 프로덕션 의존성에 포함하세요. 그래야 Overlay HTML, CSS 및 Preload 파일이 애플리케이션과 함께 설치됩니다.

테마, 현지화, IPC 발신자 검증, 동시 실행 큐, 진단 및 번들러 설정은 [영문 전체 문서](https://github.com/electron-tools/electron-snapora/blob/main/README.md)를 참조하세요.

저장소: [github.com/electron-tools/electron-snapora](https://github.com/electron-tools/electron-snapora)

라이선스: [MIT](https://github.com/electron-tools/electron-snapora/blob/main/LICENSE)
