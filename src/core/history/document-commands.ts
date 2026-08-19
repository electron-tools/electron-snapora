import type { AnnotationElement, ScreenshotDocument } from '../model/document.js';
import type { ScreenshotCommand } from './command-stack.js';

export class AddElementCommand implements ScreenshotCommand<ScreenshotDocument> {
  readonly #element: AnnotationElement;

  constructor(element: AnnotationElement) {
    this.#element = element;
  }

  execute(document: ScreenshotDocument): ScreenshotDocument {
    if (document.elements.some((element) => element.id === this.#element.id)) {
      return document;
    }

    return { ...document, elements: [...document.elements, this.#element] };
  }

  undo(document: ScreenshotDocument): ScreenshotDocument {
    return {
      ...document,
      elements: document.elements.filter((element) => element.id !== this.#element.id),
    };
  }
}

export class UpdateElementCommand implements ScreenshotCommand<ScreenshotDocument> {
  readonly #before: AnnotationElement;
  readonly #after: AnnotationElement;

  constructor(before: AnnotationElement, after: AnnotationElement) {
    if (before.id !== after.id) {
      throw new Error('An annotation update must preserve the element id.');
    }
    this.#before = before;
    this.#after = after;
  }

  execute(document: ScreenshotDocument): ScreenshotDocument {
    return replaceElement(document, this.#after);
  }

  undo(document: ScreenshotDocument): ScreenshotDocument {
    return replaceElement(document, this.#before);
  }
}

export class RemoveElementCommand implements ScreenshotCommand<ScreenshotDocument> {
  readonly #element: AnnotationElement;
  readonly #index: number;

  constructor(element: AnnotationElement, index: number) {
    this.#element = element;
    this.#index = index;
  }

  execute(document: ScreenshotDocument): ScreenshotDocument {
    return {
      ...document,
      elements: document.elements.filter((element) => element.id !== this.#element.id),
    };
  }

  undo(document: ScreenshotDocument): ScreenshotDocument {
    if (document.elements.some((element) => element.id === this.#element.id)) {
      return document;
    }

    const elements = [...document.elements];
    elements.splice(Math.min(this.#index, elements.length), 0, this.#element);
    return { ...document, elements };
  }
}

function replaceElement(
  document: ScreenshotDocument,
  replacement: AnnotationElement
): ScreenshotDocument {
  let found = false;
  const elements = document.elements.map((element) => {
    if (element.id !== replacement.id) {
      return element;
    }
    found = true;
    return replacement;
  });

  return found ? { ...document, elements } : document;
}
