const captureButton = document.querySelector('.capture-button');
const resultOutput = document.querySelector('.result');

if (
  !(captureButton instanceof HTMLButtonElement) ||
  !(resultOutput instanceof HTMLElement)
) {
  throw new Error('Electron Snapora demo elements are missing.');
}

const screenshotApi = window.electronSnapora;
const snapSelect = document.getElementById('snap-granularity');
const snapDescription = document.getElementById('snap-description');
const snapApi = window.demoSnapApi;
let selectedGranularity = 'panel';
let snapSupported = false;
const interactionSelect = document.getElementById('interaction-mode');
let interactionMode = 'frozen';
let interactionSupported = false;
let interactionReady = !window.demoInteractionApi;
let busy = false;

// Keep capability checks independent, and never unlock controls during a pending action.
function updateCaptureControls() {
  captureButton.disabled = busy || !screenshotApi || !interactionReady;
  if (interactionSelect) interactionSelect.disabled = busy || !interactionSupported;
  if (snapSelect) snapSelect.disabled = busy || !snapSupported;
}
updateCaptureControls();
if (interactionSelect && window.demoInteractionApi) {
  void window.demoInteractionApi
    .get()
    .then(({ supported, mode }) => {
      interactionMode = mode;
      interactionSupported = supported;
      interactionReady = true;
      interactionSelect.value = mode;
    })
    .catch((error) => {
      resultOutput.textContent = `读取截图交互设置失败，请重启 demo：${String(error)}`;
    })
    .finally(updateCaptureControls);
  interactionSelect.addEventListener('change', async () => {
    if (busy) return;
    busy = true;
    updateCaptureControls();
    try {
      interactionMode = await window.demoInteractionApi.set(interactionSelect.value);
    } catch (error) {
      resultOutput.textContent = String(error);
    } finally {
      interactionSelect.value = interactionMode;
      busy = false;
      updateCaptureControls();
    }
  });
}
const snapDescriptions = {
  window: '仅识别整个应用窗口，不探测内部控件。',
  panel: '只吸附完整主内容区和侧栏，不再细分消息卡片或内部子区域。',
  fine: '保留更细的可访问性容器，便于选择卡片和列表项。',
};

if (snapApi && snapSelect && snapDescription) {
  void snapApi
    .get()
    .then(({ supported, granularity }) => {
      snapSupported = supported;
      selectedGranularity = granularity;
      snapSelect.value = granularity;
      snapDescription.textContent = supported
        ? `${snapDescriptions[granularity]} 按钮和全局快捷键均从下一次截图生效。`
        : '容器吸附需要 Windows 或 macOS 14+。';
    })
    .catch((error) => {
      snapDescription.textContent = String(error);
    })
    .finally(updateCaptureControls);
  snapSelect.addEventListener('change', async () => {
    if (busy) return;
    busy = true;
    updateCaptureControls();
    try {
      selectedGranularity = await snapApi.set(snapSelect.value);
      snapDescription.textContent = `${snapDescriptions[selectedGranularity]} 下一次截图生效。`;
    } catch (error) {
      snapDescription.textContent =
        error instanceof Error ? error.message : String(error);
    } finally {
      snapSelect.value = selectedGranularity;
      busy = false;
      updateCaptureControls();
    }
  });
}
if (!screenshotApi) {
  captureButton.disabled = true;
  resultOutput.textContent =
    'Screenshot API is unavailable. Build the bundled demo preload before starting Electron.';
} else {
  captureButton.addEventListener('click', async () => {
    if (busy || !interactionReady) return;
    busy = true;
    updateCaptureControls();
    resultOutput.textContent =
      'Capturing… 截图期间设置暂时锁定，按 Esc 取消截图后可继续切换。';

    try {
      if (window.demoInteractionApi)
        interactionMode = (await window.demoInteractionApi.get()).mode;
      const result = await screenshotApi.capture({
        display: interactionMode === 'live' ? 'all' : 'cursor',
        interactionMode,
        showCopyFeedback: true,
      });
      const summary =
        result.status === 'completed'
          ? { ...result, data: `${result.data.byteLength} PNG bytes` }
          : result;
      resultOutput.textContent = JSON.stringify(summary, null, 2);
    } catch (error) {
      resultOutput.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      busy = false;
      updateCaptureControls();
    }
  });
}

// Bind the shortcut display and editing controls.
const viewMode = document.getElementById('shortcut-view-mode');
const editMode = document.getElementById('shortcut-edit-mode');
const displayBadge = document.getElementById('shortcut-display-badge');
const recordBadge = document.getElementById('shortcut-record-badge');
const editBtn = document.getElementById('shortcut-edit-btn');
const saveBtn = document.getElementById('shortcut-save-btn');
const cancelBtn = document.getElementById('shortcut-cancel-btn');
const statusHint = document.getElementById('shortcut-status-hint');

const shortcutApi = window.demoShortcutApi;
const isMac = navigator.platform.toUpperCase().includes('MAC');

