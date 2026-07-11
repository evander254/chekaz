import React from 'react';
import { Difficulty, BoardTheme, BoardCss, ScreenMode } from '../game/storage';
import defaultThumb from '../assets/themes/default.png';
import theme1Thumb from '../assets/themes/theme1.png';
import theme2Thumb from '../assets/themes/theme2.png';

interface Props {
  difficulty: Difficulty;
  boardTheme: BoardTheme;
  boardCss: BoardCss;
  screenMode: ScreenMode;
  onChangeDifficulty: (d: Difficulty) => void;
  onChangeTheme: (t: BoardTheme) => void;
  onChangeCss: (c: BoardCss) => void;
  onChangeScreenMode: (m: ScreenMode) => void;
  onBack: () => void;
}

const levels: { key: Difficulty; label: string; desc: string }[] = [
  { key: 'easy', label: 'Easy', desc: 'Makes random moves' },
  { key: 'medium', label: 'Medium', desc: 'Prefers captures & forward moves' },
  { key: 'hard', label: 'Hard', desc: 'Uses advanced strategy (slow)' },
];

const themes: { key: BoardTheme; label: string; thumb: string }[] = [
  { key: 'default', label: 'Classic', thumb: defaultThumb },
  { key: 'theme1', label: 'Theme 1', thumb: theme1Thumb },
  { key: 'theme2', label: 'Theme 2', thumb: theme2Thumb },
];

const cssStyles: { key: BoardCss; label: string; desc: string }[] = [
  { key: 'skeuomorphism', label: 'Skeuomorphism', desc: 'Realistic 3D textures & shadows' },
  { key: 'neumorphism', label: 'Neumorphism', desc: 'Soft extruded surfaces' },
  { key: 'glassmorphism', label: 'Glassmorphism', desc: 'Frosted glass effect' },
];

const screenModes: { key: ScreenMode; label: string; desc: string }[] = [
  { key: 'windowed', label: 'Windowed', desc: 'Default browser window' },
  { key: 'fullscreen', label: 'Fullscreen', desc: 'Expand to fill the screen' },
];

export default function SettingsScreen({ difficulty, boardTheme, boardCss, screenMode, onChangeDifficulty, onChangeTheme, onChangeCss, onChangeScreenMode, onBack }: Props) {
  return (
    <div className="set-root">
      <div className="set-overlay" />
      <div className="set-panel">
        <h1 className="set-title">Settings</h1>
        <div className="set-divider">&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500; &#x25C7; &#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;</div>

        {/* ── Gameplay ── */}
        <section className="set-section">
          <h2 className="set-section-title"><span className="set-icon">&#9880;</span> Gameplay</h2>
          <div className="set-cards">
            {levels.map(l => (
              <button
                key={l.key}
                className={`set-card ${difficulty === l.key ? 'on' : ''}`}
                onClick={() => onChangeDifficulty(l.key)}
              >
                <span className="set-card-radio">
                  {difficulty === l.key && <span className="set-card-radio-dot" />}
                </span>
                <span className="set-card-body">
                  <span className="set-card-label">{l.label}</span>
                  <span className="set-card-desc">{l.desc}</span>
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* ── Appearance ── */}
        <section className="set-section">
          <h2 className="set-section-title"><span className="set-icon">&#127912;</span> Appearance</h2>

          <h3 className="set-sub-title">Board Background</h3>
          <div className="set-theme-grid">
            {themes.map(t => (
              <button
                key={t.key}
                className={`set-theme-card ${boardTheme === t.key ? 'on' : ''}`}
                onClick={() => onChangeTheme(t.key)}
              >
                <span className="set-theme-thumb" style={{ backgroundImage: `url(${t.thumb})` }} />
                {boardTheme === t.key && <span className="set-theme-badge">&#10003;</span>}
                <span className="set-theme-name">{t.label}</span>
              </button>
            ))}
          </div>

          <h3 className="set-sub-title">Board Style</h3>
          <div className="set-cards">
            {cssStyles.map(s => (
              <button
                key={s.key}
                className={`set-card ${boardCss === s.key ? 'on' : ''}`}
                onClick={() => onChangeCss(s.key)}
              >
                <span className="set-card-radio">
                  {boardCss === s.key && <span className="set-card-radio-dot" />}
                </span>
                <span className="set-card-body">
                  <span className="set-card-label">{s.label}</span>
                  <span className="set-card-desc">{s.desc}</span>
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* ── Display ── */}
        <section className="set-section">
          <h2 className="set-section-title"><span className="set-icon">&#128421;</span> Display</h2>
          <div className="set-cards">
            {screenModes.map(m => (
              <button
                key={m.key}
                className={`set-card ${screenMode === m.key ? 'on' : ''}`}
                onClick={() => onChangeScreenMode(m.key)}
              >
                <span className="set-card-radio">
                  {screenMode === m.key && <span className="set-card-radio-dot" />}
                </span>
                <span className="set-card-body">
                  <span className="set-card-label">{m.label}</span>
                  <span className="set-card-desc">{m.desc}</span>
                </span>
              </button>
            ))}
          </div>
        </section>

        <div className="set-actions">
          <button className="set-btn" onClick={onBack}>
            <span className="set-btn-icon">&#8592;</span> Back
          </button>
        </div>
      </div>
    </div>
  );
}
