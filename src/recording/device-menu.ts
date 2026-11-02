import './device-menu.css';
import type { RecordingApi } from './protocol.js';

/** Device names are text only; this popup can select/dismiss and has no recorder/file access. */
const api = (window as unknown as { snaporaRecording: RecordingApi }).snaporaRecording;
const menu = document.getElementById('devices')!;
void api.request('device-menu-init').then(async (raw) => {
  const data = raw as {
    items: Array<{ id: string; label: string }>;
    selected: string;
    label: string;
    empty: string;
    locale: string;
  };
  document.documentElement.lang = data.locale;
  menu.setAttribute('aria-label', data.label);
  for (const item of data.items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.role = 'menuitemradio';
    button.dataset.deviceId = item.id;
    button.setAttribute('aria-checked', String(item.id === data.selected));
    button.innerHTML =
      '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3 3 7-7"/></svg><span></span>';
    button.querySelector('span')!.textContent = item.label;
    button.onclick = () => {
      void api.request('device-menu-select', item.id);
    };
    menu.append(button);
  }
  if (!data.items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = data.empty;
    menu.append(empty);
  }
  await api.request('device-menu-ready');
  menu
    .querySelector<HTMLButtonElement>('[aria-checked="true"]')
    ?.focus({ preventScroll: true });
});
document.addEventListener('keydown', (event) => {
  const buttons = [...menu.querySelectorAll('button')];
  if (event.key === 'Escape' || event.key === 'Tab') {
    event.preventDefault();
    void api.request('device-menu-dismiss');
  } else if (
    ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) &&
    buttons.length
  ) {
    event.preventDefault();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) %
            buttons.length;
    buttons[next]!.focus();
  }
});
