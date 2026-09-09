const { execFile } = require('node:child_process');

// Load the ApplicationServices PSN functions from the macOS entry path.
const koffi = require('koffi');
const library = koffi.load(
  '/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices'
);
koffi.struct('DemoProcessSerialNumber', {
  highLongOfPSN: 'uint32_t',
  lowLongOfPSN: 'uint32_t',
});
const getFrontProcess = library.func(
  'int GetFrontProcess(_Out_ DemoProcessSerialNumber *psn)'
);
const getProcessPID = library.func(
  'int GetProcessPID(const DemoProcessSerialNumber *psn, _Out_ int *pid)'
);
const setFrontProcess = library.func(
  'int SetFrontProcess(const DemoProcessSerialNumber *psn)'
);

function getFrontmostProcess() {
  try {
    const psn = { highLongOfPSN: 0, lowLongOfPSN: 0 };
    if (getFrontProcess(psn) !== 0) {
      console.warn('[Demo] Could not read the frontmost process.');
      return null;
    }
    const pid = [0];
    return { psn, pid: getProcessPID(psn, pid) === 0 ? pid[0] : null };
  } catch (error) {
    console.warn('[Demo] Could not read the frontmost process:', error);
    return null;
  }
}

async function restoreFrontmostProcess(previous) {
  try {
    if (setFrontProcess(previous.psn) === 0) return true;
  } catch (error) {
    console.warn('[Demo] PSN focus restoration failed:', error);
  }
  if (
    !Number.isInteger(previous.pid) ||
    previous.pid <= 0 ||
    previous.pid === process.pid
  ) {
    console.warn('[Demo] No external process available for focus restoration.');
    return false;
  }
  // Fall back to PID activation, raise the windows, and restore minimized windows.
  const scriptLines = [
    'tell application "System Events"',
    'try',
    'set targetProcess to first process whose unix id is ' + previous.pid,
    'set frontmost of targetProcess to true',
    'try',
    'perform action "AXRaise" of every window of targetProcess',
    'end try',
    'try',
    'set collapsed of every window of targetProcess to false',
    'end try',
    'try',
    'set miniaturized of every window of targetProcess to false',
    'end try',
    'on error errMsg number errNum',
    'error errMsg number errNum',
    'end try',
    'end tell',
  ];
  return new Promise((resolve) => {
    execFile(
      'osascript',
      scriptLines.flatMap((line) => ['-e', line]),
      (error) => {
        if (error) console.warn('[Demo] PID focus restoration failed:', error);
        resolve(!error);
      }
    );
  });
}

module.exports = { getFrontmostProcess, restoreFrontmostProcess };
