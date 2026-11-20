'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseUciIdLine,
  parseUciOptionLine,
  parseUciInfoLine,
  parseBestMoveLine,
} = require('../src/engine/parser');

test('parses Stockfish 19 id and option lines', () => {
  assert.deepEqual(parseUciIdLine('id name Stockfish 19'), {
    field: 'name',
    value: 'Stockfish 19',
  });
  assert.deepEqual(parseUciOptionLine('option name Threads type spin default 1 min 1 max 1024'), {
    name: 'Threads',
    type: 'spin',
    default: 1,
    min: 1,
    max: 1024,
  });
  assert.deepEqual(parseUciOptionLine('option name Ponder type check default false'), {
    name: 'Ponder',
    type: 'check',
    default: false,
  });
});

test('normalizes centipawn scores to White perspective', () => {
  const whiteSnap = parseUciInfoLine(
    'info depth 15 seldepth 21 multipv 1 score cp 35 nodes 120000 nps 400000 time 300 pv e2e4 e7e5 g1f3',
    'white'
  );
  assert.equal(whiteSnap.depth, 15);
  assert.equal(whiteSnap.evaluation.type, 'cp');
  assert.equal(whiteSnap.evaluation.value, 0.35);
  assert.equal(whiteSnap.evaluation.perspective, 'white');
  assert.equal(whiteSnap.mate, null);
  assert.deepEqual(whiteSnap.pv, ['e2e4', 'e7e5', 'g1f3']);

  // When Black is to move and engine reports +145 cp (good for Black), White POV is -1.45
  const blackSnap = parseUciInfoLine(
    'info depth 12 score cp 145 nodes 50000 nps 250000 time 200 pv c7c5 g1f3',
    'black'
  );
  assert.equal(blackSnap.evaluation.value, -1.45);
  assert.equal(blackSnap.evaluation.perspective, 'white');
  assert.equal(blackSnap.mate, null);
});

test('normalizes mate scores to White perspective without confusing with cp', () => {
  // White to move with mate in 3
  const whiteMate = parseUciInfoLine(
    'info depth 10 score mate 3 nodes 8000 nps 200000 time 40 pv d1h5 g7g6 h5e5',
    'white'
  );
  assert.equal(whiteMate.evaluation.type, 'mate');
  assert.equal(whiteMate.evaluation.value, 3);
  assert.equal(whiteMate.mate, 3);

  // Black to move with mate in 2 (engine reports +2 for Black -> -2 from White POV)
  const blackMate = parseUciInfoLine(
    'info depth 8 score mate 2 nodes 4000 nps 200000 time 20 pv d8h4 g2g3 h4e4',
    'black'
  );
  assert.equal(blackMate.evaluation.type, 'mate');
  assert.equal(blackMate.evaluation.value, -2);
  assert.equal(blackMate.mate, -2);
});

test('parses lowerbound and upperbound flags accurately', () => {
  const lower = parseUciInfoLine(
    'info depth 14 score cp 90 lowerbound nodes 10000 pv e2e4',
    'white'
  );
  assert.equal(lower.bound, 'lowerbound');
  assert.equal(lower.evaluation.bound, 'lowerbound');

  const upper = parseUciInfoLine(
    'info depth 14 score cp 45 upperbound nodes 10000 pv e2e4',
    'white'
  );
  assert.equal(upper.bound, 'upperbound');
  assert.equal(upper.evaluation.bound, 'upperbound');
});

test('parses bestmove including terminal (none) positions', () => {
  assert.deepEqual(parseBestMoveLine('bestmove e2e4 ponder e7e5'), {
    bestmove: 'e2e4',
    ponder: 'e7e5',
    terminal: false,
  });
  assert.deepEqual(parseBestMoveLine('bestmove (none)'), {
    bestmove: null,
    ponder: null,
    terminal: true,
  });
});
