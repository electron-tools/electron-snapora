import './styles.css';

import {
  viewportPointToImagePoint,
  type Point,
  type Rect,
  type Size,
} from '../core/geometry/rect.js';
import type { AnnotationElement, TextElement } from '../core/model/document.js';
import type { ScreenshotInitializePayload } from '../electron/protocol/messages.js';
import type { ScreenshotTool } from '../types.js';
import {
  calculateTextBaselinePosition,
  createDrawableElement,
  getElementBounds,
  getResizeHandleAtPoint,
  hitTestElement,
  isDrawableElementValid,
  measureTextLayout,
  scaleElementToBounds,
  translateElement,
  updateDrawableElement,
  updateElementStyle,
  TEXT_LINE_HEIGHT,
  type AnnotationElementStyle,
} from './annotation-elements.js';
import { drawAnnotations } from './annotation-renderer.js';
import {
  createAnnotationStore,
  getRenderableElements,
  type AnnotationTool,
} from './annotation-store.js';
import { exportSelectionPng } from './export-selection.js';
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
const screenFrame = requireElement<HTMLImageElement>('.screen-frame');
const screenMask = requireElement('.screen-mask');
const annotationCanvas = requireElement<HTMLCanvasElement>('.annotation-canvas');
const annotationContext = requireCanvasContext(annotationCanvas);
const selectionElement = requireElement('.selection');
const sizeHint = requireElement<HTMLOutputElement>('.size-hint');
const toolbar = requireElement('.selection-toolbar');
const textEditor = requireElement<HTMLTextAreaElement>('.text-editor');
const cancelButton = requireElement<HTMLButtonElement>('.cancel-button');
const saveButton = requireElement<HTMLButtonElement>('.save-button');
const confirmButton = requireElement<HTMLButtonElement>('.confirm-button');
const undoButton = requireElement<HTMLButtonElement>('.undo-button');
const redoButton = requireElement<HTMLButtonElement>('.redo-button');
const colorInput = requireElement<HTMLInputElement>('.color-input');
const lineWidthSelect = requireElement<HTMLSelectElement>('.line-width-select');
const fontSizeSelect = requireElement<HTMLSelectElement>('.font-size-select');
const colorControl = requireElement<HTMLElement>('.color-control');
const lineControl = requireElement<HTMLElement>('.line-control');
const fontControl = requireElement<HTMLElement>('.font-control');
const toolButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('[data-tool]')
);

const selectionStore = createOverlayStore();
const annotationStore = createAnnotationStore();
let pointerInteraction: PointerInteraction | null = null;
let resetAnnotationsAfterSelection = true;
let configuredDefaultTool: AnnotationTool = 'select';
let pendingTextPoint: Point | null = null;
let outputFeedback: string | null = null;

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
  selectionStore.dispatch({ type: 'initialize', payload });
  applyTheme(payload);
  applyLocale(payload);
  applyToolAvailability(payload.options.tools);
  screenFrame.onload = async () => {
    annotationCanvas.width = frame.pixelSize.width;
    annotationCanvas.height = frame.pixelSize.height;
    selectionStore.dispatch({ type: 'image-ready' });
    // 图片解码后再等待两次合成帧，确保大图纹理和 Canvas 已完整栅格化。
    screenFrame.getBoundingClientRect();
    await nextAnimationFrame();
    await nextAnimationFrame();
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
selectionStore.subscribe(render);
annotationStore.subscribe(render);

annotationCanvas.addEventListener('pointerdown', handleCanvasPointerDown);
annotationCanvas.addEventListener('pointermove', handleCanvasPointerMove);
annotationCanvas.addEventListener('pointerup', handleCanvasPointerEnd);
annotationCanvas.addEventListener('pointercancel', handleCanvasPointerEnd);

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
    const tool = button.dataset.tool as AnnotationTool;
    annotationStore.setTool(tool);
  });
}
undoButton.addEventListener('click', () => annotationStore.undo());
redoButton.addEventListener('click', () => annotationStore.redo());
colorInput.addEventListener('input', () => {
  annotationStore.setStyle({ color: colorInput.value });
});
colorInput.addEventListener('change', () => {
  commitSelectedElementStyle({ color: colorInput.value });
});
lineWidthSelect.addEventListener('change', () => {
  const lineWidth = Number(lineWidthSelect.value);
  annotationStore.setStyle({ lineWidth });
  const imageScale = getImageScale();
  commitSelectedElementStyle({ lineWidth: lineWidth * imageScale });
});
fontSizeSelect.addEventListener('change', () => {
  const fontSize = Number(fontSizeSelect.value);
  annotationStore.setStyle({ fontSize });
  commitSelectedElementStyle({ fontSize: fontSize * getImageScale() });
});
cancelButton.addEventListener('click', cancelCapture);
confirmButton.addEventListener('click', () => void confirmCapture());
saveButton.addEventListener('click', () => void confirmCapture('save'));

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
  if (!textEditor.hidden) {
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
  annotationCanvas.setPointerCapture(event.pointerId);

  const viewportPoint = toSurfacePoint(event);
  const selection = selectionStore.getState().selection;
  if (!selection || !containsPoint(selection, viewportPoint)) {
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
  } else {
    beginDrawInteraction(event.pointerId, imagePoint, annotationState.activeTool);
  }
}

