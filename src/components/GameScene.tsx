import React, { useRef, useMemo, useEffect, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Board, Position, Move, Piece } from '../game/types';

const BOARD_SIZE = 8;
const HALF = BOARD_SIZE / 2;
const SQ_SIZE = 0.94;
const PIECE_R = 0.34;
const PIECE_H = 0.26;

// ─── Wood texture generation ───

function seededRand(seed: number) {
  let s = seed;
  return () => { s = (s * 16807 + 0) % 2147483647; return (s - 1) / 2147483646; };
}

function makeWoodTexture(
  baseR: number, baseG: number, baseB: number,
  grainR: number, grainG: number, grainB: number,
  w: number, h: number, seed: number,
  grainScale = 1, amp = 1,
  contrast = 0.08,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const rng = seededRand(seed);
  const noise: number[] = [];
  for (let i = 0; i < w * h; i++) noise.push(rng());

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x);
      const ny = y / h * grainScale;
      const nx = x / w * grainScale;

      const g1 = Math.sin(ny * 10 + Math.sin(nx * 4) * 2) * 0.5 + 0.5;
      const g2 = Math.sin(ny * 20 + Math.sin(nx * 6 + 1.3) * 1.5) * 0.5 + 0.5;
      const g3 = Math.sin(ny * 4 + Math.sin(nx * 2) * 4.5) * 0.5 + 0.5;
      const grain = (g1 * 0.5 + g2 * 0.3 + g3 * 0.2) * amp + (noise[i] - 0.5) * contrast;

      const idx = i * 4;
      d[idx]     = Math.max(0, Math.min(255, baseR + (grainR - baseR) * grain));
      d[idx + 1] = Math.max(0, Math.min(255, baseG + (grainG - baseG) * grain));
      d[idx + 2] = Math.max(0, Math.min(255, baseB + (grainB - baseB) * grain));
      d[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

// Texture definitions
const lightWoodTex = makeWoodTexture(216, 188, 141, 200, 168, 112, 128, 128, 42, 1, 0.7, 0.06);
const darkWoodTex  = makeWoodTexture(58, 42, 34, 48, 32, 24, 128, 128, 77, 1.2, 0.9, 0.07);
const frameWoodTex = makeWoodTexture(74, 52, 37, 60, 40, 26, 128, 128, 31, 0.6, 1.1, 0.09);
const tableWoodTex = makeWoodTexture(50, 36, 26, 65, 48, 34, 256, 256, 13, 2.5, 0.6, 0.05);

// ─── Materials ───

function sqMat(baseTex: THREE.Texture, isDark: boolean) {
  const m = new THREE.MeshStandardMaterial({
    map: baseTex.clone(),
    roughness: isDark ? 0.45 : 0.5,
    metalness: 0.01,
    envMapIntensity: 0.2,
  });
  if (m.map) {
    m.map.rotation = (Math.random() - 0.5) * Math.PI;
    m.map.needsUpdate = true;
  }
  return m;
}

const tableMat = new THREE.MeshStandardMaterial({
  map: tableWoodTex,
  roughness: 0.3,
  metalness: 0.05,
  envMapIntensity: 0.3,
});

const frameMat = new THREE.MeshStandardMaterial({
  color: '#4A3425',
  roughness: 0.5,
  metalness: 0.05,
  envMapIntensity: 0.2,
});

const frameInnerMat = new THREE.MeshStandardMaterial({
  color: '#3a2618',
  roughness: 0.7,
  metalness: 0.01,
});

const redPieceMat = new THREE.MeshStandardMaterial({
  color: '#7C2A28',
  roughness: 0.3,
  metalness: 0.15,
  envMapIntensity: 0.5,
});

const blackPieceMat = new THREE.MeshStandardMaterial({
  color: '#2B2A2A',
  roughness: 0.55,
  metalness: 0.2,
  envMapIntensity: 0.3,
});

// ─── Piece geometry ───

function pieceProfile(): THREE.Vector2[] {
  const r = PIECE_R;
  const h = PIECE_H;
  return [
    new THREE.Vector2(0.001, 0),
    new THREE.Vector2(r * 1.035, 0),
    new THREE.Vector2(r * 1.035, 0.008),
    new THREE.Vector2(r, 0.018),
    new THREE.Vector2(r, h - 0.04),
    new THREE.Vector2(r * 0.97, h - 0.015),
    new THREE.Vector2(r * 0.94, h - 0.005),
    new THREE.Vector2(r * 0.92, h),
    new THREE.Vector2(r * 0.74, h),
    new THREE.Vector2(r * 0.68, h - 0.005),
    new THREE.Vector2(r * 0.68, h - 0.01),
    new THREE.Vector2(r * 0.65, h - 0.01),
    new THREE.Vector2(r * 0.65, h),
    new THREE.Vector2(r * 0.44, h),
    new THREE.Vector2(r * 0.38, h - 0.005),
    new THREE.Vector2(r * 0.38, h - 0.01),
    new THREE.Vector2(r * 0.35, h - 0.01),
    new THREE.Vector2(r * 0.35, h),
    new THREE.Vector2(0.001, h),
  ];
}

const latheGeom = new THREE.LatheGeometry(pieceProfile(), 36);

function gridToWorld(row: number, col: number): [number, number, number] {
  return [col - HALF + 0.5, 0, row - HALF + 0.5];
}

// ─── Corner ornament ───

function CornerOrnament({ position, rotation }: { position: [number, number, number]; rotation: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {/* Central diamond */}
      <mesh position={[0, 0.04, 0]}>
        <octahedronGeometry args={[0.06, 0]} />
        <meshStandardMaterial color="#3a2218" roughness={0.6} metalness={0.1} />
      </mesh>
      {/* Side leaves */}
      {[-1, 1].map(side => (
        <mesh key={side} position={[side * 0.07, 0.02, 0]} rotation={[0, 0, side * 0.3]}>
          <sphereGeometry args={[0.035, 6, 6]} scale={[1, 0.4, 0.6]} />
          <meshStandardMaterial color="#4A3425" roughness={0.5} metalness={0.05} />
        </mesh>
      ))}
    </group>
  );
}

// ─── Board Square ───

function BoardSquare({
  row, col, isDark, isHighlighted, isCapture, onClick,
}: {
  row: number; col: number; isDark: boolean; isHighlighted: boolean; isCapture: boolean;
  onClick: () => void;
}) {
  const [x, , z] = gridToWorld(row, col);
  const mat = useMemo(() => sqMat(isDark ? darkWoodTex : lightWoodTex, isDark), [isDark]);

  return (
    <>
      {isHighlighted && (
        <mesh position={[x, 0.012, z]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[SQ_SIZE, SQ_SIZE]} />
          <meshBasicMaterial
            color={isCapture ? '#d44' : '#FFD45C'}
            transparent
            opacity={0.18}
          />
        </mesh>
      )}
      <mesh
        position={[x, 0.008, z]}
        rotation={[-Math.PI / 2, 0, 0]}
        material={mat}
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        onPointerDown={(e) => { e.stopPropagation(); onClick(); }}
      >
        <planeGeometry args={[SQ_SIZE, SQ_SIZE]} />
      </mesh>
    </>
  );
}

// ─── Valid Move Indicator ───

function MoveDot({ row, col }: { row: number; col: number }) {
  const [x, , z] = gridToWorld(row, col);
  return (
    <>
      {/* Glow */}
      <mesh position={[x, 0.014, z]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[SQ_SIZE * 0.11, 24]} />
        <meshBasicMaterial color="#FFD45C" transparent opacity={0.15} depthWrite={false} />
      </mesh>
      {/* Dot */}
      <mesh position={[x, 0.015, z]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[SQ_SIZE * 0.08, 20]} />
        <meshBasicMaterial color="#FFD45C" transparent opacity={0.55} depthWrite={false} />
      </mesh>
    </>
  );
}

// ─── Checker Piece ───

function CheckerPiece({
  piece, row, col, isSelected, onClick,
}: {
  piece: Piece; row: number; col: number; isSelected: boolean;
  onClick: () => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const glowRef1 = useRef<THREE.Mesh>(null);
  const glowRef2 = useRef<THREE.Mesh>(null);
  const glowRef3 = useRef<THREE.Mesh>(null);
  const shadowRef = useRef<THREE.Mesh>(null);

  const targetPos = useMemo(() => {
    const [x, , z] = gridToWorld(row, col);
    return new THREE.Vector3(x, PIECE_H / 2 + 0.018, z);
  }, [row, col]);

  const currentPos = useRef(targetPos.clone());

  useEffect(() => {
    currentPos.current.copy(targetPos);
    const setPos = (p: THREE.Vector3) => {
      if (meshRef.current) meshRef.current.position.copy(p);
      if (shadowRef.current) shadowRef.current.position.set(p.x, 0.006, p.z);
      if (glowRef1.current) glowRef1.current.position.set(p.x, 0.012, p.z);
      if (glowRef2.current) glowRef2.current.position.set(p.x, 0.010, p.z);
      if (glowRef3.current) glowRef3.current.position.set(p.x, 0.008, p.z);
    };
    setPos(targetPos);
  }, []);

  useFrame((_, delta) => {
    if (meshRef.current) {
      currentPos.current.lerp(targetPos, delta * 12);
      const p = currentPos.current;
      meshRef.current.position.copy(p);
      if (shadowRef.current) shadowRef.current.position.set(p.x, 0.006, p.z);
      if (glowRef1.current) glowRef1.current.position.set(p.x, 0.012, p.z);
      if (glowRef2.current) glowRef2.current.position.set(p.x, 0.010, p.z);
      if (glowRef3.current) glowRef3.current.position.set(p.x, 0.008, p.z);
    }
  });

  const mat = piece.player === 'red' ? redPieceMat : blackPieceMat;

  return (
    <>
      {/* Contact shadow */}
      <mesh ref={shadowRef} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[PIECE_R * 1.2, 28]} />
        <meshBasicMaterial color="#000" transparent opacity={0.35} depthWrite={false} />
      </mesh>

      {/* Selection glow — 3 layers */}
      {isSelected && (
        <>
          {/* Inner bright ring */}
          <mesh ref={glowRef1} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[PIECE_R * 0.85, PIECE_R * 1.2, 48]} />
            <meshBasicMaterial color="#FFD45C" transparent opacity={0.55} />
          </mesh>
          {/* Soft outer bloom */}
          <mesh ref={glowRef2} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[PIECE_R * 0.9, PIECE_R * 1.6, 48]} />
            <meshBasicMaterial color="#FFD45C" transparent opacity={0.25} />
          </mesh>
          {/* Faint secondary */}
          <mesh ref={glowRef3} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[PIECE_R * 0.95, PIECE_R * 2.2, 48]} />
            <meshBasicMaterial color="#FFD45C" transparent opacity={0.10} />
          </mesh>
        </>
      )}

      {/* Piece body */}
      <mesh
        ref={meshRef}
        geometry={latheGeom}
        material={mat}
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        onPointerDown={(e) => { e.stopPropagation(); onClick(); }}
        castShadow
        receiveShadow
      />
    </>
  );
}

