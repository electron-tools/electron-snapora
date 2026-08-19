export {
  ScreenshotManager,
  type ScreenshotExecution,
  type ScreenshotBusyPolicy,
  type ScreenshotJobContext,
  type ScreenshotRunner,
  type ScreenshotManagerOptions,
  type ScreenshotManagerIpcMain,
} from './electron/main/screenshot-manager.js';
export {
  ElectronCaptureAdapter,
  type ElectronCaptureAdapterOptions,
} from './electron/main/electron-capture-adapter.js';
export { ScreenshotError } from './electron/main/errors.js';
export {
  ElectronOutputAdapter,
  type ElectronOutputAdapterOptions,
  type ScreenshotOutputExecutor,
} from './electron/main/electron-output-adapter.js';
export {
  OverlayWindow,
  type OverlayWindowOptions,
  type ScreenshotOverlayWindow,
} from './electron/main/overlay-window.js';
export {
  resolveHostPreloadPath,
  resolveOverlayResources,
  assertOverlayResources,
  type OverlayResources,
  type PackagedResourceExists,
} from './electron/main/resource-paths.js';
export {
  ScreenshotSession,
  type ScreenshotOverlayFactory,
  type ScreenshotSessionOptions,
  type ScreenshotSessionState,
} from './electron/main/screenshot-session.js';
export {
  registerScreenshotIpc,
  type RegisterScreenshotIpcOptions,
  type ValidateScreenshotIpcSender,
} from './electron/main/register-host-ipc.js';
export {
  DEFAULT_HOST_CANCEL_CHANNEL,
  DEFAULT_HOST_CAPTURE_CHANNEL,
  OVERLAY_CHANNELS,
} from './electron/protocol/channels.js';
export { SCREENSHOT_PROTOCOL_VERSION } from './electron/protocol/messages.js';
export {
  DEFAULT_SCREENSHOT_RESOURCE_LIMITS,
  HARD_SCREENSHOT_RESOURCE_LIMITS,
  resolveScreenshotResourceLimits,
  type ScreenshotResourceLimitOptions,
  type ScreenshotResourceLimits,
} from './electron/protocol/limits.js';
export type {
  CaptureDisplay,
  CapturedFrame,
  ScreenCaptureAdapter,
  ScreenshotCancelPayload,
  ScreenshotCompletePayload,
  ScreenshotErrorPayload,
  ScreenshotInitializePayload,
  ScreenshotOutputAction,
  ScreenshotOutputPayload,
  ScreenshotOutputResponse,
  ScreenshotReadyPayload,
} from './electron/protocol/messages.js';
export type {
  ScreenshotBounds,
  ScreenshotErrorCode,
  ScreenshotImageResult,
  ScreenshotLocale,
  ScreenshotMessageOverrides,
  ScreenshotMessages,
  ScreenshotOptions,
  ScreenshotOutputMetadata,
  ScreenshotResult,
  ScreenshotTheme,
  ScreenshotTool,
} from './types.js';