function handleCanvasPointerMove(event: PointerEvent): void {
  const interaction = pointerInteraction;
  if (!interaction || interaction.pointerId !== event.pointerId) {
    return;
  }
  const viewportPoint = toSurfacePoint(event);
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
  } else if (interaction.kind === 'draw') {
    const draft = annotationStore.getState().draft;
    if (draft && isDrawableElementValid(draft)) {
      annotationStore.commitDraft(draft.type !== 'mosaic');
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

function beginSelection(pointerId: number, point: Point): void {
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
  tool: ScreenshotTool
): void {
  if (tool === 'text') {
    return;
  }
  const state = annotationStore.getState();
  const imageScale = getImageScale();
  const element = createDrawableElement(
    tool,
    imagePoint,
    {
      ...state.style,
      lineWidth: state.style.lineWidth * imageScale,
      fontSize: state.style.fontSize * imageScale,
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
  pendingTextPoint = imagePoint;
  textEditor.value = '';
  textEditor.hidden = false;
  textEditor.style.transform = `translate(${viewportPoint.x}px, ${viewportPoint.y}px)`;
  textEditor.style.color = annotationStore.getState().style.color;
  textEditor.style.fontSize = `${Math.max(
    14,
    annotationStore.getState().style.fontSize
  )}px`;
  resizeTextEditor();
  textEditor.focus();
}

function resizeTextEditor(): void {
  textEditor.style.height = 'auto';
  const borderHeight = textEditor.offsetHeight - textEditor.clientHeight;
  textEditor.style.height = `${Math.max(textEditor.scrollHeight + borderHeight, 42)}px`;
}

function closeTextEditor(commit: boolean): void {
  if (textEditor.hidden) {
    return;
  }
  const value = textEditor.value.trim();
  if (commit && value && pendingTextPoint) {
    const state = annotationStore.getState();
    const imageScale = getImageScale();
    const fontSize = state.style.fontSize * imageScale;
    const metrics = measureTextLayout(annotationContext, value, fontSize);
    const editorStyle = window.getComputedStyle(textEditor);
    // textarea 的点击坐标指向外框左上角；提交时转换到内容区的真实文字基线。
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
      pendingTextPoint,
      metrics,
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
    };
    annotationStore.setDraft(element);
    annotationStore.commitDraft(false);
  }
  pendingTextPoint = null;
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

async function confirmCapture(outputAction: 'save' | 'copy' = 'copy'): Promise<void> {
  const state = selectionStore.getState();
  const frame = state.payload?.frames[0];
  if (!state.payload || !frame || !state.selection || state.phase !== 'selected') {
    return;
  }

  outputFeedback = null;
  selectionStore.dispatch({ type: 'begin-export' });
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
      frame.pixelSize
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
      selectionStore.dispatch({ type: 'export-failed' });
      outputFeedback =
        response.status === 'cancelled' ? localize('saveCancelled') : response.message;
      render();
      return;
    }

    const output =
      response.action === 'save'
        ? { action: 'save' as const, filePath: response.filePath }
        : { action: 'copy' as const };
    window.snaporaOverlay.confirm({
      jobId: state.payload.jobId,
      result: { ...result, output },
    });
  } catch (error) {
    selectionStore.dispatch({ type: 'export-failed' });
    window.snaporaOverlay.reportError({
      jobId: state.payload.jobId,
      code: 'EXPORT_FAILED',
      message: error instanceof Error ? error.message : 'Screenshot export failed.',
    });
  }
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
  screenMask.hidden = selection !== null;
  selectionElement.hidden = selection === null;
  toolbar.hidden = selectionState.phase !== 'selected';

  status.hidden =
    !['waiting', 'ready', 'exporting'].includes(selectionState.phase) &&
    !outputFeedback;
  if (selectionState.phase === 'waiting') {
    status.textContent = 'Preparing screenshot…';
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
  drawAnnotations(annotationContext, getRenderableElements(state), {
    clipBounds: state.document.selection,
    imageSize: frame.pixelSize,
    mosaicSource: screenFrame,
    draftElementId: state.draft?.id ?? null,
    selectedElementId: state.selectedElementId,
    selectionHandleSize: getImageScale() * 8,
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
}

function setRectStyle(element: HTMLElement, rect: Rect): void {
  element.style.transform = `translate(${rect.x}px, ${rect.y}px)`;
  element.style.width = `${rect.width}px`;
  element.style.height = `${rect.height}px`;
}

function toSurfacePoint(event: PointerEvent): Point {
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

function nextAnimationFrame(maximumWaitMs = 60): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timeoutId);
      resolve();
    };
    const timeoutId = window.setTimeout(finish, maximumWaitMs);
    requestAnimationFrame(finish);
  });
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
    tools ?? ['rectangle', 'ellipse', 'arrow', 'brush', 'text', 'mosaic']
  );
  for (const button of toolButtons) {
    const tool = button.dataset.tool as AnnotationTool;
    button.hidden = tool !== 'select' && !enabled.has(tool as ScreenshotTool);
  }
}

