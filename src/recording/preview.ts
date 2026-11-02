import './preview.css';
import type { RecordingApi } from './protocol.js';
import { recordingMessages } from '../i18n/recording.js';
/** Native-framed preview, isolated from capture and file-write capabilities. */
const api = (window as unknown as { snaporaRecording: RecordingApi }).snaporaRecording;
const save = document.getElementById('save') as HTMLButtonElement;
const status = document.getElementById('status')!;
void api.request('preview-init').then((raw) => {
  const data = raw as {
    url: string;
    format: string;
    bytes: number;
    durationSeconds: number;
    locale: string;
  };
  const messages = recordingMessages(data.locale);
  document.title = messages.preview;
  document.documentElement.lang = data.locale;
  const video = document.getElementById('video') as HTMLVideoElement;
  const gif = document.getElementById('gif') as HTMLImageElement;
  video.hidden = data.format === 'gif';
  gif.hidden = !video.hidden;
  if (video.hidden) gif.src = data.url;
  else video.src = data.url;
  save.textContent = messages.save;
  status.textContent = `${Math.floor(data.durationSeconds / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(data.durationSeconds % 60)
    .toString()
    .padStart(2, '0')} · ${(data.bytes / 1024 / 1024).toFixed(1)} MB`;
});
save.onclick = async () => {
  save.disabled = true;
  try {
    await api.request('save');
  } catch (error) {
    status.textContent = String(error);
  } finally {
    save.disabled = false;
  }
};
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') void api.request('cancel');
});