// ─── Main Scene ───

export default function GameScene({
  board, selected, validMoves, onPieceClick, onSquareClick, playerColor,
}: {
  board: Board; selected: Position | null; validMoves: Move[];
  onPieceClick: (pos: Position) => void;
  onSquareClick: (pos: Position) => void;
  playerColor?: 'red' | 'black';
}) {
  const { camera: cam, size } = useThree();
  const camera = cam as THREE.PerspectiveCamera;
  const [scale, setScale] = useState(0.7);

  useEffect(() => {
    const aspect = size.width / size.height;

    if (aspect < 0.5) {
      camera.position.set(0, 10, 1.8);
      camera.fov = 50;
    } else if (aspect < 0.6) {
      camera.position.set(0, 9, 3);
      camera.fov = 46;
    } else if (aspect < 0.85) {
      camera.position.set(0, 8.5, 4.5);
      camera.fov = 42;
    } else if (aspect < 1.3) {
      camera.position.set(0, 7.5, 6);
      camera.fov = 38;
    } else {
      camera.position.set(0, 6.5, 7);
      camera.fov = 34;
    }

    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();

    const halfBoard = (BOARD_SIZE + 0.5) / 2;
    const corners = [
      new THREE.Vector3(-halfBoard, 0, -halfBoard),
      new THREE.Vector3( halfBoard, 0, -halfBoard),
      new THREE.Vector3(-halfBoard, 0,  halfBoard),
      new THREE.Vector3( halfBoard, 0,  halfBoard),
    ];
    let maxNdc = 0;
    const vec = new THREE.Vector3();
    for (const c of corners) {
      vec.copy(c).project(camera);
      maxNdc = Math.max(maxNdc, Math.abs(vec.x), Math.abs(vec.y));
    }
    setScale(maxNdc > 0 ? 0.85 / maxNdc : 0.7);
  }, [camera, size.width, size.height]);

  const validSet = useMemo(
    () => new Set(validMoves.map(m => `${m.to.row},${m.to.col}`)),
    [validMoves],
  );
  const captureSet = useMemo(
    () => new Set(validMoves.filter(m => m.captured).map(m => `${m.to.row},${m.to.col}`)),
    [validMoves],
  );

  return (
    <>
      {/* Lighting — warm desk lamp from upper-right */}
      <ambientLight intensity={0.2} color="#ffddbb" />
      <directionalLight
        position={[8, 14, 10]}
        intensity={1.8}
        color="#ffecd5"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.001}
      />
      <directionalLight position={[-5, 6, -6]} intensity={0.15} color="#8899aa" />
      <directionalLight position={[0, 3, -10]} intensity={0.12} color="#ccd4dc" />
      <hemisphereLight args={['#d4c0a8', '#1a0e06', 0.25]} />

      <group scale={scale} rotation={playerColor === 'black' ? [0, Math.PI, 0] : [0, 0, 0]}>
        {/* Table surface */}
        <mesh position={[0, -0.03, 0]} receiveShadow>
          <planeGeometry args={[18, 18]} />
          <meshStandardMaterial {...tableMat} roughness={0.28} metalness={0.03} />
        </mesh>

        {/* Outer board frame (main border) */}
        <mesh position={[0, -0.01, 0]} receiveShadow>
          <boxGeometry args={[BOARD_SIZE + 0.65, 0.05, BOARD_SIZE + 0.65]} />
          <meshStandardMaterial {...frameMat} roughness={0.45} metalness={0.04} />
        </mesh>

        {/* Inner recessed border */}
        <mesh position={[0, -0.015, 0]}>
          <boxGeometry args={[BOARD_SIZE + 0.15, 0.025, BOARD_SIZE + 0.15]} />
          <meshStandardMaterial {...frameInnerMat} roughness={0.7} metalness={0.01} />
        </mesh>

        {/* Board base (playing surface floor) */}
        <mesh position={[0, -0.025, 0]}>
          <boxGeometry args={[BOARD_SIZE, 0.015, BOARD_SIZE]} />
          <meshStandardMaterial color="#1f0f08" roughness={0.9} />
        </mesh>

        {/* Corner ornaments */}
        {[
          [-1, -1, 0],
          [1, -1, Math.PI / 2],
          [1, 1, Math.PI],
          [-1, 1, -Math.PI / 2],
        ].map(([sx, sz, rot]) => (
          <CornerOrnament
            key={`corner-${sx}-${sz}`}
            position={[sx * (HALF + 0.15), 0.012, sz * (HALF + 0.15)]}
            rotation={rot}
          />
        ))}

        {/* Inner shadow rim */}
        {[-1, 1].map(sx => [-1, 1].map(sz => (
          <mesh key={`rim-${sx}-${sz}`} position={[sx * (HALF - 0.01), 0.003, sz * (HALF - 0.01)]}>
            <planeGeometry args={[0.10, 0.10]} />
            <meshBasicMaterial color="#0a0503" transparent opacity={0.3} depthWrite={false} />
          </mesh>
        )))}

        {/* Squares */}
        {Array.from({ length: BOARD_SIZE }, (_, r) =>
          Array.from({ length: BOARD_SIZE }, (_, c) => (
            <BoardSquare
              key={`sq-${r}-${c}`}
              row={r} col={c}
              isDark={(r + c) % 2 === 1}
              isHighlighted={validSet.has(`${r},${c}`)}
              isCapture={captureSet.has(`${r},${c}`)}
              onClick={() => onSquareClick({ row: r, col: c })}
            />
          )),
        )}

        {/* Valid move indicators */}
        {validMoves.filter(m => !m.captured).map(m => (
          <MoveDot key={`dot-${m.to.row}-${m.to.col}`} row={m.to.row} col={m.to.col} />
        ))}

        {/* Pieces */}
        {board.flatMap((row, r) =>
          row.map((piece, c) =>
            piece ? (
              <CheckerPiece
                key={piece.id}
                piece={piece}
                row={r} col={c}
                isSelected={selected?.row === r && selected?.col === c}
                onClick={() => onPieceClick({ row: r, col: c })}
              />
            ) : null,
          ),
        )}
      </group>
    </>
  );
}
