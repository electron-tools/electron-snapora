process.on('uncaughtException', (error) => {
  console.error(error);
  process.exit(3);
});
process.on('unhandledRejection', (error) => {
  console.error(error);
  process.exit(4);
});

const { app, clipboard, nativeImage, screen } = require('electron');
const { ScreenshotManager } = require('electron-snapora/main');

app.disableHardwareAcceleration();

// NativeImage 位图通道顺序由平台决定，先用已知红色像素定位 R/B 通道。
const redPixel = nativeImage
  .createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  )
  .toBitmap();
const redChannelOffset = redPixel[0] > redPixel[2] ? 0 : 2;
const blueChannelOffset = redChannelOffset === 0 ? 2 : 0;

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

/** Windows 剪贴板写入可能晚于 IPC 返回一个消息循环，短轮询避免瞬时空读。 */
async function waitForClipboardImage(maximumWaitMs = 600) {
  const deadline = Date.now() + maximumWaitMs;
  do {
    if (!clipboard.readImage().isEmpty()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  } while (Date.now() < deadline);
  return false;
}

async function getToolCenter(window, tool) {
  return window.webContents.executeJavaScript(`
    (() => {
      const button = document.querySelector('button[data-tool="${tool}"]');
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
  await new Promise((resolve) => setTimeout(resolve, 50));
  await window.webContents.executeJavaScript(`
    Promise.all(
      document.getAnimations().map((animation) =>
        animation.finished.catch(() => undefined)
      )
    )
  `);
  const toolState = await window.webContents.executeJavaScript(`
    (() => {
      const surface = document.querySelector('.capture-surface');
      const presetPanel = document.querySelector('.preset-panel');
      const colorControl = document.querySelector('.color-control');
      const colorBounds = colorControl?.getBoundingClientRect();
      const colorStyle = colorControl ? getComputedStyle(colorControl) : null;
      return {
        surfaceTool: surface?.dataset.tool,
        preset: surface?.dataset.preset ?? null,
        presetVisible: Boolean(presetPanel && !presetPanel.hidden),
        colorVisible: Boolean(
          colorBounds &&
          colorBounds.width > 0 &&
          colorStyle?.display !== 'none' &&
          colorStyle?.visibility === 'visible'
        ),
      };
    })()
  `);
  const expectedPreset = {
    rectangle: 'stroke',
    ellipse: 'stroke',
    arrow: 'stroke',
    brush: 'stroke',
    text: 'text',
    mosaic: 'mosaic',
    watermark: 'watermark',
  }[tool];
  const expectedColorVisible = expectedPreset !== undefined && tool !== 'mosaic';
  if (
    toolState.surfaceTool !== tool ||
    toolState.preset !== (expectedPreset ?? null) ||
    toolState.presetVisible !== Boolean(expectedPreset) ||
    toolState.colorVisible !== expectedColorVisible
  ) {
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

/** 读取指定区域内红色文字的可见像素边界，用于比较输入态和 Canvas 提交态的位置。 */
async function getRedPixelBounds(window, region) {
  const image = await window.webContents.capturePage(region);
  const { width, height } = image.getSize();
  const bitmap = image.toBitmap();
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const blue = bitmap[index + blueChannelOffset];
      const green = bitmap[index + 1];
      const red = bitmap[index + redChannelOffset];
      const alpha = bitmap[index + 3];
      if (red > 180 && red > green * 1.5 && red > blue * 1.5 && alpha > 128) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
  }
  return right >= left ? { left, top, right, bottom } : null;
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
  if (['rectangle', 'ellipse', 'arrow'].includes(tool)) {
    const selectedType = await window.webContents.executeJavaScript(
      `document.querySelector('.capture-surface')?.dataset.selectedType ?? null`
    );
    if (selectedType !== null) {
      throw new Error(`${tool} remained selected after drawing: ${selectedType}`);
    }
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

    const captureCursor = await window.webContents.executeJavaScript(`
      (() => {
        const surface = document.querySelector('.capture-surface');
        const canvas = document.querySelector('.annotation-canvas');
        const originalTool = surface.dataset.tool;
        surface.dataset.tool = 'text';
        const cursor = getComputedStyle(canvas).cursor;
        surface.dataset.tool = originalTool;
        return cursor;
      })()
    `);
    if (!captureCursor.includes('url(') || !captureCursor.includes('crosshair')) {
      throw new Error(`Capture-ready cursor was not applied: ${captureCursor}`);
    }

    const { width, height } = window.getContentBounds();
    const snapPoint = await window.webContents.executeJavaScript(
      `({ x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) })`
    );
    await window.webContents.executeJavaScript(`
      document.querySelector('.annotation-canvas')?.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          pointerId: 41,
          pointerType: 'mouse',
          clientX: ${snapPoint.x},
          clientY: ${snapPoint.y}
        })
      )
    `);
    await nextFrame(window);
    const snapPreview = await window.webContents.executeJavaScript(`
      (() => {
        const preview = document.querySelector('.window-snap-preview');
        const mask = document.querySelector('.screen-mask');
        return {
          visible: Boolean(preview && !preview.hidden),
          bounds: preview?.getBoundingClientRect().toJSON(),
          maskHidden: mask?.hidden,
        };
      })()
    `);
    if (snapPreview.visible || snapPreview.maskHidden) {
      throw new Error(
        `Disabled window snap unexpectedly showed a preview: ${JSON.stringify({ snapPoint, snapPreview })}`
      );
    }
    const selectionStart = {
      x: Math.round(width * 0.1),
      y: Math.round(height * 0.1),
    };
    const selectionEnd = {
      x: Math.round(width * 0.9),
      y: Math.round(height * 0.72),
    };
    sendDrag(window, selectionStart, selectionEnd);
    await nextFrame(window);
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

    const tooltipButtonCenter = await getToolCenter(window, 'rectangle');
    if (!tooltipButtonCenter) {
      throw new Error('Rectangle tooltip target was not rendered.');
    }
    window.webContents.sendInputEvent({
      type: 'mouseMove',
      ...tooltipButtonCenter,
      movementX: 1,
      movementY: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 450));
    const tooltipVisible = await window.webContents.executeJavaScript(`
      getComputedStyle(
        document.querySelector('button[data-tool="rectangle"]'),
        '::after'
      ).opacity
    `);
    await window.webContents.executeJavaScript(`
      (() => {
        const button = document.querySelector('button[data-tool="rectangle"]');
        const canvas = document.querySelector('.annotation-canvas');
        button?.dispatchEvent(
          new PointerEvent('pointerdown', {
            bubbles: true,
            pointerId: 71,
            pointerType: 'mouse',
            button: 0,
            buttons: 1,
          })
        );
        canvas?.dispatchEvent(
          new PointerEvent('pointermove', {
            bubbles: true,
            pointerId: 71,
            pointerType: 'mouse',
            buttons: 1,
          })
        );
      })()
    `);
    const tooltipDraggedAway = await window.webContents.executeJavaScript(`
      (() => ({
        opacity: getComputedStyle(
          document.querySelector('button[data-tool="rectangle"]'),
          '::after'
        ).opacity,
        pointerState: document.documentElement.dataset.tooltipPointer,
        confirm: document.querySelector('.confirm-button')?.dataset.tooltip,
      }))()
    `);
    await window.webContents.executeJavaScript(`
      document.querySelector('.annotation-canvas')?.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          pointerId: 71,
          pointerType: 'mouse',
          button: 0,
          buttons: 0,
        })
      )
    `);
    const tooltipReleased = await window.webContents.executeJavaScript(
      `document.documentElement.dataset.tooltipPointer ?? null`
    );
    if (
      tooltipDraggedAway.opacity !== '0' ||
      tooltipDraggedAway.pointerState !== 'down' ||
      tooltipDraggedAway.confirm !== 'Done' ||
      tooltipReleased !== null
    ) {
      throw new Error(
        `Toolbar tooltip pointer state was invalid: ${JSON.stringify({ tooltipVisible, tooltipDraggedAway, tooltipReleased })}`
      );
    }

    await activateTool(window, 'rectangle');
    const colorPlacement = await window.webContents.executeJavaScript(`
      (() => {
        const preset = document.querySelector('.preset-panel');
        const palette = document.querySelector('.color-palette');
        const color = document.querySelector('.color-control');
        const customColorIcon = color?.querySelector('.custom-color-icon');
        const customColorInput = document.querySelector('.color-input');
        const toolPanel = document.querySelector('.tool-group');
        const selectPanel = document.querySelector('.selection-tool-panel');
        const activeColor = document.querySelector('[data-color="#ff3b30"]');
        const linePreset = document.querySelector('[data-line-width="4"]');
        const lineDot = linePreset?.querySelector('.line-width-dot');
        const rectangleButton = document.querySelector(
          'button[data-tool="rectangle"]'
        );
        const presetBounds = preset?.getBoundingClientRect();
        const buttonBounds = rectangleButton?.getBoundingClientRect();
        const arrowStyle = preset ? getComputedStyle(preset, '::before') : null;
        const arrowX = preset
          ? parseFloat(getComputedStyle(preset).getPropertyValue('--preset-arrow-x'))
          : null;
        const activeColorStyle = activeColor ? getComputedStyle(activeColor) : null;
        const activeCheckStyle = activeColor
          ? getComputedStyle(activeColor, '::after')
          : null;
        const customColorStyle = color ? getComputedStyle(color) : null;
        const customIconStyle = customColorIcon
          ? getComputedStyle(customColorIcon)
          : null;
        const customInputStyle = customColorInput
          ? getComputedStyle(customColorInput)
          : null;
        return {
          colorRemovedFromMain: !toolPanel?.contains(color),
          customColorIsLast: palette?.lastElementChild === color,
          presetVisible: Boolean(preset && !preset.hidden),
          presetKind: document.querySelector('.capture-surface')?.dataset.preset,
          presetInlineLeft: preset?.style.left,
          presetInlineArrow: preset?.style.getPropertyValue('--preset-arrow-x'),
          presetComputedLeft: preset ? getComputedStyle(preset).left : null,
          presetBounds: presetBounds?.toJSON(),
          buttonBounds: buttonBounds?.toJSON(),
          toolbarBounds: document
            .querySelector('.selection-toolbar')
            ?.getBoundingClientRect()
            .toJSON(),
          toolbarHasPreset: document.querySelector('.selection-toolbar')?.dataset
            .hasPreset,
          brushIcon: document
            .querySelector('button[data-tool="brush"] use')
            ?.getAttribute('href'),
          hasBrushSymbol: Boolean(document.querySelector('#icon-brush')),
          selectPanelWidth: selectPanel?.getBoundingClientRect().width,
          colorSize: activeColor?.getBoundingClientRect().width,
          customColorSize: color?.getBoundingClientRect().width,
          customColorIconSize: customColorIcon?.getBoundingClientRect().width,
          colorBorderWidth: activeColorStyle?.borderTopWidth,
          colorTransition: activeColorStyle?.transitionDuration,
          checkOpacity: activeCheckStyle?.opacity,
          checkFilter: activeCheckStyle?.filter,
          customColorActive: color?.dataset.active,
          customColorBorderWidth: customColorStyle?.borderTopWidth,
          customColorBackground: customColorStyle?.backgroundColor,
          customIconGradient: customIconStyle?.backgroundImage,
          customInputDisplay: customInputStyle?.display,
          customInputType: customColorInput?.type,
          lineTransition: linePreset
            ? getComputedStyle(linePreset).transitionDuration
            : null,
          dotTransition: lineDot ? getComputedStyle(lineDot).transitionDuration : null,
          arrowDistance:
            presetBounds && buttonBounds && Number.isFinite(arrowX)
              ? Math.abs(
                  arrowX -
                    (buttonBounds.left + buttonBounds.width / 2 - presetBounds.left)
                )
              : null,
          arrowContent: arrowStyle?.content,
        };
      })()
    `);
    if (
      !colorPlacement.colorRemovedFromMain ||
      !colorPlacement.customColorIsLast ||
      !colorPlacement.presetVisible ||
      colorPlacement.presetKind !== 'stroke' ||
      colorPlacement.brushIcon !== '#icon-brush' ||
      !colorPlacement.hasBrushSymbol ||
      typeof colorPlacement.selectPanelWidth !== 'number' ||
      colorPlacement.selectPanelWidth > 50 ||
      typeof colorPlacement.colorSize !== 'number' ||
      colorPlacement.colorSize > 24.5 ||
      typeof colorPlacement.customColorSize !== 'number' ||
      typeof colorPlacement.customColorIconSize !== 'number' ||
      Math.abs(colorPlacement.customColorSize - colorPlacement.colorSize) > 0.5 ||
      Math.abs(colorPlacement.customColorIconSize - colorPlacement.colorSize) > 0.5 ||
      colorPlacement.colorBorderWidth !== '0px' ||
      colorPlacement.colorTransition === '0s' ||
      colorPlacement.checkOpacity !== '1' ||
      !colorPlacement.checkFilter ||
      colorPlacement.checkFilter === 'none' ||
      colorPlacement.customColorActive !== 'false' ||
      colorPlacement.customColorBorderWidth !== '0px' ||
      colorPlacement.customColorBackground === 'rgb(255, 59, 48)' ||
      !colorPlacement.customIconGradient?.includes('conic-gradient') ||
      colorPlacement.customInputDisplay !== 'none' ||
      colorPlacement.customInputType !== 'hidden' ||
      colorPlacement.lineTransition === '0s' ||
      colorPlacement.dotTransition === '0s' ||
      typeof colorPlacement.arrowDistance !== 'number' ||
      colorPlacement.arrowDistance > 3 ||
      colorPlacement.arrowContent === 'none'
    ) {
      throw new Error(
        `Preset panel placement or brush icon was invalid: ${JSON.stringify(colorPlacement)}`
      );
    }

    const customPickerLayout = await window.webContents.executeJavaScript(`
      (() => {
        const control = document.querySelector('.color-control');
        control?.click();
        const picker = document.querySelector('.color-picker-popover');
        const saturation = document.querySelector('.color-picker-saturation');
        const hue = document.querySelector('.color-picker-hue');
        return {
          visible: Boolean(picker && !picker.hidden),
          saturationWidth: saturation?.getBoundingClientRect().width,
          hueWidth: hue?.getBoundingClientRect().width,
          inputType: document.querySelector('.color-input')?.type,
          expanded: control?.getAttribute('aria-expanded'),
        };
      })()
    `);
    if (
      !customPickerLayout.visible ||
      customPickerLayout.inputType !== 'hidden' ||
      customPickerLayout.expanded !== 'true' ||
      typeof customPickerLayout.saturationWidth !== 'number' ||
      typeof customPickerLayout.hueWidth !== 'number' ||
      Math.abs(customPickerLayout.saturationWidth - customPickerLayout.hueWidth) > 0.5
    ) {
      throw new Error(
        `Custom color picker layout was invalid: ${JSON.stringify(customPickerLayout)}`
      );
    }

    const customColorState = await window.webContents.executeJavaScript(`
      (async () => {
        const input = document.querySelector('.color-input');
        const custom = document.querySelector('.color-control');
        const customCheck = document.querySelector('.color-check');
        const customCheckStyle = getComputedStyle(customCheck);
        const presetCheck = getComputedStyle(
          document.querySelector('.preset-color-button'),
          '::after'
        );
        input.value = '#bf5af2';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await Promise.all(
          document.getAnimations().map((animation) =>
            animation.finished.catch(() => undefined)
          )
        );
        const state = {
          active: custom?.dataset.active,
          fixedActiveCount: document.querySelectorAll(
            '.preset-color-button[data-active="true"]'
          ).length,
          hasInnerCircle: Boolean(document.querySelector('.custom-color-swatch')),
          checkOpacity: custom
            ? customCheckStyle.opacity
            : null,
          checkWidth: parseFloat(customCheckStyle.width),
          checkHeight: parseFloat(customCheckStyle.height),
          presetCheckWidth: parseFloat(presetCheck.width),
          presetCheckHeight: parseFloat(presetCheck.height),
          borderWidth: custom ? getComputedStyle(custom).borderTopWidth : null,
          boxShadow: custom ? getComputedStyle(custom).boxShadow : null,
        };
        document.querySelector('[data-color="#ff3b30"]')?.click();
        return state;
      })()
    `);
    if (
      customColorState.active !== 'true' ||
      customColorState.fixedActiveCount !== 0 ||
      customColorState.hasInnerCircle ||
      customColorState.checkOpacity !== '1' ||
      typeof customColorState.checkWidth !== 'number' ||
      typeof customColorState.checkHeight !== 'number' ||
      Math.abs(customColorState.checkWidth - customColorState.presetCheckWidth) > 0.5 ||
      Math.abs(customColorState.checkHeight - customColorState.presetCheckHeight) >
        0.5 ||
      customColorState.borderWidth !== '0px' ||
      !customColorState.boxShadow ||
      customColorState.boxShadow === 'none'
    ) {
      throw new Error(
        `Custom color did not stay visually distinct from presets: ${JSON.stringify(customColorState)}`
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
    const rectangleMove = { x: 40, y: 36 };
    const rectangleEdge = { x: left + 65, y: top };
    const originalEdgeRegion = {
      x: left + 20,
      y: top - 5,
      width: 90,
      height: 10,
    };
    const movedEdgeRegion = {
      ...originalEdgeRegion,
      x: originalEdgeRegion.x + rectangleMove.x,
      y: originalEdgeRegion.y + rectangleMove.y,
    };
    const originalEdgeBeforeMove = await countRegionPixels(window, originalEdgeRegion);
    const movedEdgeBeforeMove = await countRegionPixels(window, movedEdgeRegion);
    window.webContents.sendInputEvent({ type: 'mouseMove', ...rectangleEdge });
    await nextFrame(window);
    const directMoveCursor = await window.webContents.executeJavaScript(
      `getComputedStyle(document.querySelector('.annotation-canvas')).cursor`
    );
    if (directMoveCursor !== 'move') {
      throw new Error(
        `Drawing tool did not expose the direct-move cursor: ${directMoveCursor}`
      );
    }
    sendDrag(window, rectangleEdge, {
      x: rectangleEdge.x + rectangleMove.x,
      y: rectangleEdge.y + rectangleMove.y,
    });
    await nextFrame(window);
    const originalEdgeAfterMove = await countRegionPixels(window, originalEdgeRegion);
    const movedEdgeAfterMove = await countRegionPixels(window, movedEdgeRegion);
    const directMoveState = await window.webContents.executeJavaScript(`
      (() => {
        const surface = document.querySelector('.capture-surface');
        return {
          tool: surface?.dataset.tool,
          selectedType: surface?.dataset.selectedType ?? null,
        };
      })()
    `);
    if (
      originalEdgeAfterMove >= originalEdgeBeforeMove ||
      movedEdgeAfterMove <= movedEdgeBeforeMove ||
      directMoveState.tool !== 'rectangle' ||
      directMoveState.selectedType !== null
    ) {
      throw new Error(
        `Rectangle direct move was invalid: ${JSON.stringify({ originalEdgeBeforeMove, originalEdgeAfterMove, movedEdgeBeforeMove, movedEdgeAfterMove, directMoveState })}`
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
    const originalEdgeAfterUndo = await countRegionPixels(window, originalEdgeRegion);
    if (originalEdgeAfterUndo < originalEdgeBeforeMove) {
      throw new Error(
        `Undo did not restore the directly moved rectangle (${originalEdgeAfterMove} -> ${originalEdgeAfterUndo}).`
      );
    }
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
        const mosaicOptions = document.querySelector('.mosaic-options');
        const colorPalette = document.querySelector('.color-palette');
        const strength = document.querySelector('.mosaic-strength-input');
        const preset = document.querySelector('.preset-panel');
        const mosaicButton = document.querySelector('button[data-tool="mosaic"]');
        const presetBounds = preset?.getBoundingClientRect();
        const buttonBounds = mosaicButton?.getBoundingClientRect();
        const arrowStyle = preset ? getComputedStyle(preset, '::before') : null;
        const arrowX = preset
          ? parseFloat(getComputedStyle(preset).getPropertyValue('--preset-arrow-x'))
          : null;
        return {
          mosaicDisplay: mosaicOptions ? getComputedStyle(mosaicOptions).display : null,
          colorDisplay: colorPalette ? getComputedStyle(colorPalette).display : null,
          strengthMaximum: strength?.max,
          arrowDistance:
            presetBounds && buttonBounds && Number.isFinite(arrowX)
              ? Math.abs(
                  arrowX -
                    (buttonBounds.left + buttonBounds.width / 2 - presetBounds.left)
                )
              : null,
          arrowContent: arrowStyle?.content,
        };
      })()
    `);
    if (
      mosaicSettings.mosaicDisplay !== 'flex' ||
      mosaicSettings.colorDisplay !== 'none' ||
      mosaicSettings.strengthMaximum !== '32' ||
      typeof mosaicSettings.arrowDistance !== 'number' ||
      mosaicSettings.arrowDistance > 3 ||
      mosaicSettings.arrowContent === 'none'
    ) {
      throw new Error(
        `Mosaic preset controls were invalid: ${JSON.stringify(mosaicSettings)}`
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
    const textPresetState = await window.webContents.executeJavaScript(`
      (() => {
        const buttons = Array.from(document.querySelectorAll('[data-text-style]'));
        document.querySelector('[data-text-style="fill"]')?.click();
        return buttons.map((button) => button.dataset.textStyle);
      })()
    `);
    if (
      JSON.stringify(textPresetState) !== JSON.stringify(['default', 'fill', 'shadow'])
    ) {
      throw new Error(
        `Text style presets were invalid: ${JSON.stringify(textPresetState)}`
      );
    }
    sendClick(window, textPoint);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const fillEditorStyle = await window.webContents.executeJavaScript(`
      (() => {
        const editor = document.querySelector('.text-editor');
        const selection = document.querySelector('.selection');
        const style = editor ? getComputedStyle(editor) : null;
        const selectionStyle = selection ? getComputedStyle(selection) : null;
        return {
          visible: Boolean(editor && !editor.hidden),
          backgroundColor: style?.backgroundColor,
          color: style?.color,
          borderColor: style?.borderTopColor,
          selectionBorderColor: selectionStyle?.borderTopColor,
        };
      })()
    `);
    if (
      !fillEditorStyle.visible ||
      fillEditorStyle.backgroundColor !== 'rgb(255, 59, 48)' ||
      fillEditorStyle.color !== 'rgb(255, 255, 255)' ||
      fillEditorStyle.borderColor !== fillEditorStyle.selectionBorderColor
    ) {
      throw new Error(
        `Text fill preset was not previewed: ${JSON.stringify(fillEditorStyle)}`
      );
    }
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await nextFrame(window);
    await window.webContents.executeJavaScript(
      `document.querySelector('[data-text-style="default"]')?.click()`
    );
    const edgeTextPoint = { x: selectionEnd.x - 6, y: selectionEnd.y - 6 };
    sendClick(window, edgeTextPoint);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await window.webContents.insertText('Boundary text '.repeat(35));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const boundedEditor = await window.webContents.executeJavaScript(`
      (() => {
        const editor = document.querySelector('.text-editor');
        const selection = document.querySelector('.selection');
        const editorBounds = editor?.getBoundingClientRect();
        const selectionBounds = selection?.getBoundingClientRect();
        return {
          visible: Boolean(editor && !editor.hidden),
          left: editorBounds?.left,
          top: editorBounds?.top,
          right: editorBounds?.right,
          bottom: editorBounds?.bottom,
          selectionLeft: selectionBounds?.left,
          selectionTop: selectionBounds?.top,
          selectionRight: selectionBounds?.right,
          selectionBottom: selectionBounds?.bottom,
        };
      })()
    `);
    if (
      !boundedEditor.visible ||
      boundedEditor.left < boundedEditor.selectionLeft - 1 ||
      boundedEditor.top < boundedEditor.selectionTop - 1 ||
      boundedEditor.right > boundedEditor.selectionRight + 1 ||
      boundedEditor.bottom > boundedEditor.selectionBottom + 1
    ) {
      throw new Error(
        `Text editor exceeded the screenshot selection: ${JSON.stringify(boundedEditor)}`
      );
    }
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await nextFrame(window);
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
    const emptyEditorWidth = await window.webContents.executeJavaScript(
      `document.querySelector('.text-editor')?.getBoundingClientRect().width ?? 0`
    );
    if (emptyEditorWidth <= 0 || emptyEditorWidth > 64) {
      throw new Error(`Empty text editor was not compact: ${emptyEditorWidth}`);
    }
    await window.webContents.insertText(
      'Snapora\nTools\nNo scrollbar\nLine 4\nLine 5\nLine 6\nLine 7'
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    const editorOverflow = await window.webContents.executeJavaScript(`
      (() => {
        const editor = document.querySelector('.text-editor');
        const selection = document.querySelector('.selection');
        if (!editor) return null;
        const style = getComputedStyle(editor);
        const selectionStyle = selection ? getComputedStyle(selection) : null;
        return {
          overflowY: style.overflowY,
          clientWidth: editor.clientWidth,
          clientHeight: editor.clientHeight,
          scrollHeight: editor.scrollHeight,
          backgroundColor: style.backgroundColor,
          borderTopColor: style.borderTopColor,
          selectionBorderColor: selectionStyle?.borderTopColor,
          borderTopWidth: style.borderTopWidth,
          boxShadow: style.boxShadow,
        };
      })()
    `);
    if (
      !editorOverflow ||
      editorOverflow.overflowY !== 'hidden' ||
      editorOverflow.clientWidth <= emptyEditorWidth ||
      editorOverflow.clientHeight < editorOverflow.scrollHeight
    ) {
      throw new Error(
        `Text editor did not expand without scrolling: ${JSON.stringify(editorOverflow)}`
      );
    }
    if (
      editorOverflow.backgroundColor !== 'rgba(0, 0, 0, 0)' ||
      editorOverflow.borderTopColor !== editorOverflow.selectionBorderColor ||
      editorOverflow.borderTopWidth === '0px' ||
      editorOverflow.boxShadow !== 'none'
    ) {
      throw new Error(
        `Text editor did not share the screenshot selection border: ${JSON.stringify(editorOverflow)}`
      );
    }
    const editingTextBounds = await getRedPixelBounds(window, textRegion);
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
    const committedTextBounds = await getRedPixelBounds(window, textRegion);
    if (
      !editingTextBounds ||
      !committedTextBounds ||
      Math.abs(editingTextBounds.left - committedTextBounds.left) > 1 ||
      Math.abs(editingTextBounds.top - committedTextBounds.top) > 1
    ) {
      throw new Error(
        `Text moved after commit: ${JSON.stringify({ editingTextBounds, committedTextBounds })}`
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

    await activateTool(window, 'watermark');
    const watermarkRegion = {
      x: selectionStart.x,
      y: selectionStart.y,
      width: selectionEnd.x - selectionStart.x,
      height: selectionEnd.y - selectionStart.y,
    };
    const beforeWatermark = await countRegionPixels(window, watermarkRegion);
    const watermarkSettings = await window.webContents.executeJavaScript(`
      (() => {
        const input = document.querySelector('.watermark-text-input');
        const opacity = document.querySelector('.watermark-opacity-input');
        const output = document.querySelector('.watermark-opacity-output');
        const palette = document.querySelector('.color-palette');
        const customColor = document.querySelector('.color-control');
        const inputStyle = getComputedStyle(input);
        input.value = 'Snapora';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        opacity.value = '42';
        opacity.dispatchEvent(new Event('input', { bubbles: true }));
        return {
          maxLength: input.maxLength,
          opacity: output.value,
          customColorIsLast: palette.lastElementChild === customColor,
          borderWidth: inputStyle.borderTopWidth,
          outlineStyle: inputStyle.outlineStyle,
        };
      })()
    `);
    await nextFrame(window);
    const afterWatermark = await countRegionPixels(window, watermarkRegion);
    if (
      watermarkSettings.maxLength !== 16 ||
      watermarkSettings.opacity !== '42%' ||
      !watermarkSettings.customColorIsLast ||
      parseFloat(watermarkSettings.borderWidth) <= 0 ||
      parseFloat(watermarkSettings.borderWidth) > 1 ||
      watermarkSettings.outlineStyle !== 'none' ||
      afterWatermark <= beforeWatermark
    ) {
      throw new Error(
        `Watermark preset or rendering was invalid: ${JSON.stringify({ watermarkSettings, beforeWatermark, afterWatermark })}`
      );
    }
    await activateTool(window, 'select');
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
  });
});

app.whenReady().then(async () => {
  const diagnostics = [];
  const manager = new ScreenshotManager({
    onDiagnostic: (event) => diagnostics.push(event),
    getWindowSnapRegions: () =>
      screen.getAllDisplays().map((display) => ({
        x: display.bounds.x + Math.round(display.bounds.width * 0.15),
        y: display.bounds.y + Math.round(display.bounds.height * 0.15),
        width: Math.round(display.bounds.width * 0.7),
        height: Math.round(display.bounds.height * 0.7),
      })),
  });
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

  if (!(await waitForClipboardImage())) {
    console.error('Electron Snapora confirmation did not copy an image.');
    process.exit(1);
    return;
  }

  const overlayCreateStarted = diagnostics.find(
    (event) => event.stage === 'overlay-create' && event.phase === 'start'
  );
  const captureCompleted = diagnostics.find(
    (event) => event.stage === 'capture' && event.phase === 'complete'
  );
  if (
    !overlayCreateStarted ||
    !captureCompleted ||
    overlayCreateStarted.timestamp > captureCompleted.timestamp
  ) {
    console.error(
      'Electron Snapora did not overlap hidden Overlay loading with capture.',
      { overlayCreateStarted, captureCompleted }
    );
    process.exit(1);
    return;
  }

  const sessionStarted = diagnostics.find(
    (event) => event.stage === 'session' && event.phase === 'start'
  );
  const overlayPrepared = diagnostics.find(
    (event) => event.stage === 'overlay-prepare' && event.phase === 'complete'
  );
  const startupDurationMs =
    sessionStarted && overlayPrepared
      ? overlayPrepared.timestamp - sessionStarted.timestamp
      : undefined;
  const overlappedCaptureMs =
    captureCompleted.timestamp - overlayCreateStarted.timestamp;

  console.log(
    `Electron Snapora tools smoke test passed (${result.data.byteLength} bytes, ready in ${startupDurationMs ?? 'unknown'}ms, hidden Overlay overlapped capture by ${overlappedCaptureMs}ms).`
  );
  process.exit(0);
});
