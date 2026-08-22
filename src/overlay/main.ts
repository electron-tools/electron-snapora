import './styles.css';

import {
  viewportPointToImagePoint,
  type Point,
  type Rect,
  type Size,
} from '../core/geometry/rect.js';
import type {
  AnnotationElement,
  TextElement,
  TextStyle,
} from '../core/model/document.js';
import type { ScreenshotInitializePayload } from '../electron/protocol/messages.js';
import type {
  ScreenshotMessages,
  ScreenshotOptions,
  ScreenshotTool,
} from '../types.js';
import {
  calculateTextBaselinePosition,
  createDrawableElement,
  getElementBounds,
  getResizeHandleAtPoint,
  getTextContrastColor,
  hitTestElement,
  isDrawableElementValid,
  measureTextBaselineMetrics,
  measureTextLayout,
  scaleElementToBounds,
  translateElement,
  updateDrawableElement,
  updateElementStyle,
  wrapTextToWidth,
  TEXT_LINE_HEIGHT,
  type AnnotationElementStyle,
} from './annotation-elements.js';
import { drawAnnotations, type WatermarkOptions } from './annotation-renderer.js';
import {
  createAnnotationStore,
  getRenderableElements,
  type AnnotationTool,
} from './annotation-store.js';
import { exportSelectionPng } from './export-selection.js';
import { resolveScreenshotMessages, resolveScreenshotTheme } from './presentation.js';
import {
  calculateToolbarPosition,
  clampPoint,
  resizeSelection,
  viewportRectToImageRect,
  viewportRectToScreenRect,
  type ResizeHandle,
} from './selection-geometry.js';
import { createOverlayStore } from './selection-store.js';

type DrawingElement = Exclude<AnnotationElement, TextElement>;
type DrawingTool = Exclude<ScreenshotTool, 'text' | 'watermark'>;
type PresetKind = 'stroke' | 'text' | 'mosaic' | 'watermark';

interface HsvColor {
  hue: number;
  saturation: number;
  value: number;
}

type PointerInteraction =
  | { kind: 'draw'; pointerId: number; origin: Point; element: DrawingElement }
  | {
      kind: 'move-element';
      pointerId: number;
      origin: Point;
      before: AnnotationElement;
    }
  | {
      kind: 'resize-element';
      pointerId: number;
      before: AnnotationElement;
      handle: ResizeHandle;
    }
  | {
      kind: 'window-snap';
      pointerId: number;
      origin: Point;
      selection: Rect;
    }
  | { kind: 'selection'; pointerId: number };

function requireElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Electron Snapora overlay element is missing: ${selector}`);
  }
  return element;
}

function requireCanvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Electron Snapora could not create the annotation canvas.');
  }
  return context;
}

const surface = requireElement('.capture-surface');
const status = requireElement('.status');
const copyFeedback = requireElement('.copy-feedback');
const copyFeedbackText = requireElement('.copy-feedback-text');
const screenFrame = requireElement<HTMLImageElement>('.screen-frame');
const screenMask = requireElement('.screen-mask');
const annotationCanvas = requireElement<HTMLCanvasElement>('.annotation-canvas');
const annotationContext = requireCanvasContext(annotationCanvas);
const selectionElement = requireElement('.selection');
const windowSnapPreview = requireElement<HTMLElement>('.window-snap-preview');
const sizeHint = requireElement<HTMLOutputElement>('.size-hint');
const toolbar = requireElement('.selection-toolbar');
const textEditor = requireElement<HTMLTextAreaElement>('.text-editor');
const cancelButton = requireElement<HTMLButtonElement>('.cancel-button');
const saveButton = requireElement<HTMLButtonElement>('.save-button');
const pinButton = requireElement<HTMLButtonElement>('.pin-button');
const confirmButton = requireElement<HTMLButtonElement>('.confirm-button');
const undoButton = requireElement<HTMLButtonElement>('.undo-button');
const redoButton = requireElement<HTMLButtonElement>('.redo-button');
const presetPanel = requireElement<HTMLElement>('.preset-panel');
const colorInput = requireElement<HTMLInputElement>('.color-input');
const colorPickerPopover = requireElement<HTMLElement>('.color-picker-popover');
const colorPickerSaturation = requireElement<HTMLElement>('.color-picker-saturation');
const colorPickerSelector = requireElement<HTMLElement>('.color-picker-selector');
const colorPickerHue = requireElement<HTMLInputElement>('.color-picker-hue');
const fontSizeSelect = requireElement<HTMLSelectElement>('.font-size-select');
const colorControl = requireElement<HTMLElement>('.color-control');
const fontControl = requireElement<HTMLElement>('.font-control');
const colorPalette = requireElement<HTMLElement>('.color-palette');
const mosaicStrengthInput = requireElement<HTMLInputElement>('.mosaic-strength-input');
const mosaicStrengthOutput = requireElement<HTMLOutputElement>(
  '.mosaic-strength-output'
);
const mosaicStrengthControl = requireElement<HTMLElement>('.mosaic-strength-control');
const mosaicStrengthLabel = requireElement<HTMLElement>(
  '.mosaic-strength-control .range-label'
);
const watermarkTextInput = requireElement<HTMLInputElement>('.watermark-text-input');
const watermarkOpacityInput = requireElement<HTMLInputElement>(
  '.watermark-opacity-input'
);
const watermarkOpacityOutput = requireElement<HTMLOutputElement>(
  '.watermark-opacity-output'
);
const watermarkOpacityControl = requireElement<HTMLElement>(
  '.watermark-opacity-control'
);
const watermarkOpacityLabel = requireElement<HTMLElement>(
  '.watermark-opacity-control .range-label'
);
const toolGroup = requireElement<HTMLElement>('.tool-group');
const historyGroup = requireElement<HTMLElement>('.history-group');
const actionGroup = requireElement<HTMLElement>('.action-group');
const toolButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('[data-tool]')
);
const lineWidthButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('[data-line-width]')
);
const textStyleButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('[data-text-style]')
);
const colorButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('[data-color]')
);

const selectionStore = createOverlayStore();
const annotationStore = createAnnotationStore();
let pointerInteraction: PointerInteraction | null = null;
let resetAnnotationsAfterSelection = true;
let configuredDefaultTool: AnnotationTool = 'select';
let windowSnapRegions: Rect[] = [];
let hoveredWindowSnap: Rect | null = null;
let pendingTextPoint: Point | null = null;
let pendingTextViewportPoint: Point | null = null;
// 固定预设只保存颜色值；单独记录来源，确保相同色值也能呈现为“自定义”。
let customColorSelected = false;
let customColor = colorInput.value.toLowerCase();
let customColorHsv = hexToHsv(customColor);
let colorPickerPointerId: number | null = null;
let outputFeedback: string | null = null;
let exportProgressVisible = false;
let exportProgressTimer: number | undefined;
let currentMessages: ScreenshotMessages = resolveScreenshotMessages();

const EXPORT_PROGRESS_DELAY_MS = 180;
/** 水印字号固定为紧凑预设，避免给面板再增加一个低价值控件。 */
const WATERMARK_FONT_SIZE = 18;

/** 捕获帧加载完成后才开放选区和标注，确保三套坐标使用同一实际图片尺寸。 */
function initializeOverlay(payload: ScreenshotInitializePayload): void {
  const frame = payload.frames[0];
  if (!frame) {
    window.snaporaOverlay.reportError({
      jobId: payload.jobId,
      code: 'CAPTURE_FAILED',
      message: 'The screenshot overlay received no captured frame.',
    });
    return;
  }

  configuredDefaultTool = payload.options.defaultTool ?? 'select';
  windowSnapRegions = resolveWindowSnapRegions(payload, frame.display.bounds);
  hoveredWindowSnap = null;
  selectionStore.dispatch({ type: 'initialize', payload });
  applyTheme(payload.options);
  applyLocale(payload.options);
  applyToolAvailability(payload.options.tools);
  screenFrame.onload = async () => {
    annotationCanvas.width = frame.pixelSize.width;
    annotationCanvas.height = frame.pixelSize.height;
    selectionStore.dispatch({ type: 'image-ready' });
    // 图片解码后保留两次合成机会，但共享一个截止时间，避免透明窗口被节流时串行等待。
    screenFrame.getBoundingClientRect();
    await waitForCompositeFrames();
    window.snaporaOverlay.prepared(payload.jobId);
  };
  screenFrame.onerror = () => {
    window.snaporaOverlay.reportError({
      jobId: payload.jobId,
      code: 'CAPTURE_FAILED',
      message: 'The captured screen image could not be loaded.',
    });
  };
  screenFrame.src = frame.dataUrl;
}

window.snaporaOverlay.onInitialize(initializeOverlay);
window.snaporaOverlay.onFeedback((payload) => {
  if (payload.kind !== 'copy') {
    return;
  }
  clearExportProgress();
  applyTheme(payload.options);
  applyLocale(payload.options);
  document.documentElement.dataset.snaporaFeedback = 'copy';
  surface.dataset.state = 'copied';
  copyFeedbackText.textContent = localize('copied');
  copyFeedback.hidden = false;
  // 隐藏窗口先完成 Toast 合成再通知主进程显示，避免露出加载前的状态帧。
  void waitForCompositeFrames().then(() => window.snaporaOverlay.feedbackReady());
});
selectionStore.subscribe(render);
annotationStore.subscribe(render);

annotationCanvas.addEventListener('pointerdown', handleCanvasPointerDown);
annotationCanvas.addEventListener('pointermove', handleCanvasPointerMove);
annotationCanvas.addEventListener('pointerup', handleCanvasPointerEnd);
annotationCanvas.addEventListener('pointercancel', handleCanvasPointerEnd);
annotationCanvas.addEventListener('dblclick', handleCanvasDoubleClick);
annotationCanvas.addEventListener('pointerleave', () => {
  if (!pointerInteraction) {
    updateWindowSnapPreview(null);
  }
});

selectionElement.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) {
    return;
  }
  const handle = (event.target as HTMLElement).dataset.handle as
    ResizeHandle | undefined;
  if (!handle || annotationStore.getState().activeTool !== 'select') {
    return;
  }

  event.stopPropagation();
  surface.setPointerCapture(event.pointerId);
  pointerInteraction = { kind: 'selection', pointerId: event.pointerId };
  selectionStore.dispatch({ type: 'begin-resize', pointerId: event.pointerId, handle });
});

surface.addEventListener('pointermove', (event) => {
  if (pointerInteraction?.kind !== 'selection') {
    return;
  }
  selectionStore.dispatch({
    type: 'pointer-move',
    pointerId: event.pointerId,
    point: toSurfacePoint(event),
    bounds: getSurfaceBounds(),
  });
});
surface.addEventListener('pointerup', endSelectionPointer);
surface.addEventListener('pointercancel', endSelectionPointer);

for (const button of toolButtons) {
  button.addEventListener('click', () => {
    closeColorPicker();
    const tool = button.dataset.tool as AnnotationTool;
    annotationStore.setTool(tool);
    if (tool === 'watermark') {
      watermarkTextInput.focus();
    }
  });
}
undoButton.addEventListener('click', () => annotationStore.undo());
redoButton.addEventListener('click', () => annotationStore.redo());
for (const button of lineWidthButtons) {
  button.addEventListener('click', () => {
    const lineWidth = Number(button.dataset.lineWidth);
    annotationStore.setStyle({ lineWidth });
    commitSelectedElementStyle({ lineWidth: lineWidth * getImageScale() });
  });
}
for (const button of textStyleButtons) {
  button.addEventListener('click', () => {
    applyTextStyle(button.dataset.textStyle as TextStyle);
  });
}
for (const button of colorButtons) {
  button.addEventListener('click', () => {
    closeColorPicker();
    customColorSelected = false;
    applyColor(button.dataset.color ?? '#ff3b30');
  });
}
colorControl.addEventListener('click', toggleColorPicker);
colorInput.addEventListener('input', () => {
  customColorSelected = true;
  customColor = colorInput.value.toLowerCase();
  customColorHsv = hexToHsv(customColor);
  renderColorPicker();
  annotationStore.setStyle({ color: colorInput.value });
});
colorInput.addEventListener('change', () => {
  customColorSelected = true;
  customColor = colorInput.value.toLowerCase();
  customColorHsv = hexToHsv(customColor);
  renderColorPicker();
  commitSelectedElementStyle({ color: colorInput.value });
});
colorPickerSaturation.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) {
    return;
  }
  colorPickerPointerId = event.pointerId;
  if (event.isTrusted) {
    colorPickerSaturation.setPointerCapture(event.pointerId);
  }
  updateColorPickerSaturation(event, false);
});
colorPickerSaturation.addEventListener('pointermove', (event) => {
  if (event.pointerId === colorPickerPointerId) {
    updateColorPickerSaturation(event, false);
  }
});
/** 结束饱和度拖动时只提交一次已选元素样式，避免污染撤销历史。 */
const finishColorPickerPointer = (event: PointerEvent): void => {
  if (event.pointerId !== colorPickerPointerId) {
    return;
  }
  colorPickerPointerId = null;
  if (event.type === 'pointercancel') {
    applyCustomPickerColor(true);
  } else {
    updateColorPickerSaturation(event, true);
  }
};
colorPickerSaturation.addEventListener('pointerup', finishColorPickerPointer);
colorPickerSaturation.addEventListener('pointercancel', finishColorPickerPointer);
colorPickerSaturation.addEventListener('keydown', handleColorPickerKeyboard);
colorPickerHue.addEventListener('input', () => {
  customColorHsv.hue = Number(colorPickerHue.value);
  applyCustomPickerColor(false);
});
colorPickerHue.addEventListener('change', () => applyCustomPickerColor(true));
document.addEventListener('pointerdown', (event) => {
  const target = event.target as Node;
  if (
    !colorPickerPopover.hidden &&
    !colorPickerPopover.contains(target) &&
    !colorControl.contains(target)
  ) {
    closeColorPicker();
  }
});
fontSizeSelect.addEventListener('change', () => {
  applyFontSize(Number(fontSizeSelect.value));
});
mosaicStrengthInput.addEventListener('input', () => {
  const strength = Number(mosaicStrengthInput.value);
  annotationStore.setStyle({ mosaicStrength: strength });
  mosaicStrengthOutput.value = formatMosaicStrength(strength);
});
mosaicStrengthInput.addEventListener('change', () => {
  commitSelectedElementStyle({
    mosaicStrength: Number(mosaicStrengthInput.value) * getImageScale(),
  });
});
watermarkTextInput.addEventListener('input', render);
watermarkOpacityInput.addEventListener('input', () => {
  watermarkOpacityOutput.value = `${watermarkOpacityInput.value}%`;
  render();
});
cancelButton.addEventListener('click', cancelCapture);
confirmButton.addEventListener('click', () => void confirmCapture());
saveButton.addEventListener('click', () => void confirmCapture('save'));
pinButton.addEventListener('click', () => void confirmCapture('pin'));

textEditor.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.stopPropagation();
    closeTextEditor(false);
  } else if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    event.stopPropagation();
    closeTextEditor(true);
  }
});
textEditor.addEventListener('blur', () => closeTextEditor(true));
textEditor.addEventListener('input', resizeTextEditor);

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !colorPickerPopover.hidden) {
    event.preventDefault();
    closeColorPicker();
    colorControl.focus();
    return;
  }
  if (!textEditor.hidden) {
    return;
  }
  const eventTarget = event.target;
  if (
    eventTarget instanceof HTMLElement &&
    eventTarget.matches('input, select, textarea')
  ) {
    if (event.key === 'Escape') {
      eventTarget.blur();
    }
    return;
  }
  const commandKey = event.ctrlKey || event.metaKey;
  if (commandKey && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    if (event.shiftKey) {
      annotationStore.redo();
    } else {
      annotationStore.undo();
    }
    return;
  }
  if (commandKey && event.key.toLowerCase() === 'y') {
    event.preventDefault();
    annotationStore.redo();
    return;
  }
  if (commandKey && event.key.toLowerCase() === 'c') {
    event.preventDefault();
    void confirmCapture('copy');
    return;
  }
  if (commandKey && event.key.toLowerCase() === 's') {
    event.preventDefault();
    void confirmCapture('save');
    return;
  }
  if (!commandKey && !event.altKey) {
    const toolShortcuts: Partial<Record<string, AnnotationTool>> = {
      v: 'select',
      r: 'rectangle',
      o: 'ellipse',
      a: 'arrow',
      p: 'brush',
      t: 'text',
      m: 'mosaic',
      w: 'watermark',
    };
    const tool = toolShortcuts[event.key.toLowerCase()];
    const button = toolButtons.find(
      (candidate) => candidate.dataset.tool === tool && !candidate.hidden
    );
    if (tool && button) {
      event.preventDefault();
      annotationStore.setTool(tool);
      return;
    }
  }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault();
    annotationStore.deleteSelected();
    return;
  }
  if (event.key === 'Escape') {
    cancelCapture();
  } else if (event.key === 'Enter') {
    event.preventDefault();
    void confirmCapture();
  }
});
window.snaporaOverlay.ready();

function handleCanvasPointerDown(event: PointerEvent): void {
  if (event.button !== 0 || selectionStore.getState().phase === 'waiting') {
    return;
  }
  // textarea 会被下一次文字点击复用，必须在清空并移动它之前提交当前内容。
  if (!textEditor.hidden) {
    closeTextEditor(true);
  }
  event.stopPropagation();
  if (event.isTrusted) {
    annotationCanvas.setPointerCapture(event.pointerId);
  }

  const viewportPoint = toSurfacePoint(event);
  const selection = selectionStore.getState().selection;
  if (!selection || !containsPoint(selection, viewportPoint)) {
    if (
      !selection &&
      hoveredWindowSnap &&
      containsPoint(hoveredWindowSnap, viewportPoint)
    ) {
      resetAnnotationsAfterSelection = true;
      pointerInteraction = {
        kind: 'window-snap',
        pointerId: event.pointerId,
        origin: viewportPoint,
        selection: hoveredWindowSnap,
      };
      return;
    }
    beginSelection(event.pointerId, viewportPoint);
    return;
  }

  const imagePoint = toImagePoint(viewportPoint);
  const annotationState = annotationStore.getState();
  if (annotationState.activeTool === 'select') {
    beginSelectInteraction(event.pointerId, imagePoint, viewportPoint);
  } else if (annotationState.activeTool === 'text') {
    // Canvas 的默认聚焦发生在 pointerdown 处理之后，会让刚打开的文字编辑框立即 blur。
    event.preventDefault();
    annotationCanvas.releasePointerCapture(event.pointerId);
    openTextEditor(viewportPoint, imagePoint);
  } else if (annotationState.activeTool === 'watermark') {
    event.preventDefault();
    annotationCanvas.releasePointerCapture(event.pointerId);
  } else {
    beginDrawInteraction(event.pointerId, imagePoint, annotationState.activeTool);
  }
}

function handleCanvasPointerMove(event: PointerEvent): void {
  const interaction = pointerInteraction;
  if (!interaction) {
    updateWindowSnapPreview(toSurfacePoint(event));
    return;
  }
  if (interaction.pointerId !== event.pointerId) {
    return;
  }
  const viewportPoint = toSurfacePoint(event);
  if (interaction.kind === 'window-snap') {
    if (
      Math.hypot(
        viewportPoint.x - interaction.origin.x,
        viewportPoint.y - interaction.origin.y
      ) < 4
    ) {
      return;
    }
    updateWindowSnapPreview(null);
    beginSelection(event.pointerId, interaction.origin);
    selectionStore.dispatch({
      type: 'pointer-move',
      pointerId: event.pointerId,
      point: viewportPoint,
      bounds: getSurfaceBounds(),
    });
    return;
  }
  if (interaction.kind === 'selection') {
    selectionStore.dispatch({
      type: 'pointer-move',
      pointerId: event.pointerId,
      point: viewportPoint,
      bounds: getSurfaceBounds(),
    });
    return;
  }

  const annotationDocument = annotationStore.getState().document;
  if (!annotationDocument) {
    return;
  }
  const imagePoint = clampPoint(
    toImagePoint(viewportPoint),
    annotationDocument.selection
  );
  if (interaction.kind === 'draw') {
    const currentDraft = annotationStore.getState().draft;
    annotationStore.setDraft(
      updateDrawableElement(
        currentDraft && currentDraft.type !== 'text'
          ? currentDraft
          : interaction.element,
        interaction.origin,
        imagePoint
      )
    );
  } else if (interaction.kind === 'move-element') {
    annotationStore.preview(
      translateElement(
        interaction.before,
        {
          x: imagePoint.x - interaction.origin.x,
          y: imagePoint.y - interaction.origin.y,
        },
        annotationDocument.selection
      )
    );
  } else {
    const nextBounds = resizeSelection(
      getElementBounds(interaction.before),
      interaction.handle,
      imagePoint,
      annotationDocument.selection,
      8
    );
    annotationStore.preview(scaleElementToBounds(interaction.before, nextBounds));
  }
}

function handleCanvasPointerEnd(event: PointerEvent): void {
  const interaction = pointerInteraction;
  if (!interaction || interaction.pointerId !== event.pointerId) {
    return;
  }

  if (interaction.kind === 'selection') {
    finishSelection(event.pointerId);
  } else if (interaction.kind === 'window-snap') {
    if (event.type !== 'pointercancel') {
      commitWindowSnap(event.pointerId, interaction.selection);
    } else {
      updateWindowSnapPreview(null);
    }
  } else if (interaction.kind === 'draw') {
    const draft = annotationStore.getState().draft;
    if (draft && isDrawableElementValid(draft)) {
      // 绘制完成后统一取消自动选中，避免立即出现 resize 控制点干扰连续标注。
      annotationStore.commitDraft(false);
    } else {
      annotationStore.setDraft(null);
    }
  } else {
    const preview = annotationStore.getState().preview;
    if (preview) {
      annotationStore.commitUpdate(interaction.before, preview);
    }
  }
  pointerInteraction = null;
  if (annotationCanvas.hasPointerCapture(event.pointerId)) {
    annotationCanvas.releasePointerCapture(event.pointerId);
  }
}

function handleCanvasDoubleClick(event: MouseEvent): void {
  if (event.button !== 0) {
    return;
  }

  const state = selectionStore.getState();
  if (
    state.phase !== 'selected' ||
    !state.selection ||
    !containsPoint(state.selection, toSurfacePoint(event))
  ) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  void confirmCapture('copy');
}

/** 单击候选窗口时复用现有选区状态机生成精确矩形。 */
function commitWindowSnap(pointerId: number, selection: Rect): void {
  updateWindowSnapPreview(null);
  selectionStore.dispatch({
    type: 'begin-create',
    pointerId,
    point: { x: selection.x, y: selection.y },
    bounds: getSurfaceBounds(),
  });
  selectionStore.dispatch({
    type: 'pointer-move',
    pointerId,
    point: {
      x: selection.x + selection.width,
      y: selection.y + selection.height,
    },
    bounds: getSurfaceBounds(),
  });
  finishSelection(pointerId);
}

function beginSelection(pointerId: number, point: Point): void {
  updateWindowSnapPreview(null);
  resetAnnotationsAfterSelection = true;
  pointerInteraction = { kind: 'selection', pointerId };
  selectionStore.dispatch({
    type: 'begin-create',
    pointerId,
    point,
    bounds: getSurfaceBounds(),
  });
}

function beginSelectInteraction(
  pointerId: number,
  imagePoint: Point,
  viewportPoint: Point
): void {
  const state = annotationStore.getState();
  const elements = getRenderableElements(state);
  const selected = elements.find((element) => element.id === state.selectedElementId);
  const tolerance = getImageScale() * 8;
  const handle = selected
    ? getResizeHandleAtPoint(selected, imagePoint, tolerance)
    : undefined;
  if (selected && handle) {
    pointerInteraction = {
      kind: 'resize-element',
      pointerId,
      before: selected,
      handle,
    };
    return;
  }

  const hit = hitTestElement(elements, imagePoint, tolerance);
  if (hit) {
    annotationStore.select(hit.id);
    pointerInteraction = {
      kind: 'move-element',
      pointerId,
      origin: imagePoint,
      before: hit,
    };
    return;
  }

  annotationStore.select(null);
  selectionStore.dispatch({ type: 'begin-move', pointerId, point: viewportPoint });
  pointerInteraction = { kind: 'selection', pointerId };
  resetAnnotationsAfterSelection = false;
}

function beginDrawInteraction(
  pointerId: number,
  imagePoint: Point,
  tool: DrawingTool
): void {
  const state = annotationStore.getState();
  const imageScale = getImageScale();
  const element = createDrawableElement(
    tool,
    imagePoint,
    {
      ...state.style,
      lineWidth: state.style.lineWidth * imageScale,
      fontSize: state.style.fontSize * imageScale,
      mosaicStrength: state.style.mosaicStrength * imageScale,
    },
    {
      id: crypto.randomUUID(),
      zIndex: getNextZIndex(),
      createdAt: Date.now(),
    }
  );
  annotationStore.select(null);
  annotationStore.setDraft(element);
  pointerInteraction = { kind: 'draw', pointerId, origin: imagePoint, element };
}

function endSelectionPointer(event: PointerEvent): void {
  if (pointerInteraction?.kind !== 'selection') {
    return;
  }
  finishSelection(event.pointerId);
  pointerInteraction = null;
  if (surface.hasPointerCapture(event.pointerId)) {
    surface.releasePointerCapture(event.pointerId);
  }
}

function finishSelection(pointerId: number): void {
  selectionStore.dispatch({ type: 'end-interaction', pointerId });
  const selection = selectionStore.getState().selection;
  const frame = selectionStore.getState().payload?.frames[0];
  if (!selection || !frame) {
    return;
  }
  const imageSelection = viewportRectToImageRect(
    selection,
    getSurfaceSize(),
    frame.pixelSize
  );
  if (resetAnnotationsAfterSelection || !annotationStore.getState().document) {
    annotationStore.initialize(imageSelection, configuredDefaultTool);
  } else {
    annotationStore.setSelection(imageSelection);
  }
  resetAnnotationsAfterSelection = false;
}

function openTextEditor(viewportPoint: Point, imagePoint: Point): void {
  const style = annotationStore.getState().style;
  pendingTextPoint = imagePoint;
  pendingTextViewportPoint = viewportPoint;
  textEditor.value = '';
  textEditor.hidden = false;
  textEditor.style.transform = `translate(${viewportPoint.x}px, ${viewportPoint.y}px)`;
  applyTextEditorPreset(style.textStyle, style.color);
  textEditor.style.fontSize = `${Math.max(14, style.fontSize)}px`;
  resizeTextEditor();
  textEditor.focus();
}

function resizeTextEditor(): void {
  const selection = selectionStore.getState().selection;
  const anchor = pendingTextViewportPoint;
  if (!selection || !anchor) {
    return;
  }
  const editorStyle = window.getComputedStyle(textEditor);
  const fontSize = parseCssPixels(editorStyle.fontSize) || 14;
  const textWidth = textEditor.value
    ? measureTextLayout(annotationContext, textEditor.value, fontSize).width
    : 0;
  const horizontalChrome =
    parseCssPixels(editorStyle.borderLeftWidth) +
    parseCssPixels(editorStyle.borderRightWidth) +
    parseCssPixels(editorStyle.paddingLeft) +
    parseCssPixels(editorStyle.paddingRight);
  const minimumWidth = Math.min(44, selection.width);
  const targetWidth = Math.min(
    selection.width,
    Math.max(minimumWidth, Math.ceil(textWidth + horizontalChrome + 4))
  );
  textEditor.style.minWidth = `${minimumWidth}px`;
  textEditor.style.width = `${targetWidth}px`;
  textEditor.style.height = 'auto';
  const borderHeight = textEditor.offsetHeight - textEditor.clientHeight;
  const minimumHeight = Math.min(42, selection.height);
  const desiredHeight = Math.max(textEditor.scrollHeight + borderHeight, minimumHeight);
  const targetHeight = Math.min(selection.height, desiredHeight);
  textEditor.style.minHeight = `${minimumHeight}px`;
  textEditor.style.height = `${targetHeight}px`;
  textEditor.style.overflowY = desiredHeight > targetHeight ? 'auto' : 'hidden';

  const left = Math.min(
    Math.max(anchor.x, selection.x),
    selection.x + selection.width - targetWidth
  );
  const top = Math.min(
    Math.max(anchor.y, selection.y),
    selection.y + selection.height - targetHeight
  );
  textEditor.style.transform = `translate(${left}px, ${top}px)`;
}

function closeTextEditor(commit: boolean): void {
  if (textEditor.hidden) {
    return;
  }
  const rawValue = textEditor.value;
  if (commit && rawValue.trim() && pendingTextPoint) {
    const state = annotationStore.getState();
    const imageScale = getImageScale();
    const editorStyle = window.getComputedStyle(textEditor);
    const fontSize =
      (parseCssPixels(editorStyle.fontSize) || state.style.fontSize) * imageScale;
    const contentWidth = Math.max(
      1,
      (textEditor.clientWidth -
        parseCssPixels(editorStyle.paddingLeft) -
        parseCssPixels(editorStyle.paddingRight)) *
        imageScale
    );
    const value = wrapTextToWidth(annotationContext, rawValue, fontSize, contentWidth);
    const metrics = measureTextLayout(annotationContext, value, fontSize);
    const baselineMetrics = measureTextBaselineMetrics(
      annotationContext,
      value,
      fontSize
    );
    const surfaceBounds = surface.getBoundingClientRect();
    const editorBounds = textEditor.getBoundingClientRect();
    // 使用浏览器实际布局后的边框坐标，吸收不同系统的子像素取整差异。
    const editorOrigin = toImagePoint({
      x: editorBounds.left - surfaceBounds.left,
      y: editorBounds.top - surfaceBounds.top,
    });
    const contentOffset = {
      x:
        (parseCssPixels(editorStyle.borderLeftWidth) +
          parseCssPixels(editorStyle.paddingLeft)) *
        imageScale,
      y:
        (parseCssPixels(editorStyle.borderTopWidth) +
          parseCssPixels(editorStyle.paddingTop)) *
        imageScale,
    };
    const measuredLineHeight = parseCssPixels(editorStyle.lineHeight) * imageScale;
    const position = calculateTextBaselinePosition(
      editorOrigin,
      baselineMetrics,
      contentOffset,
      measuredLineHeight || fontSize * TEXT_LINE_HEIGHT
    );
    const element: TextElement = {
      id: crypto.randomUUID(),
      type: 'text',
      zIndex: getNextZIndex(),
      createdAt: Date.now(),
      color: state.style.color,
      position,
      value,
      fontSize,
      metrics,
      textStyle: state.style.textStyle,
    };
    annotationStore.setDraft(element);
    annotationStore.commitDraft(false);
  }
  pendingTextPoint = null;
  pendingTextViewportPoint = null;
  textEditor.hidden = true;
  textEditor.value = '';
}

function parseCssPixels(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cancelCapture(): void {
  const jobId = selectionStore.getState().payload?.jobId;
  if (jobId) {
    window.snaporaOverlay.cancel(jobId);
  }
}

async function confirmCapture(
  outputAction: 'save' | 'copy' | 'pin' = 'copy'
): Promise<void> {
  const state = selectionStore.getState();
  const frame = state.payload?.frames[0];
  if (!state.payload || !frame || !state.selection || state.phase !== 'selected') {
    return;
  }

  outputFeedback = null;
  clearExportProgress();
  selectionStore.dispatch({ type: 'begin-export' });
  scheduleExportProgress();
  try {
    const viewportSize = getSurfaceSize();
    const imageRect = viewportRectToImageRect(
      state.selection,
      viewportSize,
      frame.pixelSize
    );
    const screenBounds = viewportRectToScreenRect(
      state.selection,
      viewportSize,
      frame.display.bounds
    );
    const elements = annotationStore.getState().document?.elements ?? [];
    const data = await exportSelectionPng(
      screenFrame,
      imageRect,
      elements,
      frame.pixelSize,
      getWatermarkOptions()
    );

    const result = {
      status: 'completed' as const,
      data,
      mimeType: 'image/png' as const,
      bounds: screenBounds,
      displayId: frame.display.id,
    };
    const response = await window.snaporaOverlay.output({
      jobId: state.payload.jobId,
      action: outputAction,
      result,
    });
    if (response.status !== 'completed') {
      clearExportProgress();
      selectionStore.dispatch({ type: 'export-failed' });
      outputFeedback =
        response.status === 'cancelled' ? localize('saveCancelled') : response.message;
      render();
      return;
    }

    const output =
      response.action === 'save'
        ? { action: 'save' as const, filePath: response.filePath }
        : response.action === 'pin'
          ? { action: 'pin' as const }
          : { action: 'copy' as const };
    clearExportProgress();
    window.snaporaOverlay.confirm({
      jobId: state.payload.jobId,
      result: { ...result, output },
    });
  } catch (error) {
    clearExportProgress();
    selectionStore.dispatch({ type: 'export-failed' });
    window.snaporaOverlay.reportError({
      jobId: state.payload.jobId,
      code: 'EXPORT_FAILED',
      message: error instanceof Error ? error.message : 'Screenshot export failed.',
    });
  }
}

/** 快速复制不显示瞬时 loading，只有导出确实耗时时才呈现进度。 */
function scheduleExportProgress(): void {
  exportProgressTimer = window.setTimeout(() => {
    exportProgressTimer = undefined;
    if (selectionStore.getState().phase === 'exporting') {
      exportProgressVisible = true;
      render();
    }
  }, EXPORT_PROGRESS_DELAY_MS);
}

function clearExportProgress(): void {
  if (exportProgressTimer !== undefined) {
    window.clearTimeout(exportProgressTimer);
    exportProgressTimer = undefined;
  }
  exportProgressVisible = false;
}

function render(): void {
  const selectionState = selectionStore.getState();
  const annotationState = annotationStore.getState();
  const selection = selectionState.selection;
  surface.dataset.state = selectionState.phase;
  surface.dataset.tool = annotationState.activeTool;
  const selectedElement = annotationState.document?.elements.find(
    (element) => element.id === annotationState.selectedElementId
  );
  if (selectedElement) {
    surface.dataset.selectedType = selectedElement.type;
  } else {
    delete surface.dataset.selectedType;
  }
  const presetKind = getPresetKind(annotationState.activeTool, selectedElement);
  if (presetKind) {
    surface.dataset.preset = presetKind;
    presetPanel.hidden = false;
    toolbar.dataset.hasPreset = 'true';
  } else {
    delete surface.dataset.preset;
    presetPanel.hidden = true;
    toolbar.dataset.hasPreset = 'false';
  }
  renderPresetControls(selectedElement);
  const showWindowSnap = selectionState.phase === 'ready' && hoveredWindowSnap;
  screenMask.hidden = selection !== null || Boolean(showWindowSnap);
  windowSnapPreview.hidden = !showWindowSnap;
  if (showWindowSnap) {
    setRectStyle(windowSnapPreview, showWindowSnap);
  }
  selectionElement.hidden = selection === null;
  toolbar.hidden = selectionState.phase !== 'selected';

  const showPhaseStatus =
    selectionState.phase === 'waiting' ||
    selectionState.phase === 'ready' ||
    (selectionState.phase === 'exporting' && exportProgressVisible);
  status.hidden = !showPhaseStatus && !outputFeedback;
  if (selectionState.phase === 'waiting') {
    status.textContent = localize('preparing');
  } else if (selectionState.phase === 'ready') {
    status.textContent = localize('instruction');
  } else if (selectionState.phase === 'exporting') {
    status.textContent = localize('exporting');
  } else if (outputFeedback) {
    status.textContent = outputFeedback;
  }

  if (selection) {
    setRectStyle(selectionElement, selection);
    const frame = selectionState.payload?.frames[0];
    const imageRect = frame
      ? viewportRectToImageRect(selection, getSurfaceSize(), frame.pixelSize)
      : selection;
    sizeHint.value = `${imageRect.width} × ${imageRect.height}`;
    if (!toolbar.hidden) {
      positionToolbar(selection);
    }
  }

  for (const button of toolButtons) {
    const active = button.dataset.tool === annotationState.activeTool;
    button.dataset.active = String(active);
    button.setAttribute('aria-pressed', String(active));
  }
  undoButton.disabled = !annotationState.canUndo;
  redoButton.disabled = !annotationState.canRedo;
  renderAnnotationCanvas();
}

function renderAnnotationCanvas(): void {
  annotationContext.clearRect(0, 0, annotationCanvas.width, annotationCanvas.height);
  const frame = selectionStore.getState().payload?.frames[0];
  const state = annotationStore.getState();
  if (!frame || !state.document) {
    return;
  }
  const watermark = getWatermarkOptions();
  drawAnnotations(annotationContext, getRenderableElements(state), {
    clipBounds: state.document.selection,
    imageSize: frame.pixelSize,
    mosaicSource: screenFrame,
    draftElementId: state.draft?.id ?? null,
    selectedElementId: state.selectedElementId,
    selectionHandleSize: getImageScale() * 8,
    ...(watermark ? { watermark } : {}),
  });
}

function positionToolbar(selection: Rect): void {
  const toolbarSize: Size = {
    width: toolbar.offsetWidth,
    height: toolbar.offsetHeight,
  };
  const position = calculateToolbarPosition(selection, getSurfaceSize(), toolbarSize);
  toolbar.style.transform = `translate(${position.x}px, ${position.y}px)`;
  toolbar.dataset.placement = position.placement;
  positionPresetPanel();
}

/** 将预设面板限制在屏幕内，并让箭头始终指向当前点击的工具按钮。 */
function positionPresetPanel(): void {
  if (presetPanel.hidden) {
    return;
  }
  const activeTool = annotationStore.getState().activeTool;
  const activeButton = toolButtons.find(
    (button) => button.dataset.tool === activeTool && !button.hidden
  );
  if (!activeButton) {
    return;
  }

  const surfaceBounds = surface.getBoundingClientRect();
  const toolbarBounds = toolbar.getBoundingClientRect();
  const buttonBounds = activeButton.getBoundingClientRect();
  const panelWidth = presetPanel.offsetWidth;
  const buttonCenter = buttonBounds.left - surfaceBounds.left + buttonBounds.width / 2;
  const toolbarLeft = toolbarBounds.left - surfaceBounds.left;
  const viewportMargin = 8;
  const maximumLeft = Math.max(
    viewportMargin,
    surface.clientWidth - panelWidth - viewportMargin
  );
  const panelLeft = Math.min(
    Math.max(buttonCenter - panelWidth / 2, viewportMargin),
    maximumLeft
  );
  const arrowX = Math.min(
    Math.max(buttonCenter - panelLeft, 16),
    Math.max(16, panelWidth - 16)
  );

  presetPanel.style.left = `${panelLeft - toolbarLeft}px`;
  presetPanel.style.setProperty('--preset-arrow-x', `${arrowX}px`);
}

function setRectStyle(element: HTMLElement, rect: Rect): void {
  element.style.transform = `translate(${rect.x}px, ${rect.y}px)`;
  element.style.width = `${rect.width}px`;
  element.style.height = `${rect.height}px`;
}

function toSurfacePoint(event: MouseEvent): Point {
  const bounds = surface.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

function toImagePoint(point: Point): Point {
  const frame = selectionStore.getState().payload?.frames[0];
  return frame
    ? viewportPointToImagePoint(point, getSurfaceSize(), frame.pixelSize)
    : point;
}

function getImageScale(): number {
  const frame = selectionStore.getState().payload?.frames[0];
  return frame ? frame.pixelSize.width / Math.max(getSurfaceSize().width, 1) : 1;
}

function getSurfaceBounds(): Rect {
  return { x: 0, y: 0, ...getSurfaceSize() };
}

function getSurfaceSize(): Size {
  return { width: surface.clientWidth, height: surface.clientHeight };
}

function waitForCompositeFrames(frameCount = 2, maximumWaitMs = 48): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let remainingFrames = frameCount;
    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timeoutId);
      resolve();
    };
    const handleFrame = (): void => {
      remainingFrames -= 1;
      if (remainingFrames <= 0) {
        finish();
        return;
      }
      requestAnimationFrame(handleFrame);
    };
    const timeoutId = window.setTimeout(finish, maximumWaitMs);
    requestAnimationFrame(handleFrame);
  });
}

/** 只在未创建选区时按鼠标位置显示面积最小的窗口候选。 */
function updateWindowSnapPreview(point: Point | null): void {
  const next =
    point && selectionStore.getState().phase === 'ready'
      ? (windowSnapRegions.find((region) => containsPoint(region, point)) ?? null)
      : null;
  if (next === hoveredWindowSnap) {
    return;
  }
  hoveredWindowSnap = next;
  render();
}

/** 将全局 Screen DIP 窗口边界裁剪并换算到当前显示器的视口坐标。 */
function resolveWindowSnapRegions(
  payload: ScreenshotInitializePayload,
  displayBounds: Rect
): Rect[] {
  return (payload.windowSnapRegions ?? [])
    .map((region) => {
      const left = Math.max(region.x, displayBounds.x);
      const top = Math.max(region.y, displayBounds.y);
      const right = Math.min(
        region.x + region.width,
        displayBounds.x + displayBounds.width
      );
      const bottom = Math.min(
        region.y + region.height,
        displayBounds.y + displayBounds.height
      );
      return {
        x: left - displayBounds.x,
        y: top - displayBounds.y,
        width: right - left,
        height: bottom - top,
      };
    })
    .filter((region) => region.width >= 4 && region.height >= 4)
    .sort((left, right) => left.width * left.height - right.width * right.height);
}

function containsPoint(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

function getNextZIndex(): number {
  const elements = annotationStore.getState().document?.elements ?? [];
  return (
    elements.reduce((maximum, element) => Math.max(maximum, element.zIndex), -1) + 1
  );
}

/** 形状与画笔共享线宽面板，选择已有元素时复用对应的上下文面板。 */
function getPresetKind(
  activeTool: AnnotationTool,
  selectedElement: AnnotationElement | undefined
): PresetKind | undefined {
  const target = activeTool === 'select' ? selectedElement?.type : activeTool;
  switch (target) {
    case 'rectangle':
    case 'ellipse':
    case 'arrow':
    case 'brush':
      return 'stroke';
    case 'text':
    case 'mosaic':
    case 'watermark':
      return target;
    default:
      return undefined;
  }
}

/** 将当前工具或已选元素的真实样式同步回预设控件。 */
function renderPresetControls(selectedElement: AnnotationElement | undefined): void {
  const state = annotationStore.getState();
  const imageScale = getImageScale();
  const lineWidth =
    selectedElement && 'lineWidth' in selectedElement
      ? selectedElement.lineWidth / imageScale
      : state.style.lineWidth;
  const fontSize =
    selectedElement?.type === 'text'
      ? selectedElement.fontSize / imageScale
      : state.style.fontSize;
  const textStyle =
    selectedElement?.type === 'text'
      ? (selectedElement.textStyle ?? 'default')
      : state.style.textStyle;
  const mosaicStrength =
    selectedElement?.type === 'mosaic'
      ? (selectedElement.blockSize ?? 8 * imageScale) / imageScale
      : state.style.mosaicStrength;
  const color =
    selectedElement && selectedElement.type !== 'mosaic'
      ? selectedElement.color
      : state.style.color;

  for (const button of lineWidthButtons) {
    setPresetButtonState(button, Number(button.dataset.lineWidth) === lineWidth);
  }
  for (const button of textStyleButtons) {
    setPresetButtonState(button, button.dataset.textStyle === textStyle);
  }
  const closestFontSize = [...fontSizeSelect.options].reduce((closest, option) =>
    Math.abs(Number(option.value) - fontSize) <
    Math.abs(Number(closest.value) - fontSize)
      ? option
      : closest
  );
  fontSizeSelect.value = closestFontSize.value;

  const clampedStrength = Math.min(
    Number(mosaicStrengthInput.max),
    Math.max(Number(mosaicStrengthInput.min), mosaicStrength)
  );
  mosaicStrengthInput.value = String(clampedStrength);
  mosaicStrengthOutput.value = formatMosaicStrength(clampedStrength);
  watermarkOpacityOutput.value = `${watermarkOpacityInput.value}%`;

  const normalizedColor = color.toLowerCase();
  const hasPresetColor = colorButtons.some(
    (button) => button.dataset.color?.toLowerCase() === normalizedColor
  );
  if (!hasPresetColor && /^#[\da-f]{6}$/i.test(color)) {
    customColorSelected = true;
    customColor = normalizedColor;
    customColorHsv = hexToHsv(customColor);
    colorInput.value = color;
  }
  const isCustomColor =
    !hasPresetColor || (customColorSelected && customColor === normalizedColor);
  for (const button of colorButtons) {
    setPresetButtonState(
      button,
      !isCustomColor && button.dataset.color?.toLowerCase() === normalizedColor
    );
  }
  colorControl.dataset.active = String(isCustomColor);
  renderColorPicker();
}

/** 统一预设按钮的视觉态与辅助技术状态。 */
function setPresetButtonState(button: HTMLButtonElement, active: boolean): void {
  button.dataset.active = String(active);
  button.setAttribute('aria-pressed', String(active));
}

/** 颜色预设同时影响后续标注、已选元素和当前水印。 */
function applyColor(color: string): void {
  annotationStore.setStyle({ color });
  commitSelectedElementStyle({ color });
}

/** 点击彩环入口时开关自绘取色器。 */
function toggleColorPicker(): void {
  if (colorPickerPopover.hidden) {
    openColorPicker();
  } else {
    closeColorPicker();
  }
}

/** 将取色器放在入口附近，并限制在当前截图视口内。 */
function openColorPicker(): void {
  customColorHsv = hexToHsv(customColor);
  renderColorPicker();
  colorPickerPopover.hidden = false;
  colorControl.setAttribute('aria-expanded', 'true');
  const controlBounds = colorControl.getBoundingClientRect();
  const pickerBounds = colorPickerPopover.getBoundingClientRect();
  const margin = 8;
  const left = Math.min(
    Math.max(
      controlBounds.left + controlBounds.width / 2 - pickerBounds.width / 2,
      margin
    ),
    Math.max(margin, window.innerWidth - pickerBounds.width - margin)
  );
  const below = controlBounds.bottom + margin;
  const top =
    below + pickerBounds.height <= window.innerHeight - margin
      ? below
      : Math.max(margin, controlBounds.top - pickerBounds.height - margin);
  colorPickerPopover.style.left = `${left}px`;
  colorPickerPopover.style.top = `${top}px`;
  colorPickerSaturation.focus();
}

/** 关闭取色器但保留最后一次自定义色，方便下次继续微调。 */
function closeColorPicker(): void {
  colorPickerPopover.hidden = true;
  colorControl.setAttribute('aria-expanded', 'false');
  colorPickerPointerId = null;
}

/** 同步色相底色、取色点位置和无障碍数值。 */
function renderColorPicker(): void {
  colorPickerSaturation.style.backgroundColor = `hsl(${customColorHsv.hue} 100% 50%)`;
  colorPickerSelector.style.left = `${customColorHsv.saturation * 100}%`;
  colorPickerSelector.style.top = `${(1 - customColorHsv.value) * 100}%`;
  colorPickerHue.value = String(Math.round(customColorHsv.hue));
  colorPickerSaturation.setAttribute(
    'aria-valuenow',
    String(Math.round(customColorHsv.saturation * 100))
  );
  colorPickerSaturation.setAttribute(
    'aria-valuetext',
    `${Math.round(customColorHsv.saturation * 100)}%, ${Math.round(customColorHsv.value * 100)}%`
  );
}

/** 将饱和度面板的指针坐标换算为 HSV，并按需提交到已选元素。 */
function updateColorPickerSaturation(event: PointerEvent, commit: boolean): void {
  const bounds = colorPickerSaturation.getBoundingClientRect();
  customColorHsv.saturation = Math.min(
    1,
    Math.max(0, (event.clientX - bounds.left) / Math.max(bounds.width, 1))
  );
  customColorHsv.value =
    1 -
    Math.min(1, Math.max(0, (event.clientY - bounds.top) / Math.max(bounds.height, 1)));
  applyCustomPickerColor(commit);
}

/** 键盘方向键以 2% 步进调整饱和度和明度。 */
function handleColorPickerKeyboard(event: KeyboardEvent): void {
  const step = 0.02;
  if (event.key === 'ArrowLeft') {
    customColorHsv.saturation = Math.max(0, customColorHsv.saturation - step);
  } else if (event.key === 'ArrowRight') {
    customColorHsv.saturation = Math.min(1, customColorHsv.saturation + step);
  } else if (event.key === 'ArrowUp') {
    customColorHsv.value = Math.min(1, customColorHsv.value + step);
  } else if (event.key === 'ArrowDown') {
    customColorHsv.value = Math.max(0, customColorHsv.value - step);
  } else {
    return;
  }
  event.preventDefault();
  applyCustomPickerColor(true);
}

/** 将自绘取色器结果写回统一颜色状态。 */
function applyCustomPickerColor(commit: boolean): void {
  customColor = hsvToHex(customColorHsv);
  customColorSelected = true;
  colorInput.value = customColor;
  annotationStore.setStyle({ color: customColor });
  if (commit) {
    commitSelectedElementStyle({ color: customColor });
  }
}

/** 将十六进制颜色转换为 HSV。 */
function hexToHsv(color: string): HsvColor {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color);
  if (!match) {
    return { hue: 0, saturation: 1, value: 1 };
  }
  const red = Number.parseInt(match[1] ?? '00', 16) / 255;
  const green = Number.parseInt(match[2] ?? '00', 16) / 255;
  const blue = Number.parseInt(match[3] ?? '00', 16) / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  let hue = 0;
  if (delta > 0) {
    if (maximum === red) {
      hue = 60 * (((green - blue) / delta) % 6);
    } else if (maximum === green) {
      hue = 60 * ((blue - red) / delta + 2);
    } else {
      hue = 60 * ((red - green) / delta + 4);
    }
  }
  return {
    hue: hue < 0 ? hue + 360 : hue,
    saturation: maximum === 0 ? 0 : delta / maximum,
    value: maximum,
  };
}

/** 将 HSV 转换为标准六位十六进制颜色。 */
function hsvToHex(color: HsvColor): string {
  const chroma = color.value * color.saturation;
  const sector = (color.hue % 360) / 60;
  const intermediate = chroma * (1 - Math.abs((sector % 2) - 1));
  const offset = color.value - chroma;
  const [red, green, blue] =
    sector < 1
      ? [chroma, intermediate, 0]
      : sector < 2
        ? [intermediate, chroma, 0]
        : sector < 3
          ? [0, chroma, intermediate]
          : sector < 4
            ? [0, intermediate, chroma]
            : sector < 5
              ? [intermediate, 0, chroma]
              : [chroma, 0, intermediate];
  return `#${[red, green, blue]
    .map((channel) =>
      Math.round((channel + offset) * 255)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`;
}

/** 字号预设和下拉框共用同一条样式提交路径。 */
function applyFontSize(fontSize: number): void {
  annotationStore.setStyle({ fontSize });
  commitSelectedElementStyle({ fontSize: fontSize * getImageScale() });
}

/** 文字外观预设同时作用于后续输入和已选文字。 */
function applyTextStyle(textStyle: TextStyle): void {
  annotationStore.setStyle({ textStyle });
  commitSelectedElementStyle({ textStyle });
}

/** 让 textarea 输入态提前呈现最终文字预设，减少提交后的视觉跳变。 */
function applyTextEditorPreset(textStyle: TextStyle, color: string): void {
  const contrastColor = getTextContrastColor(color);
  textEditor.dataset.textStyle = textStyle;
  textEditor.style.color = textStyle === 'fill' ? contrastColor : color;
  textEditor.style.backgroundColor = textStyle === 'fill' ? color : 'transparent';
  textEditor.style.borderColor =
    textStyle === 'fill' ? 'transparent' : 'rgb(255 255 255 / 90%)';
  textEditor.style.setProperty(
    '-webkit-text-stroke',
    textStyle === 'outline' ? `1px ${contrastColor}` : '0 transparent'
  );
}

/** 将马赛克块大小映射为对用户更直观的百分比强度。 */
function formatMosaicStrength(strength: number): string {
  return `${Math.round((strength / Number(mosaicStrengthInput.max)) * 100)}%`;
}

/** 水印是选区级覆盖层；空文本时完全跳过渲染和导出。 */
function getWatermarkOptions(): WatermarkOptions | undefined {
  const text = watermarkTextInput.value.trim();
  if (!text) {
    return undefined;
  }
  return {
    text,
    color: annotationStore.getState().style.color,
    opacity: Number(watermarkOpacityInput.value) / 100,
    fontSize: WATERMARK_FONT_SIZE * getImageScale(),
  };
}

function commitSelectedElementStyle(style: AnnotationElementStyle): void {
  const state = annotationStore.getState();
  const selected = state.document?.elements.find(
    (element) => element.id === state.selectedElementId
  );
  if (!selected) {
    return;
  }

  const updated = updateElementStyle(selected, style);
  if (updated !== selected) {
    annotationStore.commitUpdate(selected, updated);
  }
}

function applyToolAvailability(tools: ScreenshotTool[] | undefined): void {
  const enabled = new Set(
    tools ?? ['rectangle', 'ellipse', 'arrow', 'brush', 'text', 'mosaic', 'watermark']
  );
  for (const button of toolButtons) {
    const tool = button.dataset.tool as AnnotationTool;
    button.hidden = tool !== 'select' && !enabled.has(tool as ScreenshotTool);
  }
}

function applyTheme(options: ScreenshotOptions): void {
  const theme = resolveScreenshotTheme(options.theme);
  document.documentElement.dataset.snaporaTheme = theme.mode;
  for (const [token, value] of Object.entries(theme.tokens)) {
    setColorToken(token, value);
  }
}

function setColorToken(token: string, value: string | undefined): void {
  if (value && CSS.supports('color', value)) {
    document.documentElement.style.setProperty(token, value);
  }
}

function applyLocale(options: ScreenshotOptions): void {
  const locale = options.locale ?? 'en-US';
  currentMessages = resolveScreenshotMessages(locale, options.messages);
  const localized = currentMessages;
  const toolLabels: Record<AnnotationTool, string> = {
    select: localized.select,
    rectangle: localized.rectangle,
    ellipse: localized.ellipse,
    arrow: localized.arrow,
    brush: localized.brush,
    text: localized.text,
    mosaic: localized.mosaic,
    watermark: localized.watermark,
  };
  document.documentElement.lang = locale;
  for (const button of toolButtons) {
    setControlLabel(button, toolLabels[button.dataset.tool as AnnotationTool]);
  }
  setControlLabel(undoButton, localized.undo);
  setControlLabel(redoButton, localized.redo);
  setControlLabel(saveButton, localized.save);
  setControlLabel(pinButton, localized.pin);
  setControlLabel(cancelButton, localized.cancel);
  setControlLabel(confirmButton, localized.confirm);
  setControlLabel(colorControl, localized.customColor);
  fontControl.setAttribute('aria-label', localized.fontSize);
  mosaicStrengthControl.setAttribute('aria-label', localized.mosaicStrength);
  watermarkOpacityControl.setAttribute('aria-label', localized.opacity);
  mosaicStrengthLabel.textContent = localized.mosaicStrength;
  watermarkOpacityLabel.textContent = localized.opacity;
  watermarkTextInput.placeholder = localized.watermarkPlaceholder;
  watermarkTextInput.setAttribute('aria-label', localized.watermark);
  annotationCanvas.setAttribute('aria-label', localized.annotationCanvas);
  selectionElement.setAttribute('aria-label', localized.selection);
  toolbar.setAttribute('aria-label', localized.actions);
  toolGroup.setAttribute('aria-label', localized.annotationTools);
  historyGroup.setAttribute('aria-label', localized.history);
  presetPanel.setAttribute('aria-label', localized.annotationStyle);
  actionGroup.setAttribute('aria-label', localized.outputActions);
  textEditor.setAttribute('aria-label', localized.annotationText);
  colorPalette.setAttribute('aria-label', localized.color);
  colorInput.setAttribute('aria-label', localized.customColor);
  colorPickerPopover.setAttribute('aria-label', localized.customColor);
  colorPickerSaturation.setAttribute(
    'aria-label',
    locale === 'zh-CN' ? '饱和度和明度' : 'Saturation and brightness'
  );
  colorPickerHue.setAttribute('aria-label', locale === 'zh-CN' ? '色相' : 'Hue');
  fontSizeSelect.setAttribute('aria-label', localized.fontSize);
  mosaicStrengthInput.setAttribute('aria-label', localized.mosaicStrength);
  watermarkOpacityInput.setAttribute('aria-label', localized.opacity);
  for (const button of lineWidthButtons) {
    button.setAttribute(
      'aria-label',
      `${localized.lineWidth} ${button.dataset.lineWidth}`
    );
  }
  const textStyleLabels: Record<TextStyle, string> = {
    default: localized.textDefault,
    fill: localized.textFill,
    outline: localized.textOutline,
  };
  for (const button of textStyleButtons) {
    button.setAttribute(
      'aria-label',
      textStyleLabels[button.dataset.textStyle as TextStyle]
    );
  }
  for (const button of colorButtons) {
    button.setAttribute('aria-label', `${localized.color} ${button.dataset.color}`);
  }
}

function setControlLabel(element: HTMLElement, label: string): void {
  element.dataset.tooltip = label;
  element.setAttribute('aria-label', label);
}

function localize(
  key: 'preparing' | 'instruction' | 'exporting' | 'copied' | 'saveCancelled'
): string {
  return currentMessages[key];
}
