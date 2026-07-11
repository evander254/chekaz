import { Board, Move, Player } from './types';
import { getAllMoves, cloneBoard, makeMove } from './GameEngine';
import { Difficulty } from './storage';

function evaluateBoard(board: Board, cpuPlayer: Player): number {
  let score = 0;
  const opponent: Player = cpuPlayer === 'red' ? 'black' : 'red';

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece) continue;

      const base = piece.type === 'king' ? 3 : 1;
      const center = c >= 2 && c <= 5 ? 0.15 : 0;
      const advance = cpuPlayer === 'red' ? (7 - r) * 0.05 : r * 0.05;

      if (piece.player === cpuPlayer) {
        score += base + center + advance;
      } else {
        score -= base + center + advance;
      }
    }
  }

  return score;
}

function minimax(board: Board, depth: number, isMax: boolean, cpu: Player): number {
  if (depth === 0) return evaluateBoard(board, cpu);

  const player = isMax ? cpu : (cpu === 'red' ? 'black' : 'red');
  const moves = getAllMoves(board, player);
  if (moves.length === 0) return isMax ? -999 : 999;

  if (isMax) {
    let best = -Infinity;
    for (const m of moves) {
      const nb = cloneBoard(board);
      makeMove(nb, m);
      best = Math.max(best, minimax(nb, depth - 1, false, cpu));
    }
    return best;
  } else {
    let best = Infinity;
    for (const m of moves) {
      const nb = cloneBoard(board);
      makeMove(nb, m);
      best = Math.min(best, minimax(nb, depth - 1, true, cpu));
    }
    return best;
  }
}

function hardMove(board: Board, cpu: Player): Move {
  const moves = getAllMoves(board, cpu);
  if (moves.length === 1) return moves[0];
  let bestMove = moves[0];
  let bestScore = -Infinity;
  for (const m of moves) {
    const nb = cloneBoard(board);
    makeMove(nb, m);
    const s = minimax(nb, 3, false, cpu);
    if (s > bestScore) { bestScore = s; bestMove = m; }
  }
  return bestMove;
}

function mediumMove(board: Board, cpu: Player): Move {
  const moves = getAllMoves(board, cpu);
  const captures = moves.filter(m => m.captured);
  if (captures.length > 0) return captures[Math.floor(Math.random() * captures.length)];
  const dir = cpu === 'red' ? 1 : -1;
  const forward = moves.filter(m => (m.to.row - m.from.row) * dir > 0);
  if (forward.length > 0) return forward[Math.floor(Math.random() * forward.length)];
  return moves[Math.floor(Math.random() * moves.length)];
}

export function getCpuMove(board: Board, cpuPlayer: Player, difficulty: Difficulty): Move {
  const moves = getAllMoves(board, cpuPlayer);
  if (moves.length === 0) throw new Error('No moves');
  if (moves.length === 1) return moves[0];

  switch (difficulty) {
    case 'easy':
      return moves[Math.floor(Math.random() * moves.length)];
    case 'medium':
      return mediumMove(board, cpuPlayer);
    case 'hard':
      return hardMove(board, cpuPlayer);
  }
}
