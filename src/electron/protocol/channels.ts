export const DEFAULT_HOST_CAPTURE_CHANNEL = 'electron-snapora:host:capture';
export const DEFAULT_HOST_CANCEL_CHANNEL = 'electron-snapora:host:cancel';

export const OVERLAY_CHANNELS = {
  ready: 'electron-snapora:overlay:ready',
  prepared: 'electron-snapora:overlay:prepared',
  initialize: 'electron-snapora:overlay:initialize',
  feedback: 'electron-snapora:overlay:feedback',
  feedbackReady: 'electron-snapora:overlay:feedback-ready',
  confirm: 'electron-snapora:overlay:confirm',
  cancel: 'electron-snapora:overlay:cancel',
  error: 'electron-snapora:overlay:error',
  output: 'electron-snapora:overlay:output',
} as const;

export const PINNED_CHANNELS = {
  initialize: 'electron-snapora:pinned:initialize',
  copy: 'electron-snapora:pinned:copy',
  copied: 'electron-snapora:pinned:copied',
  save: 'electron-snapora:pinned:save',
  close: 'electron-snapora:pinned:close',
  dragStart: 'electron-snapora:pinned:drag-start',
  dragMove: 'electron-snapora:pinned:drag-move',
  dragEnd: 'electron-snapora:pinned:drag-end',
} as const;
