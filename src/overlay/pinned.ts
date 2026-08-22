import './pinned.css';

function requireElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Electron Snapora pinned window element is missing: ${selector}`);
  }
  return element;
}

const surface = requireElement<HTMLElement>('.pinned-surface');
const image = requireElement<HTMLImageElement>('.pinned-image');
const closeButton = requireElement<HTMLButtonElement>('.pinned-close');
const copyFeedback = requireElement<HTMLElement>('.pinned-copy-feedback');
const copyFeedbackLabel = requireElement<HTMLElement>('.pinned-copy-feedback-label');
const contextMenu = requireElement<HTMLElement>('.pinned-context-menu');
const copyButton = requireElement<HTMLButtonElement>('.pinned-copy');
const saveButton = requireElement<HTMLButtonElement>('.pinned-save');
const menuCloseButton = requireElement<HTMLButtonElement>('.pinned-menu-close');
const copyLabel = requireElement<HTMLElement>('.pinned-copy-label');
const saveLabel = requireElement<HTMLElement>('.pinned-save-label');
const menuCloseLabel = requireElement<HTMLElement>('.pinned-menu-close-label');
const menuButtons = [copyButton, saveButton, menuCloseButton];

let imageUrl: string | undefined;
let activePointerId: number | undefined;
let copyFeedbackTimer: number | undefined;

window.snaporaPinned.onInitialize((payload) => {
  if (imageUrl) {
    URL.revokeObjectURL(imageUrl);
  }
  imageUrl = URL.createObjectURL(
    new Blob([Uint8Array.from(payload.data)], { type: payload.mimeType })
  );
  image.src = imageUrl;
  document.documentElement.lang = payload.locale;
  contextMenu.setAttribute('aria-label', payload.menuLabels.actions);
  copyLabel.textContent = payload.menuLabels.copy;
  copyFeedbackLabel.textContent = payload.menuLabels.copied;
  saveLabel.textContent = payload.menuLabels.save;
  menuCloseLabel.textContent = payload.menuLabels.close;
});

window.snaporaPinned.onCopied(showCopyFeedback);

closeButton.addEventListener('click', () => window.snaporaPinned.close());
copyButton.addEventListener('click', () => {
  hideContextMenu();
  window.snaporaPinned.copy();
});
saveButton.addEventListener('click', () => {
  hideContextMenu();
  window.snaporaPinned.save();
});
menuCloseButton.addEventListener('click', () => window.snaporaPinned.close());

/** 自定义右键菜单使用固定宽度，并始终限制在固定截图窗口内。 */
function showContextMenu(point: { x: number; y: number }): void {
  contextMenu.hidden = false;
  const edge = 8;
  const maximumLeft = Math.max(
    edge,
    window.innerWidth - contextMenu.offsetWidth - edge
  );
  const maximumTop = Math.max(
    edge,
    window.innerHeight - contextMenu.offsetHeight - edge
  );
  contextMenu.style.left = `${Math.min(Math.max(point.x, edge), maximumLeft)}px`;
  contextMenu.style.top = `${Math.min(Math.max(point.y, edge), maximumTop)}px`;
  contextMenu.focus({ preventScroll: true });
}

function hideContextMenu(): void {
  contextMenu.hidden = true;
}

/** 复制成功后在固定窗口内显示短暂反馈，不创建额外原生窗口。 */
function showCopyFeedback(): void {
  if (copyFeedbackTimer !== undefined) {
    window.clearTimeout(copyFeedbackTimer);
  }
  copyFeedback.hidden = true;
  copyFeedback.getBoundingClientRect();
  copyFeedback.hidden = false;
  copyFeedbackTimer = window.setTimeout(() => {
    copyFeedback.hidden = true;
    copyFeedbackTimer = undefined;
  }, 1_800);
}

surface.addEventListener('pointerenter', () => {
  surface.dataset.hovered = 'true';
});
surface.addEventListener('pointerleave', () => {
  delete surface.dataset.hovered;
});

surface.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  event.stopPropagation();
  showContextMenu({ x: event.clientX, y: event.clientY });
});

contextMenu.addEventListener('keydown', (event) => {
  const currentIndex = menuButtons.indexOf(document.activeElement as HTMLButtonElement);
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    const nextIndex =
      currentIndex < 0
        ? direction > 0
          ? 0
          : menuButtons.length - 1
        : (currentIndex + direction + menuButtons.length) % menuButtons.length;
    menuButtons[nextIndex]?.focus();
  } else if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault();
    menuButtons[event.key === 'Home' ? 0 : menuButtons.length - 1]?.focus();
  }
});

surface.addEventListener('pointerdown', (event) => {
  const target = event.target as Element;
  if (!contextMenu.hidden && !contextMenu.contains(target)) {
    event.preventDefault();
    hideContextMenu();
    return;
  }
  if (
    event.button !== 0 ||
    event.target === closeButton ||
    closeButton.contains(target) ||
    contextMenu.contains(target)
  ) {
    return;
  }
  activePointerId = event.pointerId;
  surface.setPointerCapture(event.pointerId);
  surface.dataset.dragging = 'true';
  window.snaporaPinned.startDrag({ x: event.screenX, y: event.screenY });
});

surface.addEventListener('pointermove', (event) => {
  if (event.pointerId === activePointerId) {
    window.snaporaPinned.moveDrag({ x: event.screenX, y: event.screenY });
  }
});

function endDrag(event: PointerEvent): void {
  if (event.pointerId !== activePointerId) {
    return;
  }
  activePointerId = undefined;
  delete surface.dataset.dragging;
  window.snaporaPinned.endDrag();
}

surface.addEventListener('pointerup', endDrag);
surface.addEventListener('pointercancel', endDrag);
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (contextMenu.hidden) {
      window.snaporaPinned.close();
    } else {
      hideContextMenu();
    }
  }
});
window.addEventListener('blur', hideContextMenu);
window.addEventListener('beforeunload', () => {
  if (copyFeedbackTimer !== undefined) {
    window.clearTimeout(copyFeedbackTimer);
  }
  if (imageUrl) {
    URL.revokeObjectURL(imageUrl);
  }
});
