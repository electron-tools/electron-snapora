import type { ScreenshotErrorCode } from '../../types.js';

export type ScreenshotDiagnosticStage =
  | 'queue'
  | 'session'
  | 'capture'
  | 'overlay-create'
  | 'overlay-load'
  | 'overlay-ready'
  | 'overlay-prepare'
  | 'output';

export type ScreenshotDiagnosticPhase = 'start' | 'complete' | 'cancel' | 'error';

export type ScreenshotDiagnosticContextValue =
  string | number | boolean | ReadonlyArray<string | number | boolean>;

export interface ScreenshotDiagnosticEvent {
  jobId: string;
  stage: ScreenshotDiagnosticStage;
  phase: ScreenshotDiagnosticPhase;
  timestamp: number;
  durationMs?: number;
  senderWebContentsId?: number;
  code?: ScreenshotErrorCode;
  message?: string;
  context?: Readonly<Record<string, ScreenshotDiagnosticContextValue>>;
}

export type ScreenshotDiagnosticListener = (
  event: Readonly<ScreenshotDiagnosticEvent>
) => void;

/** 诊断回调不能影响截图主流程；宿主日志实现抛错时直接隔离。 */
export function emitScreenshotDiagnostic(
  listener: ScreenshotDiagnosticListener | undefined,
  event: ScreenshotDiagnosticEvent
): void {
  try {
    listener?.(event);
  } catch {
    // 日志钩子属于旁路能力，不能让截图任务失败。
  }
}
