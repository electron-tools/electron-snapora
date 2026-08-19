import { describe, expect, it } from 'vitest';
import { createDrawableElement } from './annotation-elements.js';
import { createAnnotationStore, getRenderableElements } from './annotation-store.js';

describe('annotation store', () => {
  it('commits drafts and supports undo and redo', () => {
    const store = createAnnotationStore();
    store.initialize({ x: 0, y: 0, width: 200, height: 100 }, 'rectangle');
    const draft = {
      ...createDrawableElement('rectangle', { x: 10, y: 10 }, store.getState().style, {
        id: 'rect-1',
        zIndex: 0,
        createdAt: 1,
      }),
      bounds: { x: 10, y: 10, width: 50, height: 30 },
    };
    store.setDraft(draft);
    expect(getRenderableElements(store.getState())).toEqual([draft]);
    store.commitDraft();
    expect(store.getState()).toMatchObject({
      canUndo: true,
      selectedElementId: 'rect-1',
    });

    store.undo();
    expect(store.getState().document?.elements).toEqual([]);
    expect(store.getState().canRedo).toBe(true);
    store.redo();
    expect(store.getState().document?.elements).toEqual([draft]);
  });

  it('can commit a mosaic area without selecting it', () => {
    const store = createAnnotationStore();
    store.initialize({ x: 0, y: 0, width: 200, height: 100 }, 'mosaic');
    const draft = {
      ...createDrawableElement('mosaic', { x: 10, y: 10 }, store.getState().style, {
        id: 'mosaic-1',
        zIndex: 0,
        createdAt: 1,
      }),
      bounds: { x: 10, y: 10, width: 50, height: 30 },
    };
    store.setDraft(draft);
    store.commitDraft(false);

    expect(store.getState().document?.elements).toEqual([draft]);
    expect(store.getState().selectedElementId).toBeNull();
  });

  it('can commit text without leaving resize handles selected', () => {
    const store = createAnnotationStore();
    store.initialize({ x: 0, y: 0, width: 200, height: 100 }, 'text');
    const draft = {
      id: 'text-1',
      type: 'text' as const,
      zIndex: 0,
      createdAt: 1,
      color: '#f00',
      position: { x: 10, y: 34 },
      value: '未回车文字',
      fontSize: 24,
      metrics: { width: 120, ascent: 20, descent: 5 },
    };
    store.setDraft(draft);
    store.commitDraft(false);

    expect(store.getState().document?.elements).toEqual([draft]);
    expect(store.getState().selectedElementId).toBeNull();
  });

  it('tracks update and delete operations in history', () => {
    const store = createAnnotationStore();
    store.initialize({ x: 0, y: 0, width: 200, height: 100 });
    const element = {
      ...createDrawableElement('ellipse', { x: 10, y: 10 }, store.getState().style, {
        id: 'ellipse-1',
        zIndex: 0,
        createdAt: 1,
      }),
      bounds: { x: 10, y: 10, width: 50, height: 30 },
    };
    store.setDraft(element);
    store.commitDraft();
    const moved = { ...element, bounds: { ...element.bounds, x: 30 } };
    store.preview(moved);
    store.commitUpdate(element, moved);
    expect(store.getState().document?.elements[0]).toEqual(moved);

    store.deleteSelected();
    expect(store.getState().document?.elements).toEqual([]);
    store.undo();
    expect(store.getState().document?.elements).toEqual([moved]);
  });
});
