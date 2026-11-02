/** 只平移气泡，箭头仍指向按钮；使用实际宽度兼容快捷键和本地化文案。 */
export function positionTooltipHorizontally(button: HTMLElement): void {
  const bounds = button.getBoundingClientRect();
  const width = Number.parseFloat(getComputedStyle(button, '::after').width);
  if (!Number.isFinite(width)) return;
  const center = bounds.left + bounds.width / 2;
  const left = Math.max(8, Math.min(center - width / 2, window.innerWidth - 8 - width));
  button.style.setProperty('--tooltip-offset-x', `${left + width / 2 - center}px`);
}
