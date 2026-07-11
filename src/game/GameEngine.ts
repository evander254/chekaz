import { Board, Piece, PieceType, Player, Position, Move } from './types';

export function createInitialBoard(): Board {
  const board: Board = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 8; c++) {
      if ((r + c) % 2 === 1) board[r][c] = { id: `b${r}${c}`, player: 'black', type: 'man' };
    }
  }
  for (let r = 5; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if ((r + c) % 2 === 1) board[r][c] = { id: `r${r}${c}`, player: 'red', type: 'man' };
    }
  }
  return board;
}

export function cloneBoard(board: Board): Board {
  return board.map(row => row.map(cell => (cell ? { ...cell } : null)));
}

function getDirections(piece: Piece): [number, number][] {
  if (piece.type === 'king') return [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  return piece.player === 'red' ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]];
}

export function getMovesForPiece(board: Board, pos: Position): Move[] {
  const piece = board[pos.row][pos.col];
  if (!piece) return [];
  const dirs = getDirections(piece);
  const simple: Move[] = [];
  const captures: Move[] = [];
  for (const [dr, dc] of dirs) {
    const nr = pos.row + dr;
    const nc = pos.col + dc;
    if (nr < 0 || nr > 7 || nc < 0 || nc > 7) continue;
    const target = board[nr][nc];
    if (!target) {
      simple.push({ from: pos, to: { row: nr, col: nc }, captured: null, player: piece.player, promoted: false });
    } else if (target.player !== piece.player) {
      const jr = nr + dr;
      const jc = nc + dc;
      if (jr >= 0 && jr <= 7 && jc >= 0 && jc <= 7 && !board[jr][jc]) {
        captures.push({ from: pos, to: { row: jr, col: jc }, captured: { row: nr, col: nc }, player: piece.player, promoted: false });
      }
    }
  }
  return captures.length > 0 ? captures : simple;
}

export function getAllMoves(board: Board, player: Player): Move[] {
  const all: Move[] = [];
  let hasCapture = false;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p && p.player === player) {
        const moves = getMovesForPiece(board, { row: r, col: c });
        for (const m of moves) {
          if (m.captured) hasCapture = true;
          all.push(m);
        }
      }
    }
  }
  return hasCapture ? all.filter(m => m.captured) : all;
}

export function makeMove(board: Board, move: Move): PieceType | null {
  const piece = board[move.from.row][move.from.col];
  if (!piece) throw new Error('No piece at source');
  board[move.to.row][move.to.col] = piece;
  board[move.from.row][move.from.col] = null;
  if (move.captured) board[move.captured.row][move.captured.col] = null;
  if (piece.type === 'man') {
    if ((piece.player === 'red' && move.to.row === 0) || (piece.player === 'black' && move.to.row === 7)) {
      board[move.to.row][move.to.col] = { ...piece, type: 'king' };
      move.promoted = true;
      return 'king';
    }
  }
  return null;
}

export function checkGameOver(board: Board, nextPlayer: Player): { over: boolean; winner: Player | null } {
  let red = 0, black = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p) p.player === 'red' ? red++ : black++;
    }
  }
  if (red === 0) return { over: true, winner: 'black' };
  if (black === 0) return { over: true, winner: 'red' };
  if (!hasAnyMoves(board, nextPlayer)) return { over: true, winner: nextPlayer === 'red' ? 'black' : 'red' };
  return { over: false, winner: null };
}

export function hasAnyMoves(board: Board, player: Player): boolean {
  return getAllMoves(board, player).length > 0;
}

export function getStats(board: Board) {
  let redPieces = 0, blackPieces = 0, redKings = 0, blackKings = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p) {
        if (p.player === 'red') { redPieces++; if (p.type === 'king') redKings++; }
        else { blackPieces++; if (p.type === 'king') blackKings++; }
      }
    }
  }
  return { redPieces, blackPieces, redKings, blackKings };
}
