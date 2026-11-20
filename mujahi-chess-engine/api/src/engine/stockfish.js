'use strict';

const { spawn } = require('node:child_process');

/**
 * Spawns the native Stockfish 19 binary directly without invoking a shell.
 */
function spawnStockfishProcess(binaryPath) {
  return spawn(binaryPath, [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
    windowsHide: true,
  });
}

module.exports = {
  spawnStockfishProcess,
};