function applyTheme(payload: ScreenshotInitializePayload): void {
  const theme = payload.options.theme;
  setColorToken('--snapora-accent', theme?.accentColor);
  setColorToken('--snapora-mask', theme?.maskColor);
  setColorToken('--snapora-toolbar', theme?.toolbarBackground);
}

function setColorToken(token: string, value: string | undefined): void {
  if (value && CSS.supports('color', value)) {
    document.documentElement.style.setProperty(token, value);
  }
}

const messages = {
  'zh-CN': {
    instruction: '拖动选择截图区域 · Esc 取消',
    exporting: '正在生成截图…',
    cancel: '取消',
    save: '保存',
    confirm: '复制并完成',
    saveCancelled: '已取消保存',
    select: '选择',
    rectangle: '矩形',
    ellipse: '椭圆',
    arrow: '箭头',
    brush: '画笔',
    text: '文字',
    mosaic: '马赛克',
    undo: '撤销',
    redo: '重做',
    color: '颜色',
    lineWidth: '线宽',
    fontSize: '字号',
  },
  'en-US': {
    instruction: 'Drag to select an area · Esc to cancel',
    exporting: 'Exporting screenshot…',
    cancel: 'Cancel',
    save: 'Save',
    confirm: 'Copy & Done',
    saveCancelled: 'Save cancelled',
    select: 'Select',
    rectangle: 'Rectangle',
    ellipse: 'Ellipse',
    arrow: 'Arrow',
    brush: 'Brush',
    text: 'Text',
    mosaic: 'Mosaic',
    undo: 'Undo',
    redo: 'Redo',
    color: 'Color',
    lineWidth: 'Line width',
    fontSize: 'Font size',
  },
} as const;

function applyLocale(payload: ScreenshotInitializePayload): void {
  const locale = payload.options.locale ?? 'en-US';
  const localized = messages[locale];
  const toolLabels: Record<AnnotationTool, string> = {
    select: localized.select,
    rectangle: localized.rectangle,
    ellipse: localized.ellipse,
    arrow: localized.arrow,
    brush: localized.brush,
    text: localized.text,
    mosaic: localized.mosaic,
  };
  document.documentElement.lang = locale;
  for (const button of toolButtons) {
    setControlLabel(button, toolLabels[button.dataset.tool as AnnotationTool]);
  }
  setControlLabel(undoButton, localized.undo);
  setControlLabel(redoButton, localized.redo);
  setControlLabel(saveButton, localized.save);
  setControlLabel(cancelButton, localized.cancel);
  setControlLabel(confirmButton, localized.confirm);
  setControlLabel(colorControl, localized.color);
  setControlLabel(lineControl, localized.lineWidth);
  setControlLabel(fontControl, localized.fontSize);
  colorInput.setAttribute('aria-label', localized.color);
  lineWidthSelect.setAttribute('aria-label', localized.lineWidth);
  fontSizeSelect.setAttribute('aria-label', localized.fontSize);
}

function setControlLabel(element: HTMLElement, label: string): void {
  element.dataset.tooltip = label;
  element.setAttribute('aria-label', label);
}

function localize(key: 'instruction' | 'exporting' | 'saveCancelled'): string {
  const locale = selectionStore.getState().payload?.options.locale ?? 'en-US';
  return messages[locale][key];
}