// Permission status comes from the actual native helper; host status alone is insufficient.
const permissionPanel = document.getElementById('mac-permissions');
if (isMac && permissionPanel && window.demoMacPermissions) {
  permissionPanel.hidden = false;
  const status = document.getElementById('mac-permission-status');
  const request = document.getElementById('mac-permission-request');
  const refresh = document.getElementById('mac-permission-refresh');
  const check = async (prompt) => {
    request.disabled = true;
    refresh.disabled = true;
    try {
      const permissions = await (prompt
        ? window.demoMacPermissions.request()
        : window.demoMacPermissions.get());
      status.textContent = permissions.supported
        ? `屏幕录制：${permissions.screenRecording ? '已授权' : '未授权'}；辅助功能：${permissions.accessibility ? '已授权' : '未授权（仅窗口吸附）'}。授权后可刷新状态，必要时重启 demo。`
        : '实时选择与容器吸附需要 macOS 14+。';
    } catch (error) {
      status.textContent = String(error);
    } finally {
      request.disabled = false;
      refresh.disabled = false;
    }
  };
  request.addEventListener('click', () => {
    void check(true);
  });
  refresh.addEventListener('click', () => {
    void check(false);
  });
  void check(false);
}

/**
 * Map physical key codes to Electron accelerator names.
 * Use physical codes to avoid Option-modified characters on macOS.
 */
const CODE_TO_ACCELERATOR_KEY = {
  // Map letter keys.
  KeyA: 'A',
  KeyB: 'B',
  KeyC: 'C',
  KeyD: 'D',
  KeyE: 'E',
  KeyF: 'F',
  KeyG: 'G',
  KeyH: 'H',
  KeyI: 'I',
  KeyJ: 'J',
  KeyK: 'K',
  KeyL: 'L',
  KeyM: 'M',
  KeyN: 'N',
  KeyO: 'O',
  KeyP: 'P',
  KeyQ: 'Q',
  KeyR: 'R',
  KeyS: 'S',
  KeyT: 'T',
  KeyU: 'U',
  KeyV: 'V',
  KeyW: 'W',
  KeyX: 'X',
  KeyY: 'Y',
  KeyZ: 'Z',

  // Map number-row keys.
  Digit0: '0',
  Digit1: '1',
  Digit2: '2',
  Digit3: '3',
  Digit4: '4',
  Digit5: '5',
  Digit6: '6',
  Digit7: '7',
  Digit8: '8',
  Digit9: '9',

  // Map numeric keypad keys.
  Numpad0: 'num0',
  Numpad1: 'num1',
  Numpad2: 'num2',
  Numpad3: 'num3',
  Numpad4: 'num4',
  Numpad5: 'num5',
  Numpad6: 'num6',
  Numpad7: 'num7',
  Numpad8: 'num8',
  Numpad9: 'num9',
  NumpadAdd: 'numadd',
  NumpadSubtract: 'numsub',
  NumpadMultiply: 'nummult',
  NumpadDivide: 'numdiv',
  NumpadDecimal: 'numdec',

  // Map function keys.
  F1: 'F1',
  F2: 'F2',
  F3: 'F3',
  F4: 'F4',
  F5: 'F5',
  F6: 'F6',
  F7: 'F7',
  F8: 'F8',
  F9: 'F9',
  F10: 'F10',
  F11: 'F11',
  F12: 'F12',
  F13: 'F13',
  F14: 'F14',
  F15: 'F15',
  F16: 'F16',
  F17: 'F17',
  F18: 'F18',
  F19: 'F19',
  F20: 'F20',
  F21: 'F21',
  F22: 'F22',
  F23: 'F23',
  F24: 'F24',

  // Map control keys.
  Space: 'Space',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Enter: 'Return',
  NumpadEnter: 'Return',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',

  // Map punctuation keys.
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
};

/**
 * Format an Electron accelerator for display.
 */
function formatAcceleratorForDisplay(accelerator) {
  if (!accelerator) {
    return '未设置';
  }
  return accelerator
    .split('+')
    .map((part) => {
      const p = part.trim();
      if (p === 'CommandOrControl' || p === 'CmdOrCtrl') {
        return isMac ? '⌘ Cmd' : 'Ctrl';
      }
      if (p === 'Control') return 'Ctrl';
      if (p === 'Command') return isMac ? '⌘ Cmd' : 'Cmd';
      if (p === 'Alt') return isMac ? '⌥ Option' : 'Alt';
      if (p === 'Shift') return 'Shift';
      return p;
    })
    .join(' + ');
}

