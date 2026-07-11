import React, { useState } from 'react';
import { GameMode, Difficulty } from '../game/storage';
import { Player } from '../game/types';

interface Props {
  difficulty: Difficulty;
  onStart: (mode: GameMode, playerColor: Player) => void;
  onBack: () => void;
}

export default function SetupScreen({ difficulty, onStart, onBack }: Props) {
  const [color, setColor] = useState<Player>('red');
  const [mode, setMode] = useState<GameMode>('pvp');

  const diffLabel = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

  return (
    <div className="landing">
      <div className="landing-bg" />
      <div className="landing-content setup-content">
        <h2 className="setup-title">Game Setup</h2>

        <div className="setup-section">
          <label className="setup-label">Your Color</label>
          <div className="setup-options">
            <button
              className={`setup-opt ${color === 'red' ? 'on' : ''}`}
              onClick={() => setColor('red')}
            >
              <span className="setup-swatch red" />
              Red
            </button>
            <button
              className={`setup-opt ${color === 'black' ? 'on' : ''}`}
              onClick={() => setColor('black')}
            >
              <span className="setup-swatch black" />
              Black
            </button>
          </div>
        </div>

        <div className="setup-section">
          <label className="setup-label">Mode</label>
          <div className="setup-options">
            <button
              className={`setup-opt ${mode === 'pvp' ? 'on' : ''}`}
              onClick={() => setMode('pvp')}
            >
              Pass &amp; Play
            </button>
            <button
              className={`setup-opt ${mode === 'pvc' ? 'on' : ''}`}
              onClick={() => setMode('pvc')}
            >
              vs CPU
            </button>
          </div>
          {mode === 'pvc' && (
            <p className="setup-hint">
              CPU difficulty: <strong>{diffLabel[difficulty]}</strong>
            </p>
          )}
        </div>

        <div className="setup-actions">
          <button className="landing-btn primary" onClick={() => onStart(mode, color)}>
            Start Game
          </button>
          <button className="landing-btn secondary" onClick={onBack}>
            Back
          </button>
        </div>
      </div>
    </div>
  );
}
