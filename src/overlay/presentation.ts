import type { ScreenshotTheme } from '../types.js';

export { DEFAULT_SCREENSHOT_LOCALE, resolveScreenshotMessages } from '../i18n/index.js';

const THEME_TOKEN_MAP = {
  accentColor: '--snapora-color-accent',
  accentForegroundColor: '--snapora-color-on-accent',
  maskColor: '--snapora-color-mask',
  toolbarBackground: '--snapora-color-surface',
  toolbarForeground: '--snapora-color-on-surface',
  toolbarBorderColor: '--snapora-color-border',
  toolbarHoverBackground: '--snapora-color-hover',
  tooltipBackground: '--snapora-color-tooltip',
  tooltipForeground: '--snapora-color-on-tooltip',
  destructiveColor: '--snapora-color-danger',
  warningColor: '--snapora-color-warning',
  warningForegroundColor: '--snapora-color-on-warning',
  selectionHandleColor: '--snapora-color-handle',
  copyFeedbackBackground: '--snapora-copy-background',
  copyFeedbackForeground: '--snapora-copy-foreground',
  copyFeedbackBorderColor: '--snapora-copy-border',
  copyFeedbackIconColor: '--snapora-copy-icon',
  copyFeedbackIconBackground: '--snapora-copy-icon-background',
} as const satisfies Record<Exclude<keyof ScreenshotTheme, 'mode'>, string>;

export interface ResolvedScreenshotTheme {
  mode: NonNullable<ScreenshotTheme['mode']>;
  tokens: Readonly<Record<string, string>>;
}

/** 宿主只覆盖语义 Token，组件层继续引用稳定别名，避免公共 API 绑定具体 DOM。 */
export function resolveScreenshotTheme(
  theme: ScreenshotTheme | undefined
): ResolvedScreenshotTheme {
  const tokens: Record<string, string> = {};
  for (const [key, token] of Object.entries(THEME_TOKEN_MAP)) {
    const value = theme?.[key as keyof typeof THEME_TOKEN_MAP];
    if (value) {
      tokens[token] = value;
    }
  }
  return { mode: theme?.mode ?? 'dark', tokens };
}
