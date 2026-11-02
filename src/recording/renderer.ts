import './styles.css';
import '../overlay/capture-toolbar.css';
import { RecordingEngine } from './engine.js';
import type { RecordingApi, RecordingInit } from './protocol.js';
import type { RecordingOptions } from '../types.js';
import { DEFAULT_MP4_SECONDS, MAX_GIF_SECONDS } from './policy.js';
import { recordingMessages } from '../i18n/recording.js';

declare global {
  interface Window {
    snaporaRecording: RecordingApi;
  }
}
const api = window.snaporaRecording;
const el = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const format = el<HTMLFieldSetElement>('format');
const selectedFormat = () =>
  document.querySelector<HTMLInputElement>('input[name="format"]:checked')!.value;
const audioButtons = [
  el<HTMLButtonElement>('system'),
  el<HTMLButtonElement>('microphone'),
];
let audioMode: NonNullable<RecordingOptions['audio']> = 'none';
let init: RecordingInit;
let engine: RecordingEngine | undefined;
let phase = 'prepare';
let cameraEnabled = false;
let cameraDeviceId = '';
let microphoneDeviceId = '';
let deviceBusy = false;
let warming = false;
let requestedRevision = 0;
let preparedRevision = -1;
let deviceKind: 'camera' | 'microphone' | undefined;
let deviceMenuRevision = 0;
let paused = false;
let heartbeat: ReturnType<typeof setInterval> | undefined;
let messages = recordingMessages();
let errorSource: 'prepare' | 'camera' | 'devices' | undefined;
/** Keep recoverable errors inside the existing start area; never append raw exceptions to the panel. */
function clearPreparationError(source = errorSource) {
  if (source !== errorSource) return;
  errorSource = undefined;
  el('prepare-error').hidden = true;
}
function preparationError(source: NonNullable<typeof errorSource>, error: unknown) {
  console.error(`[Snapora recording: ${source}] ${String(error)}`, error);
  if (phase !== 'prepare') return;
  errorSource = source;
  const detail = String(error);
  el('prepare-error-text').textContent =
    source === 'prepare'
      ? messages.preparationError
      : /NotAllowedError|Permission denied|permission.*denied/i.test(detail)
        ? messages.devicePermissionDenied
        : /NotFoundError|DevicesNotFoundError/.test(detail)
          ? messages.deviceUnavailable
          : /NotReadableError|TrackStartError/.test(detail)
            ? messages.deviceInUse
            : source === 'devices'
              ? messages.deviceListError
              : messages.deviceUnavailable;
  el('prepare-error-action').textContent =
    source === 'prepare' ? messages.retry : messages.dismiss;
  el('prepare-error').hidden = false;
}
el('prepare-error-action').onclick = () => {
  const retry = errorSource === 'prepare';
  clearPreparationError();
  if (retry) void warmEngine();
};
const status = (text: string) => {
  el('status').textContent = text;
};
const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}`;

async function fail(error: unknown) {
  if (phase === 'failed') return;
  phase = 'failed';
  clearInterval(heartbeat);
  engine?.dispose();
  status(String(error));
  await api.request('fail', String(error));
}

function updateFormat() {
  const silent = selectedFormat() === 'gif';
  for (const button of audioButtons) {
    const enabled = !silent && (audioMode === 'both' || audioMode === button.id);
    button.disabled = silent || phase !== 'prepare';
    button.setAttribute('aria-pressed', String(enabled));
    button.querySelector('.audio-state')!.textContent = silent
      ? messages.gifSilent
      : enabled
        ? messages.enabled
        : messages.disabled;
    button.title =
      button.id === 'system'
        ? messages.systemHelp
        : button.querySelector('.audio-state')!.textContent!;
  }
  el<HTMLButtonElement>('camera').disabled = deviceBusy || phase !== 'prepare';
  el<HTMLButtonElement>('camera-menu').disabled = deviceBusy || phase !== 'prepare';
  el<HTMLButtonElement>('microphone-menu').disabled =
    deviceBusy || silent || phase !== 'prepare';
  el('camera').setAttribute('aria-pressed', String(cameraEnabled));
  el<HTMLButtonElement>('start').disabled =
    deviceBusy || warming || phase !== 'prepare';
  const preparing = phase === 'prepare' && (warming || deviceBusy);
  el('start').setAttribute('aria-busy', String(preparing));
  el('start').textContent = preparing
    ? messages.preparing
    : !engine && phase === 'prepare'
      ? messages.retry
      : messages.start;
  const limit =
    selectedFormat() === 'gif'
      ? MAX_GIF_SECONDS
      : (init.options.maxMp4DurationSeconds ?? DEFAULT_MP4_SECONDS);
  el('limit').textContent = `/ ${clock(limit)}`;
  el('limit').title =
    selectedFormat() === 'gif'
      ? messages.gifLimit
      : messages.mp4Limit.replace('{duration}', clock(limit));
}

function recordingSettings(): RecordingOptions {
  return {
    format: selectedFormat() as 'mp4' | 'gif',
    audio: selectedFormat() === 'gif' ? 'none' : audioMode,
    microphoneDeviceId,
    camera: cameraEnabled,
    cameraDeviceId,
    maxMp4DurationSeconds: init.options.maxMp4DurationSeconds ?? DEFAULT_MP4_SECONDS,
  };
}

/** Resolve permission, sources and encoders while preparing; Start never opens a permission flow. */
async function warmEngine() {
  requestedRevision++;
  if (warming || phase !== 'prepare') return;
  warming = true;
  clearPreparationError('prepare');
  updateFormat();
  try {
    while (phase === 'prepare' && preparedRevision !== requestedRevision) {
      const revision = requestedRevision;
      engine?.dispose();
      engine = undefined;
      const settings = (await api.request(
        'configure',
        recordingSettings()
      )) as RecordingOptions;
      const next = new RecordingEngine(
        init,
        settings,
        async (data, offset) => {
          await api.request('write', { data, offset });
        },
        (error) => {
          void fail(error);
        }
      );
      let timeout: ReturnType<typeof setTimeout>;
      try {
        await Promise.race([
          next.prepare(),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => {
              next.dispose();
              reject(new Error('Recording preparation timed out.'));
            }, 30000);
          }),
        ]);
      } catch (error) {
        next.dispose();
        // A superseded device/format attempt must not block the latest settings.
        if (revision !== requestedRevision) continue;
        throw error;
      } finally {
        clearTimeout(timeout!);
      }
      if (phase !== 'prepare' || revision !== requestedRevision) {
        next.dispose();
        continue;
      }
      engine = next;
      preparedRevision = revision;
      clearPreparationError('prepare');
    }
  } catch (error) {
    preparationError('prepare', error);
  } finally {
    warming = false;
    updateFormat();
  }
}

/** Begin uses already prepared streams, hides preparation and runs a separate countdown window. */
async function start() {
  if (phase !== 'prepare' || deviceBusy || warming || !engine) return;
  await closeDevices();
  clearPreparationError();
  phase = 'arming';
  format.disabled = true;
  updateFormat();
  try {
    const settings = (await api.request(
      'begin',
      recordingSettings()
    )) as RecordingOptions;
    await api.request('countdown');
    el('prepare').hidden = true;
    el('active').hidden = false;
    document.body.dataset.view = 'active';
    await api.request('activate');
    // Let the desktop compositor remove a full-screen control panel before the first encoded frame.
    await new Promise((resolve) => setTimeout(resolve, 150));
    await engine.start();
    phase = 'recording';
    el('record-state').textContent = messages.recording;
    el('prepare').hidden = true;
    el('active').hidden = false;
    status(messages.shortcuts);
    heartbeat = setInterval(() => {
      el('timer').textContent = clock(engine!.seconds());
      void api.request('heartbeat').catch(fail);
      const limit =
        settings.format === 'gif'
          ? MAX_GIF_SECONDS
          : (settings.maxMp4DurationSeconds ?? DEFAULT_MP4_SECONDS);
      if (engine!.seconds() >= limit) void stop();
      if (
        !paused &&
        (performance.now() - engine!.lastVideoAt > 10000 ||
          (engine!.hasAudio && performance.now() - engine!.lastAudioAt > 10000))
      )
        void fail(new Error('Audio/video encoder stopped producing data.'));
    }, 500);
  } catch (error) {
    await fail(error);
  }
}

async function stop() {
  if (phase !== 'recording') return;
  phase = 'stopping';
  clearInterval(heartbeat);
  el<HTMLButtonElement>('stop').disabled = el<HTMLButtonElement>('pause').disabled =
    true;
  try {
    status(messages.finalizing);
    el('record-state').textContent = messages.finalizing;
    await api.request('stopping');
    await engine!.stop();
    await api.request('complete');
    phase = 'preview';
  } catch (error) {
    await fail(error);
  }
}

async function pause() {
  if (phase !== 'recording') return;
  paused = !paused;
  engine!.pause(paused);
  document.body.dataset.paused = String(paused);
  el('record-state').textContent = paused ? messages.paused : messages.recording;
  el('pause').textContent = paused ? messages.resume : messages.pause;
  await api.request('paused', paused);
}
el('start').onclick = () => {
  if (!engine && phase === 'prepare') void warmEngine();
  else void start();
};
el('stop').onclick = () => {
  void stop();
};
el('pause').onclick = () => {
  void pause().catch(fail);
};
format.onchange = () => {
  updateFormat();
  void warmEngine();
};
for (const button of audioButtons) {
  button.onclick = () => {
    const system = audioMode === 'system' || audioMode === 'both';
    const microphone = audioMode === 'microphone' || audioMode === 'both';
    const nextSystem = button.id === 'system' ? !system : system;
    const nextMic = button.id === 'microphone' ? !microphone : microphone;
    audioMode =
      nextSystem && nextMic
        ? 'both'
        : nextSystem
          ? 'system'
          : nextMic
            ? 'microphone'
            : 'none';
    updateFormat();
    void warmEngine();
  };
}
/** Permission and enumeration are triggered only by a device-control gesture. */
async function closeDevices() {
  if (!deviceKind) return;
  deviceMenuRevision++;
  deviceKind = undefined;
  for (const id of ['camera-menu', 'microphone-menu'])
    el(id).setAttribute('aria-expanded', 'false');
  await api.request('device-menu-close');
}
async function setCamera(enabled: boolean) {
  if (deviceBusy || phase !== 'prepare') return;
  deviceBusy = true;
  clearPreparationError('camera');
  updateFormat();
  try {
    await api.request('camera', { camera: enabled, cameraDeviceId });
    cameraEnabled = enabled;
    clearPreparationError('camera');
  } catch (error) {
    cameraEnabled = false;
    preparationError('camera', error);
  } finally {
    deviceBusy = false;
    updateFormat();
  }
}
async function availableDevices(kind: 'camera' | 'microphone') {
  let temporary: MediaStream | undefined;
  try {
    let devices = await navigator.mediaDevices.enumerateDevices();
    const mediaKind = kind === 'camera' ? 'videoinput' : 'audioinput';
    if (!devices.some((d) => d.kind === mediaKind && d.label)) {
      await api.request('device-permission', kind);
      temporary = await navigator.mediaDevices.getUserMedia(
        kind === 'camera'
          ? { video: true, audio: false }
          : { audio: true, video: false }
      );
      devices = await navigator.mediaDevices.enumerateDevices();
    }
    if (deviceKind !== kind || phase !== 'prepare') return;
    const inputs = devices.filter(
      (d) =>
        d.kind === mediaKind &&
        d.deviceId &&
        !['default', 'communications'].includes(d.deviceId)
    );
    return inputs.map((device, i) => ({
      id: device.deviceId,
      label: device.label || `${messages[kind]} ${i + 1}`,
    }));
  } finally {
    temporary?.getTracks().forEach((track) => track.stop());
  }
}
for (const kind of ['camera', 'microphone'] as const) {
  el(`${kind}-menu`).onclick = async () => {
    if (deviceBusy || phase !== 'prepare') return;
    if (deviceKind) {
      await closeDevices();
      return;
    }
    deviceKind = kind;
    clearPreparationError('devices');
    const revision = ++deviceMenuRevision;
    el(`${kind}-menu`).setAttribute('aria-expanded', 'true');
    try {
      const devices = await availableDevices(kind);
      if (!devices || revision !== deviceMenuRevision || phase !== 'prepare') return;
      const anchor = el(`${kind}-menu`).getBoundingClientRect();
      const selected = kind === 'camera' ? cameraDeviceId : microphoneDeviceId;
      const id = await api.request('device-menu', {
        kind,
        devices,
        selected,
        x: anchor.left,
        y: anchor.bottom + 4,
      });
      if (
        typeof id !== 'string' ||
        revision !== deviceMenuRevision ||
        phase !== 'prepare' ||
        id === selected
      )
        return;
      if (kind === 'microphone') {
        microphoneDeviceId = id;
        void warmEngine();
      } else {
        cameraDeviceId = id;
        if (cameraEnabled) await setCamera(true);
      }
    } catch (error) {
      if (revision === deviceMenuRevision) preparationError('devices', error);
    } finally {
      if (revision === deviceMenuRevision) {
        deviceKind = undefined;
        el(`${kind}-menu`).setAttribute('aria-expanded', 'false');
      }
    }
  };
}
el('camera').onclick = () => {
  void setCamera(!cameraEnabled);
};
navigator.mediaDevices.addEventListener('devicechange', () => {
  if (deviceKind) void closeDevices();
});
api.onCommand((command) => {
  if (command === 'stop') void stop();
  else void pause().catch(fail);
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (deviceKind) {
    void closeDevices();
    return;
  }
  if (phase === 'prepare' || phase === 'preview') void api.request('cancel');
});
void api
  .request('init')
  .then((raw) => {
    init = raw as RecordingInit;
    messages = recordingMessages(init.locale);
    document.documentElement.lang = init.locale;
    for (const key of ['start', 'pause', 'stop'] as const)
      el(key).textContent = messages[key];
    el('format-label').textContent = messages.format;
    el('audio').setAttribute('aria-label', messages.audio);
    el('system-label').textContent = messages.system;
    el('microphone-label').textContent = messages.microphone;
    el('camera-label').textContent = messages.camera;
    el('microphone-menu').setAttribute(
      'aria-label',
      `${messages.chooseDevice}: ${messages.microphone}`
    );
    el('camera-menu').setAttribute(
      'aria-label',
      `${messages.chooseDevice}: ${messages.camera}`
    );
    cameraDeviceId = init.options.cameraDeviceId ?? '';
    microphoneDeviceId = init.options.microphoneDeviceId ?? '';
    el('dimensions').textContent =
      `${Math.round(init.selection.width)} × ${Math.round(init.selection.height)}`;
    document.querySelector<HTMLInputElement>(
      `input[value="${init.options.format ?? 'mp4'}"]`
    )!.checked = true;
    audioMode = init.options.audio ?? 'none';
    status(init.hideControls ? messages.hiddenControls : '');
    el('start').title = messages.fixedArea;
    updateFormat();
    void warmEngine();
    if (init.options.camera) void setCamera(true);
  })
  .catch(fail);

// Main clamps movement to the display and enforces platform capture-exclusion limits.
const grip = el('bar-grip');
let barDrag: { x: number; y: number } | undefined;
grip.onpointerdown = (event) => {
  event.preventDefault();
  grip.setPointerCapture(event.pointerId);
  barDrag = { x: event.screenX, y: event.screenY };
  void api.request('bar-drag');
};
grip.onpointermove = (event) => {
  if (barDrag)
    void api.request('bar-move', {
      dx: event.screenX - barDrag.x,
      dy: event.screenY - barDrag.y,
    });
};
grip.onpointerup = grip.onpointercancel = () => {
  barDrag = undefined;
};
window.addEventListener('beforeunload', () => engine?.dispose());
