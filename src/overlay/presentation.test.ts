import { describe, expect, it } from 'vitest';
import { LOCALE_MESSAGES, isScreenshotLocale } from '../i18n/index.js';
import { parseScreenshotOptions } from '../electron/protocol/validators.js';

import {
  DEFAULT_SCREENSHOT_LOCALE,
  resolveScreenshotMessages,
  resolveScreenshotTheme,
} from './presentation.js';

describe('overlay presentation', () => {
  it('registers English first and supplies every message in all five locales', () => {
    expect(Object.keys(LOCALE_MESSAGES)).toEqual([
      'en-US',
      'zh-CN',
      'ja-JP',
      'ko-KR',
      'es-ES',
    ]);
    const keys = Object.keys(LOCALE_MESSAGES['en-US']).sort();
    for (const [locale, messages] of Object.entries(LOCALE_MESSAGES)) {
      expect(Object.keys(messages).sort()).toEqual(keys);
      expect(Object.values(messages).every((value) => value.trim().length > 0)).toBe(
        true
      );
      expect(parseScreenshotOptions({ locale })).toEqual({
        success: true,
        value: { locale },
      });
    }
    for (const locale of ['fr-FR', 'constructor', '__proto__', '', null]) {
      expect(isScreenshotLocale(locale)).toBe(false);
      expect(parseScreenshotOptions({ locale }).success).toBe(false);
    }
  });

  it.each([
    ['ja-JP', 'コピー', 'クリップボードにコピーしました'],
    ['ko-KR', '복사', '클립보드에 복사되었습니다'],
    ['es-ES', 'Copiar', 'Copiado al portapapeles'],
  ] as const)(
    'resolves %s for the overlay and pinned actions with host overrides last',
    (locale, copy, copied) => {
      expect(resolveScreenshotMessages(locale)).toMatchObject({ copy, copied });
      expect(resolveScreenshotMessages(locale, { copied: 'Custom' })).toMatchObject({
        copy,
        copied: 'Custom',
      });
    }
  );

  it('uses a deterministic English default and applies host message overrides last', () => {
    expect(DEFAULT_SCREENSHOT_LOCALE).toBe('en-US');
    expect(resolveScreenshotMessages().confirm).toBe('Done');
    expect(resolveScreenshotMessages('zh-CN').copied).toBe('已复制到剪贴板');
    expect(resolveScreenshotMessages('zh-CN').watermark).toBe('水印');
    expect(resolveScreenshotMessages('zh-CN')).toMatchObject({
      copy: '复制',
      save: '保存',
      close: '关闭',
    });
    expect(
      resolveScreenshotMessages('zh-CN', {
        confirm: '复制到聊天框',
      })
    ).toMatchObject({
      confirm: '复制到聊天框',
      cancel: '取消',
      annotationCanvas: '截图标注画布',
    });
  });

  it('maps host theme values to semantic CSS tokens without exposing components', () => {
    expect(
      resolveScreenshotTheme({
        mode: 'light',
        accentColor: '#6750a4',
        toolbarForeground: '#1d1b20',
        tooltipBackground: '#ffffff',
        warningColor: '#f59e0b',
        copyFeedbackBackground: '#ffffff',
        copyFeedbackForeground: '#111111',
        copyFeedbackBorderColor: '#dff3eb',
        copyFeedbackIconColor: '#20b88a',
        copyFeedbackIconBackground: '#e4f8ef',
      })
    ).toEqual({
      mode: 'light',
      tokens: {
        '--snapora-color-accent': '#6750a4',
        '--snapora-color-on-surface': '#1d1b20',
        '--snapora-color-tooltip': '#ffffff',
        '--snapora-color-warning': '#f59e0b',
        '--snapora-copy-background': '#ffffff',
        '--snapora-copy-foreground': '#111111',
        '--snapora-copy-border': '#dff3eb',
        '--snapora-copy-icon': '#20b88a',
        '--snapora-copy-icon-background': '#e4f8ef',
      },
    });
  });
});
