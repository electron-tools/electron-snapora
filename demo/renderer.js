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
