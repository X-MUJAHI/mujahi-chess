'use strict';

/**
 * Pure 2-stage soft-mistake filter and analyzer.
 *
 * All incoming snapshots have `evaluation` normalized to White's POV,
 * so for Black to move (`sideToMove === 'black' || 'b'`), higher mover score = lower White cp.
 */
function isBlackSide(sideToMove) {
  return sideToMove === 'black' || sideToMove === 'b';
}

function getMoverCpFromSnapshot(snap, sideToMove) {
  if (!snap || !snap.evaluation) return null;
  const black = isBlackSide(sideToMove);
  const povFactor = black ? -1 : 1;
  if (snap.evaluation.type === 'cp') {
    const rawWhiteCp = Number.isFinite(Number(snap.evaluation.rawCp))
      ? Number(snap.evaluation.rawCp)
      : Math.round(Number(snap.evaluation.value) * 100);
    if (!Number.isFinite(rawWhiteCp)) return null;
    return { type: 'cp', cp: rawWhiteCp * povFactor, whiteCp: rawWhiteCp, mate: null };
  }
  if (snap.evaluation.type === 'mate') {
    const whiteMate = Number(snap.evaluation.value);
    if (!Number.isFinite(whiteMate)) return null;
    const moverMate = whiteMate === 0 ? 0 : whiteMate * povFactor;
    return { type: 'mate', cp: null, whiteCp: null, mate: moverMate };
  }
  return null;
}

function computeWinPercentFromWhiteCp(whiteCp) {
  if (!Number.isFinite(whiteCp)) return null;
  const clamped = Math.max(-4000, Math.min(4000, whiteCp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * clamped)) - 1);
}

/**
 * Picks up to `shortlistLimit` Stage-1 candidate moves whose drop is in or near
 * `[minDropCp, maxDropCp]` so Stage 2 can verify them at higher depth via `searchmoves`.
 */
function selectStage1Shortlist({
  stage1Lines,
  sideToMove,
  minDropCp = 25,
  maxDropCp = 85,
  shortlistLimit = 4,
}) {
  const valid = (Array.isArray(stage1Lines) ? stage1Lines : [])
    .filter((line) => line && line.bestmove)
    .sort((a, b) => (a.multipv || 999) - (b.multipv || 999));

  if (!valid.length) {
    return { bestLine: null, bestScore: null, shortlist: [], reason: 'no_moves' };
  }

  const bestLine = valid[0];
  const bestScore = getMoverCpFromSnapshot(bestLine, sideToMove);
  if (!bestScore || bestScore.type !== 'cp') {
    return {
      bestLine,
      bestScore,
      shortlist: [],
      reason: bestScore?.type === 'mate' ? 'mate_position' : 'no_score',
    };
  }

  const looseMin = Math.max(10, minDropCp - 20);
  const looseMax = maxDropCp + 40;
  const targetMid = (minDropCp + maxDropCp) / 2;

  const candidates = [];
  const seenMoves = new Set([bestLine.bestmove]);

  for (let i = 1; i < valid.length; i++) {
    const line = valid[i];
    if (!line.bestmove || seenMoves.has(line.bestmove)) continue;
    seenMoves.add(line.bestmove);

    const score = getMoverCpFromSnapshot(line, sideToMove);
    if (!score || score.type !== 'cp') continue; // Reject mate lines/blunders

    const dropCp = bestScore.cp - score.cp;
    if (dropCp >= looseMin && dropCp <= looseMax) {
      candidates.push({
        move: line.bestmove,
        dropCp,
        distToMid: Math.abs(dropCp - targetMid),
        line,
      });
    }
  }

  // Prefer moves already inside strict band, then closest to target range
  candidates.sort((a, b) => {
    const aIn = a.dropCp >= minDropCp && a.dropCp <= maxDropCp ? 0 : 1;
    const bIn = b.dropCp >= minDropCp && b.dropCp <= maxDropCp ? 0 : 1;
    if (aIn !== bIn) return aIn - bIn;
    return a.dropCp - b.dropCp;
  });

  const shortlist = candidates.slice(0, shortlistLimit).map((c) => c.move);
  let reason = 'ok';
  if (!shortlist.length) {
    if (valid.length <= 1) reason = 'only_move';
    else {
      const secondScore = getMoverCpFromSnapshot(valid[1], sideToMove);
      const secondDrop =
        secondScore && secondScore.type === 'cp' ? bestScore.cp - secondScore.cp : null;
      reason = secondDrop !== null && secondDrop > maxDropCp ? 'forced_best_move' : 'no_match_in_range';
    }
  }

  return { bestLine, bestScore, shortlist, reason };
}

/**
 * Applies strict `[minDropCp, maxDropCp]` filtering on verified Stage-2 MultiPV results.
 */
