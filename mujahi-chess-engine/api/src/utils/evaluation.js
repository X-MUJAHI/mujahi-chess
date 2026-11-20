'use strict';

/**
 * Converts a Stockfish UCI score (always reported from the side-to-move's POV)
 * into a White-perspective evaluation object without ever mixing mate and cp scores.
 */
function normalizeEvaluation({ type, rawScore, bound = 'exact', sideToMove = 'white' }) {
  if (!type || !Number.isFinite(rawScore)) {
    return {
      evaluation: null,
      mate: null,
    };
  }

  const isBlackToMove = sideToMove === 'black' || sideToMove === 'b';
  const povFactor = isBlackToMove ? -1 : 1;

  if (type === 'mate') {
    const normalizedMate = rawScore === 0 ? 0 : rawScore * povFactor;
    return {
      evaluation: {
        type: 'mate',
        value: normalizedMate,
        perspective: 'white',
        bound,
      },
      mate: normalizedMate,
    };
  }

  if (type === 'cp') {
    const rawCpWhite = rawScore * povFactor;
    const pawnValue = Number((rawCpWhite / 100).toFixed(2));
    return {
      evaluation: {
        type: 'cp',
        value: Object.is(pawnValue, -0) ? 0 : pawnValue,
        rawCp: Object.is(rawCpWhite, -0) ? 0 : rawCpWhite,
        perspective: 'white',
        bound,
      },
      mate: null,
    };
  }

  return {
    evaluation: null,
    mate: null,
  };
}

module.exports = {
  normalizeEvaluation,
};
