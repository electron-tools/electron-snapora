const captureButton = document.querySelector('.capture-button');
const resultOutput = document.querySelector('.result');

if (
  !(captureButton instanceof HTMLButtonElement) ||
  !(resultOutput instanceof HTMLElement)
) {
  throw new Error('Electron Snapora demo elements are missing.');
}

const screenshotApi = window.electronSnapora;
if (!screenshotApi) {
  captureButton.disabled = true;
  resultOutput.textContent =
    'Screenshot API is unavailable. Build the bundled demo preload before starting Electron.';
} else {
  captureButton.addEventListener('click', async () => {
    captureButton.disabled = true;
    resultOutput.textContent = 'Capturing…';

    try {
      const result = await screenshotApi.capture({ display: 'cursor' });
      const summary =
        result.status === 'completed'
          ? { ...result, data: `${result.data.byteLength} PNG bytes` }
          : result;
      resultOutput.textContent = JSON.stringify(summary, null, 2);
    } catch (error) {
      resultOutput.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      captureButton.disabled = false;
    }
  });
}

// 快捷键设置逻辑（展示态与编辑输入态彻底解耦）
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

/**
 * 物理键码（event.code）到 Electron Accelerator 标准键名的映射表
 * 彻底避免 macOS 下按住 Option (Alt) 键导致 event.key 变成 Å、≈、∑、î 等非 ASCII 特殊符号的致命 bug
 */
const CODE_TO_ACCELERATOR_KEY = {
  // 字母键
  KeyA: 'A', KeyB: 'B', KeyC: 'C', KeyD: 'D', KeyE: 'E',
  KeyF: 'F', KeyG: 'G', KeyH: 'H', KeyI: 'I', KeyJ: 'J',
  KeyK: 'K', KeyL: 'L', KeyM: 'M', KeyN: 'N', KeyO: 'O',
  KeyP: 'P', KeyQ: 'Q', KeyR: 'R', KeyS: 'S', KeyT: 'T',
  KeyU: 'U', KeyV: 'V', KeyW: 'W', KeyX: 'X', KeyY: 'Y', KeyZ: 'Z',

  // 主键盘数字键
  Digit0: '0', Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4',
  Digit5: '5', Digit6: '6', Digit7: '7', Digit8: '8', Digit9: '9',

  // 小键盘数字键
  Numpad0: 'num0', Numpad1: 'num1', Numpad2: 'num2', Numpad3: 'num3', Numpad4: 'num4',
  Numpad5: 'num5', Numpad6: 'num6', Numpad7: 'num7', Numpad8: 'num8', Numpad9: 'num9',
  NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', NumpadDecimal: 'numdec',

  // 功能键
  F1: 'F1', F2: 'F2', F3: 'F3', F4: 'F4', F5: 'F5', F6: 'F6',
  F7: 'F7', F8: 'F8', F9: 'F9', F10: 'F10', F11: 'F11', F12: 'F12',
  F13: 'F13', F14: 'F14', F15: 'F15', F16: 'F16', F17: 'F17', F18: 'F18',
  F19: 'F19', F20: 'F20', F21: 'F21', F22: 'F22', F23: 'F23', F24: 'F24',

  // 控制键
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

  // 标点符号
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
 * 将 Electron Accelerator 格式转为展示文本（如 Ctrl + Shift + A）
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
  // 当前生效的快捷键配置
  let currentAccelerator = 'CommandOrControl+Shift+A';
  // 录制态中的临时快捷键
  let tempAccelerator = currentAccelerator;
  // 是否捕获到了完整的主键
  let hasCompleteKey = true;

  // 初始化：拉取当前已注册的快捷键并显示在展示态胶囊中
  void shortcutApi.getShortcut().then((shortcut) => {
    if (shortcut) {
      currentAccelerator = shortcut;
    }
    displayBadge.textContent = formatAcceleratorForDisplay(currentAccelerator);
  });

  /**
   * 进入输入态：隐藏展示态，显示输入态（虚线录制框 + 确认按钮 + 取消按钮）
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
   * 退出输入态：隐藏输入态，恢复展示态（胶囊 + 修改按钮）
   */
  function exitEditMode() {
    window.removeEventListener('keydown', handleRecordKeyDown, true);

    editMode.classList.add('hidden');
    viewMode.classList.remove('hidden');

    displayBadge.textContent = formatAcceleratorForDisplay(currentAccelerator);
  }

  /**
   * 录制按键
   */
  function handleRecordKeyDown(event) {
    event.preventDefault();
    event.stopPropagation();

    // 单按 Escape：取消修改退出
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

    // 单按 Enter：确认保存
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

    // 若当前仅按下了修饰键（Ctrl/Alt/Shift/Meta），在虚线框中预览修饰键
    if (
      ['Control', 'Shift', 'Alt', 'Meta'].includes(event.key) ||
      ['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].includes(event.code)
    ) {
      hasCompleteKey = false;
      recordBadge.textContent = displayModifiers.join(' + ');
      return;
    }

    // 优先从物理键码解析，彻底屏蔽 macOS 下 Option 导致 event.key 变为 Å/≈ 等特殊符号的问题
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
   * 点击确认：向主进程提交并生效
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
      // 无论注册成功还是失败，均更新并显示当前设置的快捷键
      currentAccelerator = res.shortcut || tempAccelerator;
      displayBadge.textContent = formatAcceleratorForDisplay(currentAccelerator);

      if (res.success) {
        statusHint.classList.add('hidden');
        resultOutput.textContent = `[快捷键已生效] 当前已注册全局快捷键: ${currentAccelerator}\n可在任意第三方应用或后台窗口下按下进行截图测试。`;
      } else {
        // 注册失败时展示具体原因，但界面仍显示该快捷键
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

  // 1. 点击【修改】按钮：进入输入态
  editBtn.addEventListener('click', () => {
    enterEditMode();
  });

  // 2. 点击【确认】按钮：保存并生效
  saveBtn.addEventListener('click', () => {
    void handleSave();
  });

  // 3. 点击【取消】✕ 按钮：取消并返回展示态
  cancelBtn.addEventListener('click', () => {
    exitEditMode();
  });
}

