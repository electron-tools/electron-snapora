import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SCREENSHOT_LOCALE,
  resolveScreenshotMessages,
  resolveScreenshotTheme,
} from './presentation.js';

describe('overlay presentation', () => {
  it('uses a deterministic English default and applies host message overrides last', () => {
    expect(DEFAULT_SCREENSHOT_LOCALE).toBe('en-US');
    expect(resolveScreenshotMessages().confirm).toBe('Copy & Done');
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
      })
    ).toEqual({
      mode: 'light',
      tokens: {
        '--snapora-color-accent': '#6750a4',
        '--snapora-color-on-surface': '#1d1b20',
        '--snapora-color-tooltip': '#ffffff',
      },
    });
  });
});
