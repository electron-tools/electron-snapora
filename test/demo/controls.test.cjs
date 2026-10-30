// Exercise the shipped renderer with deferred IPC responses, without desktop capture.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { setImmediate } = require('node:timers/promises');

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture({ supported = true, snapGet, interactionGet, capture } = {}) {
  class Element {
    disabled = true;
    value = '';
    textContent = '';
    events = {};
    addEventListener(name, callback) {
      this.events[name] = callback;
    }
  }
  const button = new Element();
  const output = new Element();
  const interaction = new Element();
  const snap = new Element();
  const description = new Element();
  const calls = [];
  const context = {
    HTMLButtonElement: Element,
    HTMLElement: Element,
    navigator: { platform: 'MacIntel' },
    document: {
      querySelector: (name) => (name === '.capture-button' ? button : output),
      getElementById: (name) =>
        ({
          'interaction-mode': interaction,
          'snap-granularity': snap,
          'snap-description': description,
        })[name] || null,
    },
    window: {
      electronSnapora: {
        capture: async (options) => {
          calls.push(options);
          return capture ? capture() : { status: 'cancelled' };
        },
      },
      demoInteractionApi: {
        get:
          interactionGet ||
          (async () => ({ supported, mode: supported ? 'live' : 'frozen' })),
        set: async (mode) => mode,
      },
      demoSnapApi: {
        get: snapGet || (async () => ({ supported, granularity: 'window' })),
        set: async (granularity) => granularity,
      },
    },
  };
  vm.runInNewContext(
    readFileSync(join(__dirname, '../../demo/renderer.js'), 'utf8'),
    context
  );
  return { button, output, interaction, snap, description, calls };
}

test('Mac demo enables both settings and sends the chosen interaction mode', async () => {
  const f = fixture();
  await setImmediate();
  assert.equal(f.interaction.disabled, false);
  assert.equal(f.snap.disabled, false);
  assert.equal(f.snap.value, 'window');
  for (const value of ['window', 'fine', 'panel']) {
    f.snap.value = value;
    await f.snap.events.change();
    assert.equal(f.snap.value, value);
    assert.equal(f.snap.disabled, false);
  }
  await f.button.events.click();
  assert.equal(f.calls[0].interactionMode, 'live');
  assert.equal(f.calls[0].display, 'all');
  assert.equal(f.interaction.disabled, false);
});

test('late settings response cannot unlock controls during capture', async () => {
  const config = deferred();
  const capture = deferred();
  const f = fixture({ snapGet: () => config.promise, capture: () => capture.promise });
  await setImmediate();
  const pending = f.button.events.click();
  config.resolve({ supported: true, granularity: 'panel' });
  await setImmediate();
  assert.equal(f.button.disabled, true);
  assert.equal(f.interaction.disabled, true);
  assert.equal(f.snap.disabled, true);
  capture.resolve({ status: 'cancelled' });
  await pending;
  assert.equal(f.button.disabled, false);
  assert.equal(f.interaction.disabled, false);
  assert.equal(f.snap.disabled, false);
});

test('snap IPC failure does not disable supported interaction after capture failure', async () => {
  const f = fixture({
    snapGet: async () => {
      throw new Error('snap config unavailable');
    },
    capture: async () => {
      throw new Error('permission denied');
    },
  });
  await setImmediate();
  await f.button.events.click();
  assert.match(f.output.textContent, /permission denied/);
  assert.match(f.description.textContent, /snap config unavailable/);
  assert.equal(f.button.disabled, false);
  assert.equal(f.interaction.disabled, false);
  assert.equal(f.snap.disabled, true);
});

test('unsupported OS preserves frozen capture and keeps live settings disabled', async () => {
  const f = fixture({ supported: false });
  await setImmediate();
  await f.button.events.click();
  assert.equal(f.calls[0].interactionMode, 'frozen');
  assert.equal(f.button.disabled, false);
  assert.equal(f.interaction.disabled, true);
  assert.equal(f.snap.disabled, true);
  assert.match(f.description.textContent, /macOS 14/);
});

test('interaction initialization failure is visible and blocks an unknown capture mode', async () => {
  const f = fixture({
    interactionGet: async () => {
      throw new Error('IPC failed');
    },
  });
  await setImmediate();
  assert.match(f.output.textContent, /IPC failed/);
  assert.equal(f.button.disabled, true);
  await f.button.events.click();
  assert.equal(f.calls.length, 0);
});
