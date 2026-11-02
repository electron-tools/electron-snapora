import { desktopCapturer, systemPreferences } from 'electron';

/** Host integration preflight, called after app.whenReady(); requests OS access before recording UI. */
export async function prepareRecordingPermissions(
  options: { screen?: boolean; microphone?: boolean; camera?: boolean } = {
    screen: true,
  }
) {
  for (const media of ['microphone', 'camera'] as const)
    if (options[media] && process.platform === 'darwin')
      await systemPreferences.askForMediaAccess(media);
  if (options.screen !== false)
    await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 0, height: 0 },
    });
  return {
    screen: systemPreferences.getMediaAccessStatus('screen'),
    microphone: systemPreferences.getMediaAccessStatus('microphone'),
    camera: systemPreferences.getMediaAccessStatus('camera'),
  };
}
