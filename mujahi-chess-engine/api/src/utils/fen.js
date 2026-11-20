'use strict';

const PIECE_CHARS = new Set(['p', 'n', 'b', 'r', 'q', 'k', 'P', 'N', 'B', 'R', 'Q', 'K']);

function squareToCoords(square) {
  if (!/^[a-h][1-8]$/.test(square)) return null;
  const file = square.charCodeAt(0) - 97; // 0..7 (a..h)
  const rank = Number.parseInt(square[1], 10) - 1; // 0..7 (1..8)
  return { file, rank };
}

function getPiece(board, file, rank) {
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  return board[rank * 8 + file];
}

/**
 * Checks whether the square (targetFile, targetRank) is attacked by `attackerColor` ('w' or 'b').
 */
function isSquareAttacked(board, targetFile, targetRank, attackerColor) {
  const isWhite = attackerColor === 'w';
  const pawnChar = isWhite ? 'P' : 'p';
  const knightChar = isWhite ? 'N' : 'n';
  const bishopChar = isWhite ? 'B' : 'b';
  const rookChar = isWhite ? 'R' : 'r';
  const queenChar = isWhite ? 'Q' : 'q';
  const kingChar = isWhite ? 'K' : 'k';

  // Pawn attacks: white pawns attack rank + 1, so from target perspective check rank - 1
  const pawnOriginRank = isWhite ? targetRank - 1 : targetRank + 1;
  if (pawnOriginRank >= 0 && pawnOriginRank <= 7) {
    if (getPiece(board, targetFile - 1, pawnOriginRank) === pawnChar) return true;
    if (getPiece(board, targetFile + 1, pawnOriginRank) === pawnChar) return true;
  }

  // Knight attacks
  const knightOffsets = [
    [-2, -1], [-2, 1], [-1, -2], [-1, 2],
    [1, -2], [1, 2], [2, -1], [2, 1],
  ];
  for (const [df, dr] of knightOffsets) {
    if (getPiece(board, targetFile + df, targetRank + dr) === knightChar) return true;
  }

  // King attacks
  for (let df = -1; df <= 1; df++) {
    for (let dr = -1; dr <= 1; dr++) {
      if (df === 0 && dr === 0) continue;
      if (getPiece(board, targetFile + df, targetRank + dr) === kingChar) return true;
    }
  }

  // Diagonal rays (bishop / queen)
  const diagDirs = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  for (const [df, dr] of diagDirs) {
    let f = targetFile + df;
    let r = targetRank + dr;
    while (f >= 0 && f <= 7 && r >= 0 && r <= 7) {
      const piece = getPiece(board, f, r);
      if (piece) {
        if (piece === bishopChar || piece === queenChar) return true;
        break;
      }
      f += df;
      r += dr;
    }
  }

  // Orthogonal rays (rook / queen)
  const orthoDirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (const [df, dr] of orthoDirs) {
    let f = targetFile + df;
    let r = targetRank + dr;
    while (f >= 0 && f <= 7 && r >= 0 && r <= 7) {
      const piece = getPiece(board, f, r);
      if (piece) {
        if (piece === rookChar || piece === queenChar) return true;
        break;
      }
      f += df;
      r += dr;
    }
  }

  return false;
}

/**
 * Performs strict syntactic and semantic validation on a FEN string before it
 * is ever permitted to reach Stockfish's UCI stdin stream.
 */
