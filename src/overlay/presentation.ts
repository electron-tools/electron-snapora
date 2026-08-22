import type {
  ScreenshotLocale,
  ScreenshotMessageOverrides,
  ScreenshotMessages,
  ScreenshotTheme,
} from '../types.js';

export const DEFAULT_SCREENSHOT_LOCALE: ScreenshotLocale = 'en-US';

const ENGLISH_MESSAGES: ScreenshotMessages = {
  preparing: 'Preparing screenshot…',
  instruction: 'Hover a window or drag to select · Esc to cancel',
  exporting: 'Exporting screenshot…',
  copied: 'Copied to clipboard',
  saveCancelled: 'Save cancelled',
  copy: 'Copy',
  cancel: 'Cancel',
  save: 'Save',
  close: 'Close',
  pin: 'Pin to screen',
  confirm: 'Done',
  select: 'Select',
  rectangle: 'Rectangle',
  ellipse: 'Ellipse',
  arrow: 'Arrow',
  brush: 'Brush',
  text: 'Text',
  textDefault: 'Default',
  textFill: 'Fill',
  textOutline: 'Outline',
  mosaic: 'Mosaic',
  watermark: 'Watermark',
  undo: 'Undo',
  redo: 'Redo',
  color: 'Color',
  customColor: 'Custom color',
  lineWidth: 'Line width',
  fontSize: 'Font size',
  mosaicStrength: 'Mosaic strength',
  opacity: 'Opacity',
  watermarkPlaceholder: 'Up to 16 characters',
  annotationCanvas: 'Screenshot annotations',
  selection: 'Screenshot selection',
  actions: 'Screenshot actions',
  annotationTools: 'Annotation tools',
  history: 'History',
  annotationStyle: 'Annotation style',
  outputActions: 'Output actions',
  annotationText: 'Annotation text',
};

const LOCALE_MESSAGES: Record<ScreenshotLocale, Partial<ScreenshotMessages>> = {
  'en-US': ENGLISH_MESSAGES,
  'zh-CN': {
    preparing: '正在准备截图…',
    instruction: '悬停窗口或拖动选择区域 · Esc 取消',
    exporting: '正在生成截图…',
    copied: '已复制到剪贴板',
    saveCancelled: '已取消保存',
    copy: '复制',
    cancel: '取消',
    save: '保存',
    close: '关闭',
    pin: '固定到屏幕',
    confirm: '完成',
    select: '选择',
    rectangle: '矩形',
    ellipse: '椭圆',
    arrow: '箭头',
    brush: '画笔',
    text: '文字',
    textDefault: '默认',
    textFill: '填充',
    textOutline: '描边',
    mosaic: '马赛克',
    watermark: '水印',
    undo: '撤销',
    redo: '重做',
    color: '颜色',
    customColor: '自定义颜色',
    lineWidth: '线宽',
    fontSize: '字号',
    mosaicStrength: '模糊度',
    opacity: '不透明度',
    watermarkPlaceholder: '最多输入 16 个字符',
    annotationCanvas: '截图标注画布',
    selection: '截图选区',
    actions: '截图操作',
    annotationTools: '标注工具',
    history: '操作历史',
    annotationStyle: '标注样式',
    outputActions: '输出操作',
    annotationText: '标注文字',
  },
};

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

/** 文案按英文基线、所选语言、宿主覆盖三层合并，局部翻译不会产生 undefined。 */
export function resolveScreenshotMessages(
  locale: ScreenshotLocale = DEFAULT_SCREENSHOT_LOCALE,
  overrides: ScreenshotMessageOverrides = {}
): ScreenshotMessages {
  return {
    ...ENGLISH_MESSAGES,
    ...LOCALE_MESSAGES[locale],
    ...overrides,
  };
}