function evaluateSoftMistakeCandidates({
  lines,
  bestMoveHint = null,
  sideToMove,
  minDropCp = 25,
  maxDropCp = 85,
  maxResults = 3,
}) {
  const valid = (Array.isArray(lines) ? lines : [])
    .filter((line) => line && line.bestmove)
    .sort((a, b) => (a.multipv || 999) - (b.multipv || 999));

  if (!valid.length) {
    return { bestMove: bestMoveHint, bestEvalCp: null, candidates: [], reason: 'no_moves' };
  }

  // Anchor against best line (multipv #1 or bestMoveHint if it scored higher)
  let anchorLine = valid[0];
  let anchorScore = getMoverCpFromSnapshot(anchorLine, sideToMove);
  if (bestMoveHint) {
    const hinted = valid.find((l) => l.bestmove === bestMoveHint);
    const hintedScore = getMoverCpFromSnapshot(hinted, sideToMove);
    if (
      hinted &&
      hintedScore?.type === 'cp' &&
      anchorScore?.type === 'cp' &&
      hintedScore.cp >= anchorScore.cp
    ) {
      anchorLine = hinted;
      anchorScore = hintedScore;
    }
  }

  if (!anchorScore || anchorScore.type !== 'cp') {
    return {
      bestMove: anchorLine.bestmove || bestMoveHint,
      bestEvalCp: null,
      candidates: [],
      reason: anchorScore?.type === 'mate' ? 'mate_position' : 'no_score',
    };
  }

  const bestWinPct = computeWinPercentFromWhiteCp(anchorScore.whiteCp);
  const black = isBlackSide(sideToMove);
  const matches = [];
  const seen = new Set([anchorLine.bestmove]);

  for (const line of valid) {
    if (!line.bestmove || seen.has(line.bestmove)) continue;
    seen.add(line.bestmove);

    const score = getMoverCpFromSnapshot(line, sideToMove);
    if (!score || score.type !== 'cp') continue;

    const dropCp = Math.round(anchorScore.cp - score.cp);
    if (dropCp < minDropCp || dropCp > maxDropCp) continue;

    const moveWinPct = computeWinPercentFromWhiteCp(score.whiteCp);
    let winDropPct = null;
    if (bestWinPct !== null && moveWinPct !== null) {
      const bestMoverWin = black ? 100 - bestWinPct : bestWinPct;
      const moveMoverWin = black ? 100 - moveWinPct : moveWinPct;
      winDropPct = Number(Math.max(0, bestMoverWin - moveMoverWin).toFixed(1));
    }

    matches.push({
      move: line.bestmove,
      dropCp,
      dropPawns: Number((dropCp / 100).toFixed(2)),
      evalCp: score.whiteCp,
      evalPawns: Number((score.whiteCp / 100).toFixed(2)),
      winDropPct,
      depth: line.depth || 0,
      pv: Array.isArray(line.pv) ? line.pv.slice(0, 6) : [line.bestmove],
    });
  }

  matches.sort((a, b) => a.dropCp - b.dropCp);

  return {
    bestMove: anchorLine.bestmove,
    bestEvalCp: anchorScore.whiteCp,
    bestEvalPawns: Number((anchorScore.whiteCp / 100).toFixed(2)),
    candidates: matches.slice(0, maxResults),
    reason: matches.length ? 'ok' : 'no_match_in_range',
  };
}

/**
 * Orchestrates Stage 1 (MultiPV 24 @ depth 7) -> Stage 2 (`searchmoves` @ depth 10).
 */
async function runSoftMistakeScan({
  fen,
  sideToMove,
  minDropCp = 25,
  maxDropCp = 85,
  maxResults = 3,
  stage1Depth = 7,
  stage2Depth = 10,
  multiPvLimit = 24,
  runMultiPv,
}) {
  const stage1 = await runMultiPv({
    fen,
    sideToMove,
    targetDepth: stage1Depth,
    multiPv: multiPvLimit,
    searchMoves: null,
  });

  if (stage1?.terminal) {
    return {
      bestMove: null,
      bestEvalCp: null,
      bestEvalPawns: null,
      candidates: [],
      stage1Count: 0,
      stage2Verified: false,
      reason: 'terminal',
    };
  }

  const stage1Lines = stage1?.lines || [];
  const { bestLine, bestScore, shortlist, reason } = selectStage1Shortlist({
    stage1Lines,
    sideToMove,
    minDropCp,
    maxDropCp,
    shortlistLimit: Math.max(4, maxResults + 1),
  });

  if (!shortlist.length) {
    return {
      bestMove: bestLine?.bestmove || stage1?.bestmove || null,
      bestEvalCp: bestScore?.whiteCp ?? null,
      bestEvalPawns:
        bestScore?.whiteCp !== null && bestScore?.whiteCp !== undefined
          ? Number((bestScore.whiteCp / 100).toFixed(2))
          : null,
      candidates: [],
      stage1Count: stage1Lines.length,
      stage2Verified: false,
      reason,
    };
  }

  const searchMoves = [bestLine.bestmove, ...shortlist];
  const stage2 = await runMultiPv({
    fen,
    sideToMove,
    targetDepth: stage2Depth,
    multiPv: searchMoves.length,
    searchMoves,
  });

  const evaluated = evaluateSoftMistakeCandidates({
    lines: stage2?.lines || [],
    bestMoveHint: bestLine.bestmove,
    sideToMove,
    minDropCp,
    maxDropCp,
    maxResults,
  });

  return {
    ...evaluated,
    stage1Count: stage1Lines.length,
    stage2Verified: true,
  };
}

module.exports = {
  selectStage1Shortlist,
  evaluateSoftMistakeCandidates,
  runSoftMistakeScan,
};
