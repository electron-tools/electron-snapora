// Development-only local control channel, scoped to this checkout; never scans or kills host apps.
const net = require('node:net');
const { createHash } = require('node:crypto');
const { realpathSync, unlinkSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { setTimeout: delay } = require('node:timers/promises');

function endpoint(root = join(__dirname, '..')) {
  const path = realpathSync(root);
  const id = createHash('sha256')
    .update(process.platform === 'win32' ? path.toLowerCase() : path)
    .digest('hex')
    .slice(0, 24);
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\snapora-demo-${id}`
    : join(tmpdir(), `snapora-demo-${id}.sock`);
}

/** Only an idle demo accepts restart, so recording/preview work cannot be discarded by a build. */
function listenForRestart({ isBusy, quit }, address = endpoint()) {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      socket.setEncoding('utf8');
      socket.setTimeout(3000, () => socket.destroy());
      socket.on('error', () => {});
      let text = '';
      socket.on('data', (chunk) => {
        text += chunk;
        if (text.length > 64) return socket.destroy();
        if (!text.includes('\n')) return;
        if (text !== 'restart\n') return socket.destroy();
        text = '';
        if (isBusy()) return socket.end('busy\n');
        socket.end(`stopping:${process.pid}\n`, () => quit());
      });
    });
    server.once('error', reject);
    server.listen(address, () => resolve(server));
  });
}

/** Request graceful exit and wait for the old process to release native helper files before clean. */
async function stopPreviousDemo(address = endpoint()) {
  const reply = await new Promise((resolve, reject) => {
    const socket = net.createConnection(address);
    let text = '';
    socket.setEncoding('utf8');
    socket.setTimeout(10000, () =>
      socket.destroy(
        new Error('旧 Demo 退出超时，请关闭 Electron Snapora Demo 后重试。')
      )
    );
    socket.on('connect', () => socket.write('restart\n'));
    socket.on('data', (chunk) => {
      text += chunk;
      if (text.length > 128)
        socket.destroy(new Error('Invalid demo restart response.'));
    });
    socket.on('end', () => resolve(text.trim()));
    socket.on('error', (error) => {
      if (['ENOENT', 'ECONNREFUSED'].includes(error.code)) {
        if (process.platform !== 'win32' && error.code === 'ECONNREFUSED') {
          try {
            unlinkSync(address);
          } catch (e) {
            if (e.code !== 'ENOENT') return reject(e);
          }
        }
        resolve('absent');
      } else reject(error);
    });
  });
  if (reply === 'absent') return false;
  if (reply === 'busy')
    throw new Error('Demo 正在截图、录制或预览，请先完成或取消，再运行 pnpm demo。');
  if (!/^stopping:[1-9]\d*$/.test(reply))
    throw new Error('Invalid demo restart response.');
  const pid = Number(reply.split(':')[1]);
  for (let i = 0; i < 100; i++) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === 'ESRCH') {
        await delay(150);
        return true;
      }
      throw error;
    }
    await delay(100);
  }
  throw new Error(`旧 Demo (${pid}) 尚未退出，已停止构建；请关闭它后重试。`);
}

module.exports = { endpoint, listenForRestart, stopPreviousDemo };
