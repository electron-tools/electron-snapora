export interface ScreenshotCommand<TDocument> {
  execute(document: TDocument): TDocument;
  undo(document: TDocument): TDocument;
}

export class CommandStack<TDocument> {
  readonly #undoStack: ScreenshotCommand<TDocument>[] = [];
  readonly #redoStack: ScreenshotCommand<TDocument>[] = [];

  execute(command: ScreenshotCommand<TDocument>, document: TDocument): TDocument {
    const nextDocument = command.execute(document);
    this.#undoStack.push(command);
    this.#redoStack.length = 0;
    return nextDocument;
  }

  undo(document: TDocument): TDocument {
    const command = this.#undoStack.pop();
    if (!command) return document;

    const previousDocument = command.undo(document);
    this.#redoStack.push(command);
    return previousDocument;
  }

  redo(document: TDocument): TDocument {
    const command = this.#redoStack.pop();
    if (!command) return document;

    const nextDocument = command.execute(document);
    this.#undoStack.push(command);
    return nextDocument;
  }

  clear(): void {
    this.#undoStack.length = 0;
    this.#redoStack.length = 0;
  }

  get canUndo(): boolean {
    return this.#undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.#redoStack.length > 0;
  }
}
