import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface OverlayResources {
  htmlPath: string;
  preloadPath: string;
}

export type PackagedResourceExists = (path: string) => boolean;

/**
 * main 入口发布在 dist/main，Overlay 页面与内部 Preload 发布在 dist/overlay。
 * 资源定位集中在这里，避免宿主构建工具或 Electron 版本参与路径拼接。
 */
export function resolveOverlayResources(
  mainModuleDirectory = __dirname,
  resourceExists: PackagedResourceExists = existsSync
): OverlayResources {
  const overlayDirectory = resolve(mainModuleDirectory, '..', 'overlay');
  const resources = {
    htmlPath: resolve(overlayDirectory, 'index.html'),
    preloadPath: resolve(overlayDirectory, 'preload.cjs'),
  };
  assertOverlayResources(resources, resourceExists);
  return resources;
}

/** 返回包内已打包的默认宿主 Preload，适用于不需要合并其他 Preload 的窗口。 */
export function resolveHostPreloadPath(
  mainModuleDirectory = __dirname,
  resourceExists: PackagedResourceExists = existsSync
): string {
  const preloadPath = resolve(mainModuleDirectory, '..', 'preload', 'auto.cjs');
  assertPackagedResources(
    [{ label: 'host preload', path: preloadPath }],
    resourceExists
  );
  return preloadPath;
}

export function assertOverlayResources(
  resources: OverlayResources,
  resourceExists: PackagedResourceExists = existsSync
): void {
  assertPackagedResources(
    [
      { label: 'overlay HTML', path: resources.htmlPath },
      { label: 'overlay preload', path: resources.preloadPath },
    ],
    resourceExists
  );
}

/** 在 BrowserWindow 创建前失败，避免主进程被打包后只表现为白屏或 ready 超时。 */
function assertPackagedResources(
  resources: Array<{ label: string; path: string }>,
  resourceExists: PackagedResourceExists
): void {
  const missing = resources.filter((resource) => !resourceExists(resource.path));
  if (missing.length === 0) {
    return;
  }

  const details = missing
    .map((resource) => `${resource.label}: ${resource.path}`)
    .join('; ');
  throw new Error(
    `[electron-snapora] Packaged resource missing (${details}). ` +
      'Keep electron-snapora external in the Electron main-process bundle and include its complete dist directory in the application package.'
  );
}