function validateFen(rawFen) {
  if (typeof rawFen !== 'string') {
    return { valid: false, error: 'FEN must be a non-empty string.' };
  }

  // Prevent UCI stdin command injection (newlines, carriage returns, null bytes)
  if (/[\r\n\0\t]/.test(rawFen)) {
    return { valid: false, error: 'FEN contains prohibited control characters.' };
  }

  const fen = rawFen.trim();
  if (fen.length < 15 || fen.length > 128) {
    return { valid: false, error: 'FEN length is outside valid bounds.' };
  }

  const fields = fen.split(/\s+/);
  if (fields.length !== 6) {
    return {
      valid: false,
      error: 'FEN must contain exactly 6 space-separated fields (placement, turn, castling, en passant, halfmove, fullmove).',
    };
  }

  const [placement, activeColor, castling, enPassant, halfmoveRaw, fullmoveRaw] = fields;

  // 1. Validate piece placement and populate 8x8 board (rank 0 = rank 1, rank 7 = rank 8)
  const ranks = placement.split('/');
  if (ranks.length !== 8) {
    return { valid: false, error: 'FEN piece placement must have exactly 8 ranks separated by "/".' };
  }

  const board = Array(64).fill(null);
  let whiteKings = 0;
  let blackKings = 0;
  let whiteKingCoords = null;
  let blackKingCoords = null;
  let whitePawns = 0;
  let blackPawns = 0;
  let whiteTotal = 0;
  let blackTotal = 0;

  for (let fenRankIdx = 0; fenRankIdx < 8; fenRankIdx++) {
    const rankStr = ranks[fenRankIdx];
    const boardRank = 7 - fenRankIdx; // fenRankIdx 0 is rank 8 (index 7)
    if (!rankStr) {
      return { valid: false, error: `FEN rank ${8 - fenRankIdx} is empty.` };
    }

    let file = 0;
    let prevWasDigit = false;

    for (const ch of rankStr) {
      if (ch >= '1' && ch <= '8') {
        if (prevWasDigit) {
          return { valid: false, error: 'FEN rank contains consecutive empty-square digits.' };
        }
        file += Number.parseInt(ch, 10);
        prevWasDigit = true;
      } else if (PIECE_CHARS.has(ch)) {
        prevWasDigit = false;
        if (file > 7) {
          return { valid: false, error: `FEN rank ${8 - fenRankIdx} exceeds 8 squares.` };
        }
        if ((ch === 'p' || ch === 'P') && (boardRank === 0 || boardRank === 7)) {
          return { valid: false, error: 'Pawns cannot be placed on rank 1 or rank 8.' };
        }

        board[boardRank * 8 + file] = ch;
        if (ch >= 'A' && ch <= 'Z') {
          whiteTotal++;
          if (ch === 'P') whitePawns++;
          if (ch === 'K') {
            whiteKings++;
            whiteKingCoords = { file, rank: boardRank };
          }
        } else {
          blackTotal++;
          if (ch === 'p') blackPawns++;
          if (ch === 'k') {
            blackKings++;
            blackKingCoords = { file, rank: boardRank };
          }
        }
        file++;
      } else {
        return { valid: false, error: `Invalid piece character "${ch}" in FEN placement.` };
      }
    }

    if (file !== 8) {
      return { valid: false, error: `FEN rank ${8 - fenRankIdx} has ${file} squares instead of 8.` };
    }
  }

  // 2. King count and piece count invariants
  if (whiteKings !== 1 || blackKings !== 1) {
    return { valid: false, error: 'FEN must contain exactly one white king and one black king.' };
  }
  if (whitePawns > 8 || blackPawns > 8) {
    return { valid: false, error: 'A side cannot have more than 8 pawns.' };
  }
  if (whiteTotal > 16 || blackTotal > 16) {
    return { valid: false, error: 'A side cannot have more than 16 pieces.' };
  }

  // 3. Kings must never be adjacent
  if (
    Math.abs(whiteKingCoords.file - blackKingCoords.file) <= 1 &&
    Math.abs(whiteKingCoords.rank - blackKingCoords.rank) <= 1
  ) {
    return { valid: false, error: 'Kings cannot occupy adjacent squares.' };
  }

  // 4. Active color
  if (activeColor !== 'w' && activeColor !== 'b') {
    return { valid: false, error: 'Active color must be "w" or "b".' };
  }

  // 5. Opponent king cannot already be in check
  const opponentKingCoords = activeColor === 'w' ? blackKingCoords : whiteKingCoords;
  if (isSquareAttacked(board, opponentKingCoords.file, opponentKingCoords.rank, activeColor)) {
    return {
      valid: false,
      error: 'Illegal position: the side not to move is already in check.',
    };
  }

  // 6. Castling availability consistency
  if (castling !== '-') {
    if (!/^[KQkq]+$/.test(castling) || !/^K?Q?k?q?$/.test(castling)) {
      return { valid: false, error: 'Invalid castling availability field (expected "-" or canonical subset of "KQkq").' };
    }
    if (castling.includes('K') && (getPiece(board, 4, 0) !== 'K' || getPiece(board, 7, 0) !== 'R')) {
      return { valid: false, error: 'White kingside castling ("K") requires K on e1 and R on h1.' };
    }
    if (castling.includes('Q') && (getPiece(board, 4, 0) !== 'K' || getPiece(board, 0, 0) !== 'R')) {
      return { valid: false, error: 'White queenside castling ("Q") requires K on e1 and R on a1.' };
    }
    if (castling.includes('k') && (getPiece(board, 4, 7) !== 'k' || getPiece(board, 7, 7) !== 'r')) {
      return { valid: false, error: 'Black kingside castling ("k") requires k on e8 and r on h8.' };
    }
    if (castling.includes('q') && (getPiece(board, 4, 7) !== 'k' || getPiece(board, 0, 7) !== 'r')) {
      return { valid: false, error: 'Black queenside castling ("q") requires k on e8 and r on a8.' };
    }
  }

  // 7. En passant target square consistency
  if (enPassant !== '-') {
    const epCoords = squareToCoords(enPassant);
    if (!epCoords) {
      return { valid: false, error: 'Invalid en passant square.' };
    }
    if (activeColor === 'w') {
      if (epCoords.rank !== 5) {
        return { valid: false, error: 'En passant target must be on rank 6 when White is to move.' };
      }
      if (getPiece(board, epCoords.file, 5) !== null || getPiece(board, epCoords.file, 6) !== null) {
        return { valid: false, error: 'En passant target square and origin rank 7 square must be empty.' };
      }
      if (getPiece(board, epCoords.file, 4) !== 'p') {
        return { valid: false, error: 'En passant target requires a Black pawn on rank 5.' };
      }
    } else {
      if (epCoords.rank !== 2) {
        return { valid: false, error: 'En passant target must be on rank 3 when Black is to move.' };
      }
      if (getPiece(board, epCoords.file, 2) !== null || getPiece(board, epCoords.file, 1) !== null) {
        return { valid: false, error: 'En passant target square and origin rank 2 square must be empty.' };
      }
      if (getPiece(board, epCoords.file, 3) !== 'P') {
        return { valid: false, error: 'En passant target requires a White pawn on rank 4.' };
      }
    }
  }

  // 8. Halfmove clock and fullmove number
  if (!/^\d+$/.test(halfmoveRaw)) {
    return { valid: false, error: 'Halfmove clock must be a non-negative integer.' };
  }
  const halfmove = Number.parseInt(halfmoveRaw, 10);
  if (halfmove < 0 || halfmove > 150) {
    return { valid: false, error: 'Halfmove clock must be between 0 and 150.' };
  }

  if (!/^\d+$/.test(fullmoveRaw)) {
    return { valid: false, error: 'Fullmove number must be a positive integer.' };
  }
  const fullmove = Number.parseInt(fullmoveRaw, 10);
  if (fullmove < 1 || fullmove > 5000) {
    return { valid: false, error: 'Fullmove number must be between 1 and 5000.' };
  }

  return {
    valid: true,
    fen,
    sideToMove: activeColor === 'w' ? 'white' : 'black',
    activeColor,
    halfmove,
    fullmove,
  };
}

module.exports = {
  validateFen,
  isSquareAttacked,
  squareToCoords,
};
