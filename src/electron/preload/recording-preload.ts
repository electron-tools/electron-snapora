import { contextBridge, ipcRenderer } from 'electron';
import {
  RECORDING_CHANNEL,
  RECORDING_COMMAND,
  type RecordingApi,
} from '../../recording/protocol.js';

/** Dedicated recorder bridge; main validates sender, state and payload for every request. */
const api: RecordingApi = {
  request: (action, payload) => ipcRenderer.invoke(RECORDING_CHANNEL, action, payload),
  onCommand: (listener) => {
    ipcRenderer.on(RECORDING_COMMAND, (_event, command: 'stop' | 'pause') =>
      listener(command)
    );
  },
};
contextBridge.exposeInMainWorld('snaporaRecording', api);
