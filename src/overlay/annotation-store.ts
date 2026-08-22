import { CommandStack } from '../core/history/command-stack.js';
import {
  AddElementCommand,
  RemoveElementCommand,
  UpdateElementCommand,
} from '../core/history/document-commands.js';
import type { Rect } from '../core/geometry/rect.js';
import type { AnnotationElement, ScreenshotDocument } from '../core/model/document.js';
import type { ScreenshotTool } from '../types.js';
import type { AnnotationStyle } from './annotation-elements.js';

export type AnnotationTool = 'select' | ScreenshotTool;

export interface AnnotationState {
  document: ScreenshotDocument | null;
  activeTool: AnnotationTool;
  selectedElementId: string | null;
  draft: AnnotationElement | null;
  preview: AnnotationElement | null;
  style: AnnotationStyle;
  canUndo: boolean;
  canRedo: boolean;
}

export interface AnnotationStore {
  getState(): AnnotationState;
  reset(activeTool?: AnnotationTool): void;
  initialize(selection: Rect, activeTool?: AnnotationTool): void;
  setSelection(selection: Rect): void;
  setTool(tool: AnnotationTool): void;
  setStyle(style: Partial<AnnotationStyle>): void;
  setDraft(element: AnnotationElement | null): void;
  commitDraft(select?: boolean): void;
  select(elementId: string | null): void;
  preview(element: AnnotationElement | null): void;
  commitUpdate(before: AnnotationElement, after: AnnotationElement): void;
  deleteSelected(): void;
  undo(): void;
  redo(): void;
  subscribe(listener: (state: AnnotationState) => void): () => void;
}

const defaultStyle: AnnotationStyle = {
  color: '#ff3b30',
  lineWidth: 4,
  fontSize: 24,
  textStyle: 'default',
  mosaicStrength: 8,
};

export function createAnnotationStore(): AnnotationStore {
  const history = new CommandStack<ScreenshotDocument>();
  const listeners = new Set<(state: AnnotationState) => void>();
  let state: AnnotationState = {
    document: null,
    activeTool: 'select',
    selectedElementId: null,
    draft: null,
    preview: null,
    style: { ...defaultStyle },
    canUndo: false,
    canRedo: false,
  };

  const update = (patch: Partial<AnnotationState>): void => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener(state));
  };
  const updateDocument = (document: ScreenshotDocument): void => {
    update({ document, canUndo: history.canUndo, canRedo: history.canRedo });
  };

  return {
    getState: () => state,
    reset(activeTool = 'select') {
      history.clear();
      update({
        document: null,
        activeTool,
        selectedElementId: null,
        draft: null,
        preview: null,
        style: { ...defaultStyle },
        canUndo: false,
        canRedo: false,
      });
    },
    initialize(selection, activeTool = 'select') {
      history.clear();
      update({
        document: { selection, elements: [] },
        activeTool,
        selectedElementId: null,
        draft: null,
        preview: null,
        canUndo: false,
        canRedo: false,
      });
    },
    setSelection(selection) {
      if (state.document) {
        update({ document: { ...state.document, selection } });
      }
    },
    setTool(activeTool) {
      update({ activeTool, selectedElementId: null, draft: null, preview: null });
    },
    setStyle(style) {
      update({ style: { ...state.style, ...style } });
    },
    setDraft(draft) {
      update({ draft });
    },
    commitDraft(select = true) {
      if (!state.document || !state.draft) {
        return;
      }
      const draft = state.draft;
      updateDocument(history.execute(new AddElementCommand(draft), state.document));
      update({ draft: null, selectedElementId: select ? draft.id : null });
    },
    select(selectedElementId) {
      update({ selectedElementId, preview: null });
    },
    preview(preview) {
      update({ preview });
    },
    commitUpdate(before, after) {
      if (!state.document) {
        return;
      }
      updateDocument(
        history.execute(new UpdateElementCommand(before, after), state.document)
      );
      update({ preview: null, selectedElementId: after.id });
    },
    deleteSelected() {
      if (!state.document || !state.selectedElementId) {
        return;
      }
      const index = state.document.elements.findIndex(
        (element) => element.id === state.selectedElementId
      );
      const element = state.document.elements[index];
      if (!element) {
        return;
      }
      updateDocument(
        history.execute(new RemoveElementCommand(element, index), state.document)
      );
      update({ selectedElementId: null, preview: null });
    },
    undo() {
      if (state.document) {
        updateDocument(history.undo(state.document));
        update({ selectedElementId: null, preview: null, draft: null });
      }
    },
    redo() {
      if (state.document) {
        updateDocument(history.redo(state.document));
        update({ selectedElementId: null, preview: null, draft: null });
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function getRenderableElements(state: AnnotationState): AnnotationElement[] {
  if (!state.document) {
    return state.draft ? [state.draft] : [];
  }

  const elements = state.preview
    ? state.document.elements.map((element) =>
        element.id === state.preview?.id ? state.preview : element
      )
    : state.document.elements;
  return state.draft ? [...elements, state.draft] : elements;
}