if (
  shortcutApi &&
  viewMode &&
  editMode &&
  displayBadge &&
  recordBadge &&
  editBtn &&
  saveBtn &&
  cancelBtn &&
  statusHint
) {
  // Track the currently registered shortcut.
  let currentAccelerator = 'CommandOrControl+Shift+A';
  // Track the shortcut being recorded.
  let tempAccelerator = currentAccelerator;
  // Track whether a non-modifier key has been recorded.
  let hasCompleteKey = true;

  // Fetch the registered shortcut and update the display badge.
  void shortcutApi.getShortcut().then((shortcut) => {
    if (shortcut) {
      currentAccelerator = shortcut;
    }
    displayBadge.textContent = formatAcceleratorForDisplay(currentAccelerator);
  });

  /**
   * Show the recorder and start listening for shortcut keys.
   */
  function enterEditMode() {
    tempAccelerator = currentAccelerator;
    hasCompleteKey = true;
    recordBadge.textContent = formatAcceleratorForDisplay(currentAccelerator);

    viewMode.classList.add('hidden');
    editMode.classList.remove('hidden');
    statusHint.classList.add('hidden');

    recordBadge.focus();
    window.addEventListener('keydown', handleRecordKeyDown, true);
  }

  /**
   * Stop recording and restore the shortcut display.
   */
  function exitEditMode() {
    window.removeEventListener('keydown', handleRecordKeyDown, true);

    editMode.classList.add('hidden');
    viewMode.classList.remove('hidden');

    displayBadge.textContent = formatAcceleratorForDisplay(currentAccelerator);
  }

  /**
   * Record the shortcut key combination.
   */
  function handleRecordKeyDown(event) {
    event.preventDefault();
    event.stopPropagation();

    // Cancel editing when Escape is pressed without modifiers.
    if (
      event.key === 'Escape' &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.shiftKey
    ) {
      exitEditMode();
      return;
    }

    // Save when Enter is pressed without modifiers.
    if (
      event.key === 'Enter' &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.shiftKey
    ) {
      void handleSave();
      return;
    }

    const modifiers = [];
    const displayModifiers = [];

    if (event.ctrlKey) {
      modifiers.push(isMac ? 'Control' : 'CommandOrControl');
      displayModifiers.push(isMac ? '⌃ Control' : 'Ctrl');
    }
    if (event.metaKey) {
      modifiers.push('Command');
      displayModifiers.push('⌘ Cmd');
    }
    if (event.altKey) {
      modifiers.push('Alt');
      displayModifiers.push(isMac ? '⌥ Option' : 'Alt');
    }
    if (event.shiftKey) {
      modifiers.push('Shift');
      displayModifiers.push('Shift');
    }

    // Preview modifier keys until a non-modifier key is pressed.
    if (
      ['Control', 'Shift', 'Alt', 'Meta'].includes(event.key) ||
      [
        'ControlLeft',
        'ControlRight',
        'ShiftLeft',
        'ShiftRight',
        'AltLeft',
        'AltRight',
        'MetaLeft',
        'MetaRight',
      ].includes(event.code)
    ) {
      hasCompleteKey = false;
      recordBadge.textContent = displayModifiers.join(' + ');
      return;
    }

    // Resolve the physical key code before falling back to the key value.
    let keyName = CODE_TO_ACCELERATOR_KEY[event.code];
    if (!keyName) {
      if (event.key === ' ') {
        keyName = 'Space';
      } else if (event.key === '+') {
        keyName = 'Plus';
      } else if (event.key.length === 1 && /^[\x20-\x7E]$/.test(event.key)) {
        keyName = event.key.toUpperCase();
      } else {
        keyName = event.key;
      }
    }

    const combination = [...modifiers, keyName].join('+');
    const displayCombination = [...displayModifiers, keyName].join(' + ');

    tempAccelerator = combination;
    hasCompleteKey = true;
    recordBadge.textContent = displayCombination;
  }

  /**
   * Submit the recorded shortcut to the main process.
   */
  async function handleSave() {
    if (!hasCompleteKey || !tempAccelerator) {
      statusHint.textContent = '请按下完整的快捷键组合（例如 Ctrl+Shift+A 或 Alt+A）';
      statusHint.classList.remove('hidden');
      return;
    }

    saveBtn.disabled = true;
    try {
      const res = await shortcutApi.setShortcut(tempAccelerator);
      // Update the displayed shortcut from the registration response.
      currentAccelerator = res.shortcut || tempAccelerator;
      displayBadge.textContent = formatAcceleratorForDisplay(currentAccelerator);

      if (res.success) {
        statusHint.classList.add('hidden');
        resultOutput.textContent = `[快捷键已生效] 当前已注册全局快捷键: ${currentAccelerator}\n可在任意第三方应用或后台窗口下按下进行截图测试。`;
      } else {
        // Display the registration error alongside the selected shortcut.
        statusHint.textContent = res.error || '快捷键已被占用或注册失败';
        statusHint.classList.remove('hidden');
        resultOutput.textContent = `[快捷键注册失败]\n${res.error}`;
      }
    } catch (err) {
      currentAccelerator = tempAccelerator;
      displayBadge.textContent = formatAcceleratorForDisplay(currentAccelerator);
      statusHint.textContent = err instanceof Error ? err.message : String(err);
      statusHint.classList.remove('hidden');
    } finally {
      saveBtn.disabled = false;
      exitEditMode();
    }
  }

  // Start recording when the edit button is clicked.
  editBtn.addEventListener('click', () => {
    enterEditMode();
  });

  // Save the shortcut when the save button is clicked.
  saveBtn.addEventListener('click', () => {
    void handleSave();
  });

  // Cancel recording and restore the display when cancel is clicked.
  cancelBtn.addEventListener('click', () => {
    exitEditMode();
  });
}
