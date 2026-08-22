const { app, BrowserWindow, clipboard, nativeImage } = require('electron');
const {
  ElectronOutputAdapter,
  SCREENSHOT_PROTOCOL_VERSION,
} = require('electron-snapora/main');
const menuOnly = process.argv.includes('--menu-only');

const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XjN3WQAAAABJRU5ErkJggg==';

async function run() {
  const adapter = new ElectronOutputAdapter();
  const png = nativeImage
    .createFromDataURL(PIXEL)
    .resize({ width: 320, height: 180 })
    .toPNG();
  const createResult = (x) => ({
    status: 'completed',
    data: Uint8Array.from(png),
    mimeType: 'image/png',
    bounds: { x, y: 80, width: 320, height: 180 },
    displayId: 'smoke',
  });

  const pin = (result, captureOptions) =>
    adapter.execute(
      {
        protocolVersion: SCREENSHOT_PROTOCOL_VERSION,
        jobId: 'pin-smoke',
        action: 'pin',
        result,
      },
      { senderWebContentsId: 0, captureOptions }
    );
  await pin(createResult(80), { locale: 'zh-CN' });
  await pin(createResult(440), { locale: 'en-US' });

  const windows = BrowserWindow.getAllWindows().sort(
    (left, right) => left.getBounds().x - right.getBounds().x
  );
  const first = windows[0];
  if (!first || windows.length !== 2) {
    throw new Error('Pinned BrowserWindows were not created.');
  }
  const initialBounds = first.getBounds();
  const second = windows[1];
  const view = await first.webContents.executeJavaScript(`({
    image: document.querySelector('.pinned-image')?.src.startsWith('blob:'),
    closeRadius: getComputedStyle(document.querySelector('.pinned-close')).borderRadius,
    api:
      typeof window.snaporaPinned?.startDrag === 'function' &&
      typeof window.snaporaPinned?.copy === 'function' &&
      typeof window.snaporaPinned?.onCopied === 'function' &&
      typeof window.snaporaPinned?.save === 'function'
  })`);
  if (!view.image || view.closeRadius !== '50%' || !view.api) {
    throw new Error(`Pinned renderer is incomplete: ${JSON.stringify(view)}`);
  }
  const closeVisibility = await first.webContents.executeJavaScript(`
    (async () => {
      const surface = document.querySelector('.pinned-surface');
      const close = document.querySelector('.pinned-close');
      surface.dispatchEvent(new PointerEvent('pointerleave'));
      await Promise.all(
        document.getAnimations().map((animation) =>
          animation.finished.catch(() => undefined)
        )
      );
      const hiddenStyle = getComputedStyle(close);
      const hidden = {
        opacity: hiddenStyle.opacity,
        pointerEvents: hiddenStyle.pointerEvents,
      };
      surface.dispatchEvent(new PointerEvent('pointerenter'));
      await Promise.all(
        document.getAnimations().map((animation) =>
          animation.finished.catch(() => undefined)
        )
      );
      const visibleStyle = getComputedStyle(close);
      return {
        hidden,
        visible: {
          opacity: visibleStyle.opacity,
          pointerEvents: visibleStyle.pointerEvents,
        },
      };
    })()
  `);
  if (
    closeVisibility.hidden.opacity !== '0' ||
    closeVisibility.hidden.pointerEvents !== 'none' ||
    Number(closeVisibility.visible.opacity) <= 0 ||
    closeVisibility.visible.pointerEvents !== 'auto'
  ) {
    throw new Error(
      `Pinned close hover state was invalid: ${JSON.stringify(closeVisibility)}`
    );
  }
  const englishLabels = await second.webContents.executeJavaScript(
    `Array.from(document.querySelectorAll('.pinned-menu-item')).map((item) => item.textContent.trim())`
  );
  if (JSON.stringify(englishLabels) !== JSON.stringify(['Copy', 'Save', 'Close'])) {
    throw new Error(
      `Pinned English labels were invalid: ${JSON.stringify(englishLabels)}`
    );
  }

  first.webContents.sendInputEvent({
    type: 'mouseDown',
    x: 20,
    y: 20,
    button: 'right',
    clickCount: 1,
  });
  first.webContents.sendInputEvent({
    type: 'mouseUp',
    x: 20,
    y: 20,
    button: 'right',
    clickCount: 1,
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  first.webContents.sendInputEvent({ type: 'mouseMove', x: 0, y: 0 });
  const menuState = await first.webContents.executeJavaScript(`(() => {
    const menu = document.querySelector('.pinned-context-menu');
    const items = Array.from(document.querySelectorAll('.pinned-menu-item'));
    const icons = Array.from(document.querySelectorAll('.pinned-menu-icon'));
    const menuBounds = menu?.getBoundingClientRect();
    const firstIconBounds = icons[0]?.getBoundingClientRect();
    const menuStyle = menu ? getComputedStyle(menu) : null;
    return {
      visible: Boolean(menu && !menu.hidden),
      width: menuBounds?.width,
      minWidth: menuStyle?.minWidth,
      paddingLeft: menuStyle?.paddingLeft,
      rowGap: menuStyle?.rowGap,
      outlineStyle: menuStyle?.outlineStyle,
      focusedItem: items.includes(document.activeElement),
      labels: items.map((item) => item.textContent.trim()),
      itemWidths: items.map((item) => item.getBoundingClientRect().width),
      iconSizes: icons.map((icon) => icon.getBoundingClientRect().width),
      iconColors: icons.map((icon) => getComputedStyle(icon).stroke),
      iconStrokeWidths: icons.map((icon) => getComputedStyle(icon).strokeWidth),
      iconEdgeInset:
        menuBounds && firstIconBounds ? firstIconBounds.left - menuBounds.left : null,
    };
  })()`);
  if (
    !menuState.visible ||
    menuState.width !== 144 ||
    menuState.minWidth !== '144px' ||
    menuState.paddingLeft !== '8px' ||
    menuState.rowGap !== '4px' ||
    menuState.outlineStyle !== 'none' ||
    menuState.focusedItem ||
    JSON.stringify(menuState.labels) !== JSON.stringify(['复制', '保存', '关闭']) ||
    menuState.itemWidths.some((width) => width < 126 || width > 127) ||
    menuState.iconSizes.some((size) => size !== 16) ||
    new Set(menuState.iconColors).size !== 1 ||
    menuState.iconStrokeWidths.some((width) => width !== '1.8px') ||
    menuState.iconEdgeInset < 16 ||
    menuState.iconEdgeInset > 17.5
  ) {
    throw new Error(
      `Pinned context menu layout was invalid: ${JSON.stringify(menuState)}`
    );
  }
  if (menuOnly) {
    for (const window of BrowserWindow.getAllWindows()) {
      window.destroy();
    }
    console.log('Electron Snapora pinned context-menu smoke passed.');
    return;
  }
  await first.webContents.executeJavaScript(
    `document.querySelector('.pinned-copy').click()`
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  const copyFeedback = await first.webContents.executeJavaScript(`(() => {
    const feedback = document.querySelector('.pinned-copy-feedback');
    const icon = document.querySelector('.pinned-copy-feedback-icon');
    return {
      visible: Boolean(feedback && !feedback.hidden),
      text: document.querySelector('.pinned-copy-feedback-label')?.textContent,
      menuHidden: document.querySelector('.pinned-context-menu')?.hidden,
      iconStroke: icon ? getComputedStyle(icon).stroke : null,
    };
  })()`);
  if (
    !copyFeedback.visible ||
    copyFeedback.text !== '已复制到剪贴板' ||
    !copyFeedback.menuHidden ||
    copyFeedback.iconStroke !== 'rgb(52, 199, 89)' ||
    clipboard.readImage().isEmpty()
  ) {
    throw new Error(
      `Pinned copy feedback was invalid: ${JSON.stringify(copyFeedback)}`
    );
  }

  await first.webContents.executeJavaScript(`
    window.snaporaPinned.startDrag({ x: 100, y: 100 });
    for (let index = 1; index <= 40; index += 1) {
      window.snaporaPinned.moveDrag({ x: 100 + index, y: 100 + index });
    }
    window.snaporaPinned.endDrag();
  `);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const moved = first.getBounds();
  if (
    moved.x !== initialBounds.x + 40 ||
    moved.y !== initialBounds.y + 40 ||
    moved.width !== initialBounds.width ||
    moved.height !== initialBounds.height
  ) {
    throw new Error(
      `Pinned window long drag changed its size: ${JSON.stringify({ initialBounds, moved })}`
    );
  }

  for (const window of BrowserWindow.getAllWindows()) {
    window.destroy();
  }
  if (BrowserWindow.getAllWindows().length !== 0) {
    throw new Error('Pinned windows were not cleaned up.');
  }
  console.log('Electron Snapora pinned-window smoke passed.');
}

app
  .whenReady()
  .then(run)
  .then(
    () => app.quit(),
    (error) => {
      console.error(error);
      app.exit(1);
    }
  );
