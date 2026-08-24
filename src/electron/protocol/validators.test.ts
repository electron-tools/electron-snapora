import { describe, expect, it } from 'vitest';

import { SCREENSHOT_PROTOCOL_VERSION } from './messages.js';
import {
  isCancelPayload,
  isCompletePayload,
  isErrorPayload,
  isOutputPayload,
  isPreparedPayload,
  isReadyPayload,
  parseScreenshotOptions,
} from './validators.js';

describe('screenshot protocol validators', () => {
  it('accepts the supported ready protocol', () => {
    expect(isReadyPayload({ protocolVersion: SCREENSHOT_PROTOCOL_VERSION })).toBe(true);
    expect(isReadyPayload({ protocolVersion: 999 })).toBe(false);
  });

  it('validates the prepared frame against the active job', () => {
    const payload = {
      protocolVersion: SCREENSHOT_PROTOCOL_VERSION,
      jobId: 'job-1',
    };
    expect(isPreparedPayload(payload, 'job-1')).toBe(true);
    expect(isPreparedPayload(payload, 'job-2')).toBe(false);
  });

  it('validates a completed result and its job id', () => {
    const payload = {
      protocolVersion: SCREENSHOT_PROTOCOL_VERSION,
      jobId: 'job-1',
      result: {
        status: 'completed',
        data: new Uint8Array([1, 2, 3]),
        mimeType: 'image/png',
        bounds: { x: 0, y: 0, width: 20, height: 10 },
        displayId: 'display-1',
        output: { action: 'copy' },
      },
    };

    expect(isCompletePayload(payload, 'job-1')).toBe(true);
    expect(isCompletePayload(payload, 'job-2')).toBe(false);
    expect(
      isCompletePayload(
        { ...payload, result: { ...payload.result, output: undefined } },
        'job-1'
      )
    ).toBe(false);
    expect(
      isCompletePayload(
        { ...payload, result: { ...payload.result, data: new Uint8Array() } },
        'job-1'
      )
    ).toBe(false);
    expect(isCompletePayload(payload, 'job-1', 2)).toBe(false);
  });

  it('validates cancel and error messages', () => {
    expect(
      isCancelPayload(
        { protocolVersion: SCREENSHOT_PROTOCOL_VERSION, jobId: 'job-1' },
        'job-1'
      )
    ).toBe(true);
    expect(
      isErrorPayload(
        {
          protocolVersion: SCREENSHOT_PROTOCOL_VERSION,
          jobId: 'job-1',
          code: 'EXPORT_FAILED',
          message: 'Unable to export.',
        },
        'job-1'
      )
    ).toBe(true);
    expect(
      isErrorPayload(
        {
          protocolVersion: SCREENSHOT_PROTOCOL_VERSION,
          jobId: 'job-1',
          code: 'UNKNOWN_CODE',
          message: 'Nope.',
        },
        'job-1'
      )
    ).toBe(false);
    expect(
      isErrorPayload(
        {
          protocolVersion: SCREENSHOT_PROTOCOL_VERSION,
          jobId: 'job-1',
          code: 'CAPTURE_FAILED',
          message: 'Use the image fallback.',
          fallback: 'capture-image',
        },
        'job-1'
      )
    ).toBe(true);
    expect(
      isErrorPayload(
        {
          protocolVersion: SCREENSHOT_PROTOCOL_VERSION,
          jobId: 'job-1',
          code: 'EXPORT_FAILED',
          message: 'Invalid fallback request.',
          fallback: 'capture-image',
        },
        'job-1'
      )
    ).toBe(false);
  });

  it('validates save and clipboard output requests', () => {
    const result = {
      status: 'completed',
      data: new Uint8Array([0x89, 0x50]),
      mimeType: 'image/png',
      bounds: { x: 0, y: 0, width: 20, height: 10 },
      displayId: 'display-1',
    };
    expect(
      isOutputPayload({
        protocolVersion: SCREENSHOT_PROTOCOL_VERSION,
        jobId: 'job-1',
        action: 'save',
        result,
      })
    ).toBe(true);
    expect(
      isOutputPayload({
        protocolVersion: SCREENSHOT_PROTOCOL_VERSION,
        jobId: 'job-1',
        action: 'unknown',
        result,
      })
    ).toBe(false);
    expect(
      isOutputPayload(
        {
          protocolVersion: SCREENSHOT_PROTOCOL_VERSION,
          jobId: 'job-1',
          action: 'copy',
          result,
        },
        1
      )
    ).toBe(false);
  });

  it('parses and copies supported host screenshot options', () => {
    const input = {
      display: 'primary',
      tools: ['text', 'rectangle', 'watermark', 'text'],
      defaultTool: 'text',
      showCopyFeedback: true,
      locale: 'zh-CN',
      messages: {
        confirm: '复制到输入框',
        copied: '截图已复制',
        save: '存图',
      },
      theme: {
        mode: 'light',
        accentColor: '#1677ff',
        toolbarForeground: '#111111',
        warningColor: '#f59e0b',
      },
    };

    expect(parseScreenshotOptions(input)).toEqual({
      success: true,
      value: {
        display: 'primary',
        tools: ['text', 'rectangle', 'watermark'],
        defaultTool: 'text',
        showCopyFeedback: true,
        locale: 'zh-CN',
        messages: {
          confirm: '复制到输入框',
          copied: '截图已复制',
          save: '存图',
        },
        theme: {
          mode: 'light',
          accentColor: '#1677ff',
          toolbarForeground: '#111111',
          warningColor: '#f59e0b',
        },
      },
    });
  });

  it.each([
    null,
    { unknown: true },
    { display: '' },
    { tools: ['crop'] },
    { tools: Array.from({ length: 8 }, () => 'text') },
    { tools: ['rectangle'], defaultTool: 'text' },
    { showCopyFeedback: 'yes' },
    { locale: 'fr-FR' },
    { messages: { unknown: 'value' } },
    { messages: { confirm: '' } },
    { theme: { mode: 'system' } },
    { theme: { accentColor: '' } },
    { includeCursor: 'yes' },
  ])('rejects malformed host options: %o', (input) => {
    expect(parseScreenshotOptions(input)).toMatchObject({ success: false });
  });
});
