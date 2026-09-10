import type {
  ScreenshotLocale,
  ScreenshotMessageOverrides,
  ScreenshotMessages,
} from '../types.js';
import enUS from './en-US.js';
import zhCN from './zh-CN.js';
import jaJP from './ja-JP.js';
import koKR from './ko-KR.js';
import esES from './es-ES.js';

export const DEFAULT_SCREENSHOT_LOCALE: ScreenshotLocale = 'en-US';

export const LOCALE_MESSAGES = {
  'en-US': enUS,
  'zh-CN': zhCN,
  'ja-JP': jaJP,
  'ko-KR': koKR,
  'es-ES': esES,
} satisfies Record<ScreenshotLocale, ScreenshotMessages>;

export function isScreenshotLocale(value: unknown): value is ScreenshotLocale {
  return typeof value === 'string' && Object.hasOwn(LOCALE_MESSAGES, value);
}

/** 英文基线、内置语言包、宿主自定义文案依次覆盖。 */
export function resolveScreenshotMessages(
  locale: ScreenshotLocale = DEFAULT_SCREENSHOT_LOCALE,
  overrides: ScreenshotMessageOverrides = {}
): ScreenshotMessages {
  return { ...enUS, ...LOCALE_MESSAGES[locale], ...overrides };
}
