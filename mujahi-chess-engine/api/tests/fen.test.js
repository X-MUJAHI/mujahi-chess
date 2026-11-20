'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateFen } = require('../src/utils/fen');

test('accepts standard starting position FEN', () => {
  const res = validateFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  assert.equal(res.valid, true);
  assert.equal(res.sideToMove, 'white');
});

test('accepts valid en passant FEN on rank 3 for black to move', () => {
  const res = validateFen('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
  assert.equal(res.valid, true);
  assert.equal(res.sideToMove, 'black');
});

test('rejects UCI stdin newline injection attempts', () => {
  const res = validateFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1\nquit');
  assert.equal(res.valid, false);
});

test('rejects pawns on rank 1 or rank 8', () => {
  const rank8Pawn = validateFen('rnbqkbnP/ppppppp1/8/8/8/8/PPPPPPPP/RNBQKBNR w KQ - 0 1');
  assert.equal(rank8Pawn.valid, false);

  const rank1Pawn = validateFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPP1/RNBQKBNp w KQkq - 0 1');
  assert.equal(rank1Pawn.valid, false);
});

test('rejects missing or duplicate kings', () => {
  const missingKing = validateFen('rnbq1bnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQ - 0 1');
  assert.equal(missingKing.valid, false);

  const twoWhiteKings = validateFen('rnbqkbnr/pppppppp/8/8/4K3/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  assert.equal(twoWhiteKings.valid, false);
});

test('rejects adjacent kings', () => {
  const adjacent = validateFen('8/8/8/3kK3/8/8/8/8 w - - 0 1');
  assert.equal(adjacent.valid, false);
});

test('rejects position where side not to move is already in check', () => {
  // White to move, Black king on e8 is already attacked by White rook on e1
  const illegalCheck = validateFen('4k3/8/8/8/8/8/8/4R2K w - - 0 1');
  assert.equal(illegalCheck.valid, false);
  assert.match(illegalCheck.error, /already in check/i);
});

test('rejects inconsistent castling rights', () => {
  // Claims K castling without White rook on h1
  const badCastling = validateFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBN1 w KQkq - 0 1');
  assert.equal(badCastling.valid, false);
});

test('rejects invalid en passant geometry', () => {
  // Claims e3 en passant without a White pawn on e4
  const badEp = validateFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq e3 0 1');
  assert.equal(badEp.valid, false);
});
