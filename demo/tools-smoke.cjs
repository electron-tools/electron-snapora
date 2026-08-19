process.on('uncaughtException', (error) => {
  console.error(error);
  process.exit(3);
});
process.on('unhandledRejection', (error) => {
  console.error(error);
  process.exit(4);
});

const { app, clipboard } = require('electron');
const { ScreenshotManager } = require('electron-snapora/main');

app.disableHardwareAcceleration();

const smokeTimeout = setTimeout(() => {
  console.error('Electron Snapora tools smoke test timed out.');
  process.exit(2);
}, 30_000);

function sendClick(window, point) {
  window.webContents.sendInputEvent({
    type: 'mouseDown',
    ...point,
    button: 'left',
    clickCount: 1,
  });
  window.webContents.sendInputEvent({
    type: 'mouseUp',
    ...point,
    button: 'left',
    clickCount: 1,
  });
}

function sendDrag(window, start, end, steps = 1) {
  window.webContents.sendInputEvent({
    type: 'mouseDown',
    ...start,
    button: 'left',
    clickCount: 1,
  });
  for (let step = 1; step <= steps; step += 1) {
    const ratio = step / steps;
    window.webContents.sendInputEvent({
      type: 'mouseMove',
      x: Math.round(start.x + (end.x - start.x) * ratio),
      y: Math.round(start.y + (end.y - start.y) * ratio),
    });
  }
  window.webContents.sendInputEvent({
    type: 'mouseUp',
    ...end,
    button: 'left',
    clickCount: 1,
  });
}

async function nextFrame(window) {
  await window.webContents.executeJavaScript(
    'new Promise((resolve) => requestAnimationFrame(() => resolve()))'
  );
}

