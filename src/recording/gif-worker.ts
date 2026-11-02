import { GIFEncoder, applyPalette, quantize } from 'gifenc';

/** One frame per request. Drain encoded bytes while retaining only reusable LZW scratch space. */
const encoder = GIFEncoder();
self.onmessage = (
  event: MessageEvent<{
    rgba?: Uint8ClampedArray;
    width: number;
    height: number;
    delay: number;
    finish?: boolean;
  }>
) => {
  try {
    const data = event.data;
    if (data.finish) encoder.finish();
    else {
      const palette = quantize(data.rgba!, 256);
      encoder.writeFrame(applyPalette(data.rgba!, palette), data.width, data.height, {
        palette,
        delay: data.delay,
      });
    }
    const bytes = encoder.bytes();
    encoder.stream.reset();
    self.postMessage({ bytes }, { transfer: [bytes.buffer] });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
