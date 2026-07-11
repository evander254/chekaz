export type Player = 'red' | 'black';
export type PieceType = 'man' | 'king';

export interface Piece {
  id: string;
  player: Player;
  type: PieceType;
}

export interface Position {
  row: number;
  col: number;
}

export interface Move {
  from: Position;
  to: Position;
  captured: Position | null;
  player: Player;
  promoted: boolean;
}

export type Board = (Piece | null)[][];
