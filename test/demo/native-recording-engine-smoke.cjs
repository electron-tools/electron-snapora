/** Synthetic H.264 exercises the native packet consumer on either OS; it does not test SCK exclusion. */
const { app, BrowserWindow } = require('electron');
const { mkdtempSync, writeFileSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { build } = createRequire(require.resolve('tsup'))('esbuild');
const dir = mkdtempSync(join(tmpdir(), 'snapora-native-engine-'));
app.setPath('userData', join(dir, 'profile'));

app.whenReady().then(async () => {
  let win;
  try {
    await build({
      entryPoints: [resolve('src/recording/engine.ts')],
      outfile: join(dir, 'engine.mjs'),
      bundle: true,
      format: 'esm',
      platform: 'browser',
      plugins: [
        {
          name: 'test-worker-url',
          setup(builder) {
            builder.onLoad(
              { filter: /[/\\]recording[/\\]engine\.ts$/ },
              ({ path }) => ({
                contents: readFileSync(path, 'utf8').replace(
                  "'./gif-worker.ts'",
                  "'./gif-worker.js'"
                ),
                loader: 'ts',
              })
            );
          },
        },
      ],
    });
    await build({
      entryPoints: [resolve('src/recording/gif-worker.ts')],
      outfile: join(dir, 'gif-worker.js'),
      bundle: true,
      format: 'esm',
      platform: 'browser',
    });
    writeFileSync(
      join(dir, 'index.html'),
      `<script type="module">
      import { RecordingEngine } from './engine.mjs';
      window.run = async (format) => {
        const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#e000d0'; ctx.fillRect(0,0,320,180);
        const packets = []; let config; let fault;
        const encoder = new VideoEncoder({ output(chunk, metadata) {
          if (metadata?.decoderConfig?.description) config = new Uint8Array(metadata.decoderConfig.description);
          const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
          packets.push({ sequence: packets.length + 1, timestamp: chunk.timestamp / 1e6, duration: .1, key: chunk.type === 'key', data, config });
        }, error(e) { fault = e; } });
        encoder.configure({ codec: 'avc1.42001f', width: 320, height: 180, bitrate: 500000, framerate: 10, latencyMode: 'realtime', avc: { format: 'avc' } });
        for (let i=0; i<12; i++) {
          const frame = new VideoFrame(canvas, { timestamp: i * 100000, duration: 100000 });
          encoder.encode(frame, { keyFrame: i === 0 }); frame.close();
        }
        await encoder.flush(); encoder.close(); if (fault) throw fault;
        let cursor = 0, ended = false, waiting;
        window.snaporaRecording = { async request(action, payload) {
          if (action === 'native-prepare') return { id: 1, width: 320, height: 180 };
          if (action === 'native-next') {
            if (payload.sequence !== undefined && payload.sequence !== cursor) throw Error('ACK order');
            if (cursor < packets.length) { await new Promise(r => setTimeout(r, 100)); return packets[cursor++]; }
            if (ended) return null;
            return new Promise(r => { waiting = r; });
          }
          if (action === 'native-stop' || action === 'native-release') { ended = true; waiting?.(null); }
          return true;
        } };
        const chunks = [];
        const engine = new RecordingEngine({ nativeVideo: true }, { format, audio: 'none' }, async (bytes) => chunks.push(Array.from(bytes)), e => { fault = e; });
        await engine.prepare(); await engine.start();
        await new Promise(r => setTimeout(r, 1300));
        await engine.stop(); if (fault) throw fault;
        return chunks;
      };
    </script>`
    );
    win = new BrowserWindow({
      show: false,
      webPreferences: { backgroundThrottling: false },
    });
    await win.loadFile(join(dir, 'index.html'));
    for (const format of ['mp4', 'gif']) {
      const chunks = await win.webContents.executeJavaScript(`window.run('${format}')`);
      const bytes = Buffer.concat(chunks.map((c) => Buffer.from(c)));
      assert(bytes.length > 100, 'encoded output must contain frames');
      const path = join(dir, `result.${format}`);
      writeFileSync(path, bytes);
      if (format === 'gif') assert.equal(bytes.subarray(0, 6).toString(), 'GIF89a');
      else assert.equal(bytes.subarray(4, 8).toString(), 'ftyp');
      if (process.env.SNAPORA_TEST_FFMPEG) {
        const pixels = execFileSync(
          process.env.SNAPORA_TEST_FFMPEG,
          [
            '-v',
            'error',
            '-ss',
            '0.5',
            '-i',
            path,
            '-frames:v',
            '1',
            '-vf',
            'scale=1:1',
            '-pix_fmt',
            'rgb24',
            '-f',
            'rawvideo',
            'pipe:1',
          ],
          { windowsHide: true }
        );
        assert(
          pixels[0] > 180 && pixels[1] < 50 && pixels[2] > 150,
          'native packets must decode to the source color'
        );
      }
      console.log('NATIVE_PACKET_ENGINE_OK', format, bytes.length);
    }
    console.log('ARTIFACTS', dir);
    win.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error);
    win?.destroy();
    app.exit(1);
  }
});