async function waitForReveal(window) {
  while (!window.isDestroyed() && window.getOpacity() < 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function getToolCenter(window, tool) {
  return window.webContents.executeJavaScript(`
    (() => {
      const button = document.querySelector('[data-tool="${tool}"]');
      const bounds = button?.getBoundingClientRect();
      return bounds && !button.hidden && bounds.width > 0 && bounds.height > 0
        ? { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) }
        : null;
    })()
  `);
}

async function activateTool(window, tool) {
  const center = await getToolCenter(window, tool);
  if (!center) {
    throw new Error(`${tool} tool was not rendered.`);
  }
  sendClick(window, center);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const toolState = await window.webContents.executeJavaScript(`
    (() => {
      const colorControl = document.querySelector('.color-control');
      const colorBounds = colorControl?.getBoundingClientRect();
      const colorStyle = colorControl ? getComputedStyle(colorControl) : null;
      return {
        surfaceTool: document.querySelector('.capture-surface')?.dataset.tool,
        colorVisible: Boolean(
          colorBounds &&
          colorBounds.width > 0 &&
          colorStyle?.display !== 'none' &&
          colorStyle?.visibility === 'visible'
        ),
      };
    })()
  `);
  if (toolState.surfaceTool !== tool || !toolState.colorVisible) {
    const hitTarget = await window.webContents.executeJavaScript(`
      (() => {
        const target = document.elementFromPoint(${center.x}, ${center.y});
        const toolbar = document.querySelector('.selection-toolbar');
        return {
          tag: target?.tagName,
          className: target?.getAttribute('class'),
          tool: target?.closest?.('[data-tool]')?.dataset.tool,
          toolbarHidden: toolbar?.hidden,
          toolbarBounds: toolbar?.getBoundingClientRect().toJSON(),
          surfaceTool: document.querySelector('.capture-surface')?.dataset.tool,
          activeTools: Array.from(document.querySelectorAll('[data-tool]'))
            .filter((button) => button.dataset.active === 'true')
            .map((button) => button.dataset.tool),
        };
      })()
    `);
    throw new Error(
      `${tool} tool did not become active (${JSON.stringify(toolState)}) at ${JSON.stringify(center)}: ${JSON.stringify(hitTarget)}`
    );
  }
}

async function countRegionPixels(window, region) {
  return window.webContents.executeJavaScript(`
    (() => {
      const canvas = document.querySelector('.annotation-canvas');
      const context = canvas?.getContext('2d');
      if (!canvas || !context) return 0;
      const scaleX = canvas.width / canvas.clientWidth;
      const scaleY = canvas.height / canvas.clientHeight;
      const x = Math.max(0, Math.floor(${region.x} * scaleX));
      const y = Math.max(0, Math.floor(${region.y} * scaleY));
      const width = Math.min(canvas.width - x, Math.ceil(${region.width} * scaleX));
      const height = Math.min(canvas.height - y, Math.ceil(${region.height} * scaleY));
      const pixels = context.getImageData(x, y, width, height).data;
      let count = 0;
      for (let index = 3; index < pixels.length; index += 4) {
        if (pixels[index] > 0) count += 1;
      }
      return count;
    })()
  `);
}

async function assertToolDraws(window, tool, start, end, steps = 1) {
  await activateTool(window, tool);
  const padding = 16;
  const region = {
    x: Math.min(start.x, end.x) - padding,
    y: Math.min(start.y, end.y) - padding,
    width: Math.abs(end.x - start.x) + padding * 2,
    height: Math.abs(end.y - start.y) + padding * 2,
  };
  const before = await countRegionPixels(window, region);
  sendDrag(window, start, end, steps);
  await nextFrame(window);
  const after = await countRegionPixels(window, region);
  if (after <= before) {
    throw new Error(`${tool} tool did not add visible pixels (${before} -> ${after}).`);
  }
}

app.on('browser-window-created', (_event, window) => {
  window.once('show', async () => {
    await waitForReveal(window);
    await window.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const waitUntilReady = () => {
          if (document.querySelector('.capture-surface')?.dataset.state === 'ready') {
            resolve();
            return;
          }
          requestAnimationFrame(waitUntilReady);
        };
        waitUntilReady();
      })
    `);

    const { width, height } = window.getContentBounds();
    const selectionStart = {
      x: Math.round(width * 0.1),
      y: Math.round(height * 0.1),
    };
    const selectionEnd = {
      x: Math.round(width * 0.9),
      y: Math.round(height * 0.72),
    };
    sendDrag(window, selectionStart, selectionEnd);
    const selectionReady = await window.webContents.executeJavaScript(`
      new Promise((resolve) => {
        let remainingFrames = 30;
        const readSelectionState = () => {
          const surface = document.querySelector('.capture-surface');
          const toolbar = document.querySelector('.selection-toolbar');
          if ((surface?.dataset.state === 'selected' && !toolbar?.hidden) || remainingFrames <= 0) {
            resolve(surface?.dataset.state === 'selected' && !toolbar?.hidden);
            return;
          }
          remainingFrames -= 1;
          requestAnimationFrame(readSelectionState);
        };
        readSelectionState();
      })
    `);
    if (!selectionReady) {
      throw new Error('Selection toolbar did not become ready.');
    }

    const colorPlacement = await window.webContents.executeJavaScript(`
      (() => {
        const panels = Array.from(document.querySelectorAll('.selection-toolbar > .toolbar-panel'));
        const color = document.querySelector('.color-control');
        const toolPanel = document.querySelector('.tool-group');
        return {
          panelIndex: panels.indexOf(color?.parentElement),
          isFirst: toolPanel?.firstElementChild === color,
          brushIcon: document
            .querySelector('[data-tool="brush"] use')
            ?.getAttribute('href'),
          hasBrushSymbol: Boolean(document.querySelector('#icon-brush')),
        };
      })()
    `);
    if (
      colorPlacement.panelIndex !== 1 ||
      !colorPlacement.isFirst ||
      colorPlacement.brushIcon !== '#icon-brush' ||
      !colorPlacement.hasBrushSymbol
    ) {
      throw new Error(
        `Tool panel placement or brush icon was invalid: ${JSON.stringify(colorPlacement)}`
      );
    }

    const toolbarSpacing = await window.webContents.executeJavaScript(`
      (() => {
        const tools = getComputedStyle(document.querySelector('.tool-group'));
        const actions = getComputedStyle(document.querySelector('.action-group'));
        return {
          toolGap: tools.gap,
          actionGap: actions.gap,
          toolPaddingLeft: tools.paddingLeft,
          actionPaddingLeft: actions.paddingLeft,
          toolPaddingRight: tools.paddingRight,
          actionPaddingRight: actions.paddingRight,
        };
      })()
    `);
    if (
      toolbarSpacing.toolGap !== toolbarSpacing.actionGap ||
      toolbarSpacing.toolPaddingLeft !== toolbarSpacing.actionPaddingLeft ||
      toolbarSpacing.toolPaddingRight !== toolbarSpacing.actionPaddingRight
    ) {
      throw new Error(
        `Tool and action spacing differ: ${JSON.stringify(toolbarSpacing)}`
      );
    }

    const left = selectionStart.x + 70;
    const top = selectionStart.y + 70;
    const columnGap = Math.round((selectionEnd.x - selectionStart.x - 220) / 3);
    const rowGap = Math.round((selectionEnd.y - selectionStart.y - 180) / 2);

    await assertToolDraws(
      window,
      'rectangle',
      { x: left, y: top },
      { x: left + 130, y: top + 80 }
    );
    await assertToolDraws(
      window,
      'ellipse',
      { x: left + columnGap, y: top },
      { x: left + columnGap + 130, y: top + 80 }
    );
    await assertToolDraws(
      window,
      'arrow',
      { x: left + columnGap * 2, y: top + 20 },
      { x: left + columnGap * 2 + 130, y: top + 75 }
    );
    await assertToolDraws(
      window,
      'brush',
      { x: left, y: top + rowGap },
      { x: left + 130, y: top + rowGap + 75 },
      12
    );
    const brushSelection = await window.webContents.executeJavaScript(
      `document.querySelector('.capture-surface')?.dataset.selectedType ?? null`
    );
    if (brushSelection !== null) {
      throw new Error(`Brush remained selected after drawing: ${brushSelection}`);
    }
    await assertToolDraws(
      window,
      'mosaic',
      { x: left + columnGap, y: top + rowGap },
      { x: left + columnGap + 130, y: top + rowGap + 75 },
      12
    );
    const mosaicSettings = await window.webContents.executeJavaScript(`
      (() => {
        const styleGroup = document.querySelector('.style-group');
        return {
          styleDisplay: styleGroup ? getComputedStyle(styleGroup).display : null,
        };
      })()
    `);
    if (mosaicSettings.styleDisplay !== 'none') {
      throw new Error(
        `Mosaic still exposed a size control: ${JSON.stringify(mosaicSettings)}`
      );
    }

    await activateTool(window, 'text');
    const textPoint = {
      x: left + columnGap * 2,
      y: top + rowGap + 20,
    };
    const textRegion = {
      x: textPoint.x - 8,
      y: textPoint.y - 8,
      width: 220,
      height: 70,
    };
    const beforeText = await countRegionPixels(window, textRegion);
    sendClick(window, textPoint);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const editorReady = await window.webContents.executeJavaScript(`
      (() => {
        const editor = document.querySelector('.text-editor');
        return Boolean(editor && !editor.hidden && document.activeElement === editor);
      })()
    `);
    if (!editorReady) {
      const editorState = await window.webContents.executeJavaScript(`
        (() => {
          const editor = document.querySelector('.text-editor');
          const hitTarget = document.elementFromPoint(${textPoint.x}, ${textPoint.y});
          return {
            hidden: editor?.hidden,
            activeTag: document.activeElement?.tagName,
            activeClass: document.activeElement?.getAttribute?.('class'),
            surfaceTool: document.querySelector('.capture-surface')?.dataset.tool,
            hitTag: hitTarget?.tagName,
            hitClass: hitTarget?.getAttribute?.('class'),
          };
        })()
      `);
      throw new Error(
        `Text editor did not open and receive focus: ${JSON.stringify(editorState)}`
      );
    }
    await window.webContents.insertText(
      'Snapora\nTools\nNo scrollbar\nLine 4\nLine 5\nLine 6\nLine 7'
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    const editorOverflow = await window.webContents.executeJavaScript(`
      (() => {
        const editor = document.querySelector('.text-editor');
        if (!editor) return null;
        const style = getComputedStyle(editor);
        return {
          overflowY: style.overflowY,
          clientHeight: editor.clientHeight,
          scrollHeight: editor.scrollHeight,
          backgroundColor: style.backgroundColor,
          borderTopColor: style.borderTopColor,
          borderTopWidth: style.borderTopWidth,
        };
      })()
    `);
    if (
      !editorOverflow ||
      editorOverflow.overflowY !== 'hidden' ||
      editorOverflow.clientHeight < editorOverflow.scrollHeight
    ) {
      throw new Error(
        `Text editor did not expand without scrolling: ${JSON.stringify(editorOverflow)}`
      );
    }
    if (
      editorOverflow.backgroundColor !== 'rgba(0, 0, 0, 0)' ||
      !['rgb(255, 255, 255)', 'rgba(255, 255, 255, 0.9)'].includes(
        editorOverflow.borderTopColor
      ) ||
      editorOverflow.borderTopWidth === '0px'
    ) {
      throw new Error(
        `Text editor did not use a transparent background and white border: ${JSON.stringify(editorOverflow)}`
      );
    }
    const nextTextPoint = { x: textPoint.x - 60, y: textPoint.y };
    sendClick(window, nextTextPoint);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const nextEditorState = await window.webContents.executeJavaScript(`
      (() => {
        const editor = document.querySelector('.text-editor');
        return {
          visible: Boolean(editor && !editor.hidden),
          focused: document.activeElement === editor,
          value: editor?.value,
        };
      })()
    `);
    if (
      !nextEditorState.visible ||
      !nextEditorState.focused ||
      nextEditorState.value !== ''
    ) {
      throw new Error(
        `Clicking another text area did not commit and open a clean editor: ${JSON.stringify(nextEditorState)}`
      );
    }
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await nextFrame(window);
    const afterText = await countRegionPixels(window, textRegion);
    if (afterText <= beforeText) {
      throw new Error(
        `text tool did not add visible pixels (${beforeText} -> ${afterText}).`
      );
    }
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Delete' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Delete' });
    await nextFrame(window);
    const afterUnselectedDelete = await countRegionPixels(window, textRegion);
    if (afterUnselectedDelete !== afterText) {
      throw new Error(
        `Committed text remained selected after editing (${afterText} -> ${afterUnselectedDelete}).`
      );
    }

    await activateTool(window, 'select');
    const rectangleRegion = {
      x: left - 20,
      y: top - 20,
      width: 170,
      height: 120,
    };
    sendClick(window, { x: left + 65, y: top + 40 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const beforeDelete = await countRegionPixels(window, rectangleRegion);
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Delete' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Delete' });
    await nextFrame(window);
    const afterDelete = await countRegionPixels(window, rectangleRegion);
    if (afterDelete >= beforeDelete) {
      throw new Error(
        `Select/Delete did not remove the rectangle (${beforeDelete} -> ${afterDelete}).`
      );
    }

    window.webContents.sendInputEvent({
      type: 'keyDown',
      keyCode: 'Z',
      modifiers: ['control'],
    });
    window.webContents.sendInputEvent({
      type: 'keyUp',
      keyCode: 'Z',
      modifiers: ['control'],
    });
    await nextFrame(window);
    const afterUndo = await countRegionPixels(window, rectangleRegion);
    if (afterUndo <= afterDelete) {
      throw new Error(
        `Undo did not restore the rectangle (${afterDelete} -> ${afterUndo}).`
      );
    }

    window.webContents.sendInputEvent({
      type: 'keyDown',
      keyCode: 'Z',
      modifiers: ['control', 'shift'],
    });
    window.webContents.sendInputEvent({
      type: 'keyUp',
      keyCode: 'Z',
      modifiers: ['control', 'shift'],
    });
    await nextFrame(window);
    const afterRedo = await countRegionPixels(window, rectangleRegion);
    if (afterRedo >= afterUndo) {
      throw new Error(
        `Redo did not remove the rectangle (${afterUndo} -> ${afterRedo}).`
      );
    }

    window.webContents.sendInputEvent({
      type: 'keyDown',
      keyCode: 'Z',
      modifiers: ['control'],
    });
    window.webContents.sendInputEvent({
      type: 'keyUp',
      keyCode: 'Z',
      modifiers: ['control'],
    });
    await nextFrame(window);

    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
  });
});

app.whenReady().then(async () => {
  const manager = new ScreenshotManager();
  const result = await manager.capture({ display: 'cursor' });
  clearTimeout(smokeTimeout);

  if (
    result.status !== 'completed' ||
    result.data.byteLength < 8 ||
    result.mimeType !== 'image/png' ||
    result.output.action !== 'copy' ||
    result.data[0] !== 0x89 ||
    result.data[1] !== 0x50
  ) {
    console.error('Electron Snapora tools smoke test failed:', result);
    process.exit(1);
    return;
  }

  if (clipboard.readImage().isEmpty()) {
    console.error('Electron Snapora confirmation did not copy an image.');
    process.exit(1);
    return;
  }

  console.log(
    `Electron Snapora tools smoke test passed (${result.data.byteLength} bytes).`
  );
  process.exit(0);
});
