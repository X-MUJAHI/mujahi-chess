'use strict';

const { normalizeEvaluation } = require('../utils/evaluation');

/**
 * Parses `id name ...` or `id author ...` lines from UCI handshake.
 */
function parseUciIdLine(line) {
  const match = /^id\s+(name|author)\s+(.+)$/.exec(line.trim());
  if (!match) return null;
  return { field: match[1], value: match[2].trim() };
}

/**
 * Parses `option name <Name> type <Type> ...` declarations reported by Stockfish.
 */
function parseUciOptionLine(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('option name ')) return null;
  const match = /^option name\s+(.+?)\s+type\s+(check|spin|combo|button|string)(?:\s+(.*))?$/.exec(trimmed);
  if (!match) return null;

  const option = {
    name: match[1].trim(),
    type: match[2],
  };

  const rest = match[3] || '';
  const defaultMatch = /\bdefault\s+([^\s]+(?:\s+[^\s]+)*?)(?=\s+(?:min|max|var)\b|$)/.exec(rest);
  if (defaultMatch) {
    const rawDefault = defaultMatch[1].trim();
    if (option.type === 'spin') {
      option.default = Number.parseInt(rawDefault, 10);
    } else if (option.type === 'check') {
      option.default = rawDefault === 'true';
    } else {
      option.default = rawDefault === '<empty>' ? '' : rawDefault;
    }
  }

  const minMatch = /\bmin\s+(-?\d+)/.exec(rest);
  const maxMatch = /\bmax\s+(-?\d+)/.exec(rest);
  if (minMatch) option.min = Number.parseInt(minMatch[1], 10);
  if (maxMatch) option.max = Number.parseInt(maxMatch[1], 10);

  return option;
}

/**
 * Parses a Stockfish UCI `info` line into a structured evaluation snapshot.
 * Returns null for auxiliary info lines (e.g., currmove, string) that lack depth/score.
 */
function parseUciInfoLine(line, sideToMove = 'white', options = {}) {
  const allowMultiPv = Boolean(options?.allowMultiPv);
  const trimmed = line.trim();
  if (!trimmed.startsWith('info ')) return null;
  if (/\bcurrmove\b/.test(trimmed) && !/\bscore\b/.test(trimmed)) return null;

  const depthMatch = /\bdepth\s+(\d+)/.exec(trimmed);
  if (!depthMatch) return null;

  const multipvMatch = /\bmultipv\s+(\d+)/.exec(trimmed);
  const multipv = multipvMatch ? Number.parseInt(multipvMatch[1], 10) : 1;
  if (!allowMultiPv && multipv !== 1) return null;

  const scoreMatch = /\bscore\s+(cp|mate)\s+(-?\d+)(?:\s+(lowerbound|upperbound))?/.exec(trimmed);
  const pvMatch = /\bpv\s+(.+)$/.exec(trimmed);

  // Require at least a score or a PV to form a meaningful snapshot
  if (!scoreMatch && !pvMatch) return null;

  const depth = Number.parseInt(depthMatch[1], 10);
  const seldepthMatch = /\bseldepth\s+(\d+)/.exec(trimmed);
  const nodesMatch = /\bnodes\s+(\d+)/.exec(trimmed);
  const npsMatch = /\bnps\s+(\d+)/.exec(trimmed);
  const timeMatch = /\btime\s+(\d+)/.exec(trimmed);

  const pv = pvMatch
    ? pvMatch[1]
        .trim()
        .split(/\s+/)
        .filter((move) => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move))
    : [];

  let evaluation = null;
  let mate = null;
  let bound = 'exact';

  if (scoreMatch) {
    const scoreType = scoreMatch[1];
    const rawScore = Number.parseInt(scoreMatch[2], 10);
    bound = scoreMatch[3] || 'exact';
    const normalized = normalizeEvaluation({
      type: scoreType,
      rawScore,
      bound,
      sideToMove,
    });
    evaluation = normalized.evaluation;
    mate = normalized.mate;
  }

  return {
    depth,
    seldepth: seldepthMatch ? Number.parseInt(seldepthMatch[1], 10) : null,
    multipv,
    bestmove: pv[0] || null,
    ponder: pv[1] || null,
    evaluation,
    mate,
    bound,
    pv,
    nodes: nodesMatch ? Number.parseInt(nodesMatch[1], 10) : null,
    nps: npsMatch ? Number.parseInt(npsMatch[1], 10) : null,
    time: timeMatch ? Number.parseInt(timeMatch[1], 10) : null,
  };
}

/**
 * Parses `bestmove <move> [ponder <move>]` including terminal `bestmove (none)`.
 */
function parseBestMoveLine(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('bestmove ')) return null;

  const parts = trimmed.split(/\s+/);
  const rawBest = parts[1];
  const terminal = !rawBest || rawBest === '(none)' || rawBest === '0000';
  const bestmove = terminal ? null : rawBest;

  let ponder = null;
  const ponderIdx = parts.indexOf('ponder');
  if (ponderIdx !== -1 && parts[ponderIdx + 1]) {
    const rawPonder = parts[ponderIdx + 1];
    if (rawPonder !== '(none)' && rawPonder !== '0000') {
      ponder = rawPonder;
    }
  }

  return { bestmove, ponder, terminal };
}

module.exports = {
  parseUciIdLine,
  parseUciOptionLine,
  parseUciInfoLine,
  parseBestMoveLine,
};
