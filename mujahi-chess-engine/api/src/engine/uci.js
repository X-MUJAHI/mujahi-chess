'use strict';

const { EventEmitter } = require('node:events');

/**
 * Whitelist of UCI commands permitted to be sent to Stockfish stdin.
 * Prevents arbitrary command/line injection into the engine pipe.
 */
const ALLOWED_UCI_COMMAND =
  /^(uci|isready|ucinewgame|stop|quit|bench(?:\s+\d+){0,4}|setoption name [A-Za-z0-9 _.-]+ value [A-Za-z0-9_.-]+|position fen [pnbrqkPNBRQK1-8/]+ [wb] (?:-|K?Q?k?q?) (?:-|[a-h][36]) \d+ \d+|go depth \d+)$/;

class UciChannel extends EventEmitter {
  constructor(childProcess) {
    super();
    this.process = childProcess;
    this.buffer = '';
    this.closed = false;

    this._onStdoutData = (chunk) => {
      this.buffer += chunk.toString('utf8');
      const lines = this.buffer.split(/\r?\n/);
      this.buffer = lines.pop() || '';
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (line) {
          this.emit('line', line);
        }
      }
    };

    this._onStderrData = (chunk) => {
      const text = chunk.toString('utf8').trim();
      if (text) {
        this.emit('stderr', text);
      }
    };

    this._onError = (err) => {
      this.closed = true;
      this.emit('error', err);
    };

    this._onExit = (code, signal) => {
      this.closed = true;
      if (this.buffer.trim()) {
        this.emit('line', this.buffer.trim());
        this.buffer = '';
      }
      this.emit('exit', { code, signal });
    };

    childProcess.stdout.on('data', this._onStdoutData);
    childProcess.stderr.on('data', this._onStderrData);
    childProcess.on('error', this._onError);
    childProcess.on('exit', this._onExit);
  }

  send(command) {
    if (this.closed || !this.process?.stdin?.writable) {
      throw new Error('Stockfish stdin stream is not writable.');
    }
    const clean = String(command || '').trim();
    if (!ALLOWED_UCI_COMMAND.test(clean)) {
      throw new Error(`Rejected disallowed UCI command: ${clean}`);
    }
    this.process.stdin.write(`${clean}\n`);
  }

  waitFor(predicate, timeoutMs, label = 'UCI response') {
    return new Promise((resolve, reject) => {
      if (this.closed) {
        reject(new Error(`Engine closed before receiving ${label}.`));
        return;
      }

      let timer = null;
      const cleanup = () => {
        this.off('line', onLine);
        this.off('exit', onExit);
        this.off('error', onError);
        if (timer) clearTimeout(timer);
      };

      const onLine = (line) => {
        try {
          if (predicate(line)) {
            cleanup();
            resolve(line);
          }
        } catch (err) {
          cleanup();
          reject(err);
        }
      };

      const onExit = ({ code, signal }) => {
        cleanup();
        reject(new Error(`Stockfish exited (code=${code}, signal=${signal}) while waiting for ${label}.`));
      };

      const onError = (err) => {
        cleanup();
        reject(err);
      };

      this.on('line', onLine);
      this.on('exit', onExit);
      this.on('error', onError);

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          cleanup();
          reject(new Error(`Timed out after ${timeoutMs}ms waiting for ${label}.`));
        }, timeoutMs);
      }
    });
  }

  destroy() {
    this.closed = true;
    if (this.process) {
      this.process.stdout?.off('data', this._onStdoutData);
      this.process.stderr?.off('data', this._onStderrData);
      this.process.off('error', this._onError);
      this.process.off('exit', this._onExit);
    }
    this.removeAllListeners();
  }
}

module.exports = {
  UciChannel,
  ALLOWED_UCI_COMMAND,
};
