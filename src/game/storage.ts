import { Board, Player, Position, Move } from './types';

export type Difficulty = 'easy' | 'medium' | 'hard';
export type GameMode = 'pvp' | 'pvc';
export type BoardTheme = 'default' | 'theme1' | 'theme2';
export type BoardCss = 'skeuomorphism' | 'neumorphism' | 'glassmorphism';
export type ScreenMode = 'windowed' | 'fullscreen';

export interface GameStats {
  totalGames: number;
  redWins: number;
  blackWins: number;
  draws: number;
  totalMoves: number;
  lastPlayed: string | null;
}

export interface AppSettings {
  cpuDifficulty: Difficulty;
  renderMode: '2d' | '3d';
  boardTheme: BoardTheme;
  boardCss: BoardCss;
  screenMode: ScreenMode;
}

export interface SavedGame {
  board: Board;
  currentPlayer: Player;
  moveHistory: Move[];
  jumpChain: Position | null;
  gameOver: boolean;
  winner: Player | null;
  message: string;
  mode: GameMode;
  playerColor: Player;
  timestamp: number;
}

const STATS_KEY = 'chekaz_stats';
const GAME_KEY = 'chekaz_game';
const SETTINGS_KEY = 'chekaz_settings';

export function loadStats(): GameStats {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { totalGames: 0, redWins: 0, blackWins: 0, draws: 0, totalMoves: 0, lastPlayed: null };
}

export function saveStats(stats: GameStats): void {
  try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch {}
}

export function loadGame(): SavedGame | null {
  try {
    const raw = localStorage.getItem(GAME_KEY);
    if (raw) {
      const g = JSON.parse(raw);
      if (g && g.board && g.currentPlayer) return g;
    }
  } catch {}
  return null;
}

export function saveGame(state: SavedGame): void {
  try { localStorage.setItem(GAME_KEY, JSON.stringify(state)); } catch {}
}

export function clearGame(): void {
  try { localStorage.removeItem(GAME_KEY); } catch {}
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { cpuDifficulty: 'medium', renderMode: '3d', boardTheme: 'default', boardCss: 'skeuomorphism', screenMode: 'windowed' };
}

export function saveSettings(settings: AppSettings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
}
