import { isRectValid, type Point, type Rect } from '../core/geometry/rect.js';
import type { ScreenshotInitializePayload } from '../electron/protocol/messages.js';
import {
  createSelection,
  moveSelection,
  resizeSelection,
  type ResizeHandle,
} from './selection-geometry.js';

export const MINIMUM_SELECTION_SIZE = 4;

export type OverlayPhase =
  'waiting' | 'ready' | 'creating' | 'selected' | 'moving' | 'resizing' | 'exporting';

type OverlayInteraction =
  | { kind: 'create'; pointerId: number; origin: Point }
  | { kind: 'move'; pointerId: number; origin: Point; initialSelection: Rect }
  | {
      kind: 'resize';
      pointerId: number;
      handle: ResizeHandle;
      initialSelection: Rect;
    };

export interface OverlayState {
  phase: OverlayPhase;
  payload: ScreenshotInitializePayload | null;
  selection: Rect | null;
  interaction: OverlayInteraction | null;
}

export type OverlayAction =
  | { type: 'initialize'; payload: ScreenshotInitializePayload }
  | { type: 'image-ready' }
  | { type: 'begin-create'; pointerId: number; point: Point; bounds: Rect }
  | { type: 'begin-move'; pointerId: number; point: Point }
  | { type: 'begin-resize'; pointerId: number; handle: ResizeHandle }
  | { type: 'pointer-move'; pointerId: number; point: Point; bounds: Rect }
  | { type: 'end-interaction'; pointerId: number }
  | { type: 'begin-export' }
  | { type: 'export-failed' };

export interface OverlayStore {
  getState(): OverlayState;
  dispatch(action: OverlayAction): void;
  subscribe(listener: (state: OverlayState) => void): () => void;
}

export const initialOverlayState: OverlayState = {
  phase: 'waiting',
  payload: null,
  selection: null,
  interaction: null,
};

export function createOverlayStore(
  initialState: OverlayState = initialOverlayState
): OverlayStore {
  let state = initialState;
  const listeners = new Set<(nextState: OverlayState) => void>();

  return {
    getState: () => state,
    dispatch(action) {
      const nextState = reduceOverlayState(state, action);
      if (nextState === state) {
        return;
      }

      state = nextState;
      listeners.forEach((listener) => listener(state));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function reduceOverlayState(
  state: OverlayState,
  action: OverlayAction
): OverlayState {
  switch (action.type) {
    case 'initialize':
      return {
        phase: 'waiting',
        payload: action.payload,
        selection: null,
        interaction: null,
      };
    case 'image-ready':
      return state.payload ? { ...state, phase: 'ready' } : state;
    case 'begin-create':
      if (!state.payload || state.phase === 'exporting') {
        return state;
      }
      return {
        ...state,
        phase: 'creating',
        selection: createSelection(action.point, action.point, action.bounds),
        interaction: {
          kind: 'create',
          pointerId: action.pointerId,
          origin: action.point,
        },
      };
    case 'begin-move':
      if (!state.selection || state.phase === 'exporting') {
        return state;
      }
      return {
        ...state,
        phase: 'moving',
        interaction: {
          kind: 'move',
          pointerId: action.pointerId,
          origin: action.point,
          initialSelection: state.selection,
        },
      };
    case 'begin-resize':
      if (!state.selection || state.phase === 'exporting') {
        return state;
      }
      return {
        ...state,
        phase: 'resizing',
        interaction: {
          kind: 'resize',
          pointerId: action.pointerId,
          handle: action.handle,
          initialSelection: state.selection,
        },
      };
    case 'pointer-move':
      return updatePointerInteraction(
        state,
        action.pointerId,
        action.point,
        action.bounds
      );
    case 'end-interaction':
      if (!state.interaction || state.interaction.pointerId !== action.pointerId) {
        return state;
      }
      return {
        ...state,
        phase:
          state.selection && isRectValid(state.selection, MINIMUM_SELECTION_SIZE)
            ? 'selected'
            : 'ready',
        selection:
          state.selection && isRectValid(state.selection, MINIMUM_SELECTION_SIZE)
            ? state.selection
            : null,
        interaction: null,
      };
    case 'begin-export':
      return state.selection && state.phase === 'selected'
        ? { ...state, phase: 'exporting' }
        : state;
    case 'export-failed':
      return state.selection ? { ...state, phase: 'selected' } : state;
  }
}

function updatePointerInteraction(
  state: OverlayState,
  pointerId: number,
  point: Point,
  bounds: Rect
): OverlayState {
  const interaction = state.interaction;
  if (!interaction || interaction.pointerId !== pointerId) {
    return state;
  }

  if (interaction.kind === 'create') {
    return {
      ...state,
      selection: createSelection(interaction.origin, point, bounds),
    };
  }

  if (interaction.kind === 'move') {
    return {
      ...state,
      selection: moveSelection(
        interaction.initialSelection,
        { x: point.x - interaction.origin.x, y: point.y - interaction.origin.y },
        bounds
      ),
    };
  }

  return {
    ...state,
    selection: resizeSelection(
      interaction.initialSelection,
      interaction.handle,
      point,
      bounds,
      MINIMUM_SELECTION_SIZE
    ),
  };
}
