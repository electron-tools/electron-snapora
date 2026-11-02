declare module 'gifenc' {
  export function quantize(
    data: Uint8Array | Uint8ClampedArray,
    colors: number
  ): number[][];
  export function applyPalette(
    data: Uint8Array | Uint8ClampedArray,
    palette: number[][]
  ): Uint8Array;
  export function GIFEncoder(options?: { auto?: boolean }): {
    writeHeader(): void;
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options: { palette: number[][]; delay: number; first?: boolean }
    ): void;
    bytes(): Uint8Array;
    finish(): void;
    stream: { reset(): void };
  };
}
