import { describe, expect, it } from 'vitest';
import type { RectangleElement, ScreenshotDocument } from '../model/document.js';
import { CommandStack } from './command-stack.js';
import {
  AddElementCommand,
  RemoveElementCommand,
  UpdateElementCommand,
} from './document-commands.js';

const rectangle: RectangleElement = {
  id: 'rect-1',
  type: 'rectangle',
  zIndex: 0,
  createdAt: 1,
  color: '#ff0000',
  lineWidth: 3,
  bounds: { x: 10, y: 20, width: 30, height: 40 },
};

function createDocument(): ScreenshotDocument {
  return {
    selection: { x: 0, y: 0, width: 200, height: 100 },
    elements: [],
  };
}

describe('annotation document commands', () => {
  it('adds, updates and removes elements with reversible history', () => {
    const history = new CommandStack<ScreenshotDocument>();
    let document = history.execute(new AddElementCommand(rectangle), createDocument());
    expect(document.elements).toEqual([rectangle]);

    const moved = { ...rectangle, bounds: { ...rectangle.bounds, x: 50 } };
    document = history.execute(new UpdateElementCommand(rectangle, moved), document);
    expect(document.elements[0]).toEqual(moved);

    document = history.execute(new RemoveElementCommand(moved, 0), document);
    expect(document.elements).toEqual([]);
    document = history.undo(document);
    expect(document.elements).toEqual([moved]);
    document = history.undo(document);
    expect(document.elements).toEqual([rectangle]);
    document = history.redo(document);
    expect(document.elements).toEqual([moved]);
  });

  it('keeps the document JSON serializable', () => {
    const document = new AddElementCommand(rectangle).execute(createDocument());
    expect(JSON.parse(JSON.stringify(document))).toEqual(document);
  });
});
