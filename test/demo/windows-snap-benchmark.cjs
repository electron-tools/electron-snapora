/** Read-only native benchmark: fresh snapshots, no window activation or application input. */
const assert = require('node:assert/strict');
const { mkdirSync, writeFileSync, mkdtempSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { app } = require('electron');
const { createWindowsSnapProvider } = require('electron-snapora/main');
app.setPath('userData', mkdtempSync(join(tmpdir(), 'snapora-benchmark-')));
const records = [];
const provider = createWindowsSnapProvider({
  keepAlive: true,
  onDiagnostic: (event) => records.push(event),
});
const timeout = setTimeout(() => {
  provider.dispose();
  app.exit(1);
}, 60_000);
app
  .whenReady()
  .then(async () => {
    try {
      // Include one unprepared capture, then explicitly prewarm a fresh process.
      const cold = createWindowsSnapProvider({
        onDiagnostic: (event) => records.push({ ...event, sample: 'cold' }),
      });
      await cold(new AbortController().signal);
      cold.dispose();
      const started = performance.now();
      assert.equal(await provider.prepare(), true);
      const warmupMs = Math.round(performance.now() - started);
      for (const mode of ['window', 'panel', 'fine']) {
        for (let i = 0; i < 7; i++) {
          let updates = 0;
          await provider(
            new AbortController().signal,
            () => {
              updates++;
            },
            mode
          );
          assert.ok(updates > 0);
          assert.equal(records.at(-1).status, 'completed');
        }
      }
      const summary = ['window', 'panel', 'fine'].map((mode) => {
        const samples = records.filter((r) => r.granularity === mode && r.warm);
        const percentile = (key, p) => {
          const values = samples
            .map((r) => r[key])
            .filter(Number.isFinite)
            .sort((a, b) => a - b);
          return values[Math.ceil(values.length * p) - 1] ?? null;
        };
        return {
          mode,
          samples: samples.length,
          windowsP50: percentile('windowsReadyMs', 0.5),
          windowsP95: percentile('windowsReadyMs', 0.95),
          containerP50: percentile('firstContainerMs', 0.5),
          containerP95: percentile('firstContainerMs', 0.95),
          completeP50: percentile('durationMs', 0.5),
          completeP95: percentile('durationMs', 0.95),
        };
      });
      const result = { warmupMs, summary, records };
      const directory = join(__dirname, '../../.pack-preview');
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        join(directory, 'windows-snap-benchmark.json'),
        JSON.stringify(result, null, 2)
      );
      console.log(JSON.stringify({ warmupMs, summary, cold: records[0] }, null, 2));
    } finally {
      clearTimeout(timeout);
      provider.dispose();
    }
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
