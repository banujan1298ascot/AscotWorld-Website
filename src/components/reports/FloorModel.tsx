"use client";

/**
 * Rotatable 3D model of the production floor, styled after the site's
 * floor-plan render: white walls on a pale tiled floor, glowing neon service
 * pipes tracing each room, stainless vessels, shelving and benches — with
 * each room's live count of batches waiting at its stations floating above
 * it. Built from primitives off the plan in src/lib/floorPlan.ts (no model
 * files to load or license) and loaded client-side only — see the dynamic
 * import in the reports page — so three.js never lands in another page's
 * bundle.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  AccumulativeShadows,
  Environment,
  Instance,
  Instances,
  Lightformer,
  OrbitControls,
  RandomizedLight,
  RoundedBox,
} from "@react-three/drei";
import * as THREE from "three";
import { ArrowCounterClockwise, CheckCircle, Gear, Pill, Printer, ShareNetwork } from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import {
  FLOOR_CENTER,
  FLOOR_DOORS,
  FLOOR_LIGHTS,
  FLOOR_ROOMS,
  FLOOR_WALLS,
  SERVICE_PIPES,
  type FloorRoom,
  type PlanPoint,
  type RoomIcon,
  type RoomLoad,
} from "@/lib/floorPlan";

const ICONS: Record<RoomIcon, Icon> = {
  capsule: Pill,
  gear: Gear,
  printer: Printer,
  check: CheckCircle,
  share: ShareNetwork,
};

const COLORS = {
  floor: "#e9edf2",
  tileLine: "#d6dde6",
  base: "#bfc9d6",
  wall: "#d9e0e9",
  wallCap: "#f7f9fc",
  steel: "#e2e7ed",
  steelDark: "#9ba6b4",
  white: "#f6f8fb",
  panel: "#1f2a3d",
  screen: "#4cc3ff",
  binBlue: "#4a8ef0",
  binLight: "#a9cdfa",
  binWhite: "#f3f6fa",
  cardboard: "#d9b98b",
  pallet: "#b89a72",
  statusLight: "#58b6ff",
};

const WALL = { outerHeight: 0.58, innerHeight: 0.52, outerThickness: 0.16, innerThickness: 0.1 };
const PIPE = { y: 0.13, radius: 0.05 };

/** Plan [x, z] → world, centred on the origin. */
function toWorld([x, z]: PlanPoint, y = 0): THREE.Vector3 {
  return new THREE.Vector3(x - FLOOR_CENTER[0], y, z - FLOOR_CENTER[1]);
}

/** Y-rotation that lays a group's +x axis along the segment a → b. */
function headingOf(a: PlanPoint, b: PlanPoint): number {
  return Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
}

function segmentsOf(path: PlanPoint[]): [PlanPoint, PlanPoint][] {
  return path.slice(1).map((p, i) => [path[i], p]);
}

/* ---------------------------------------------------------------------------
 * Shared materials and textures
 * ------------------------------------------------------------------------- */

function useMaterials() {
  const materials = useMemo(() => {
    const tiles = document.createElement("canvas");
    tiles.width = tiles.height = 128;
    const t = tiles.getContext("2d")!;
    t.fillStyle = COLORS.floor;
    t.fillRect(0, 0, 128, 128);
    t.strokeStyle = COLORS.tileLine;
    t.lineWidth = 2;
    t.strokeRect(1, 1, 126, 126);
    const tileTexture = new THREE.CanvasTexture(tiles);
    tileTexture.wrapS = tileTexture.wrapT = THREE.RepeatWrapping;
    tileTexture.colorSpace = THREE.SRGBColorSpace;
    tileTexture.anisotropy = 4;

    // Soft falloff across a strip's width — the light a neon pipe throws on
    // the floor either side of it.
    const falloff = document.createElement("canvas");
    falloff.width = 4;
    falloff.height = 64;
    const f = falloff.getContext("2d")!;
    const gradient = f.createLinearGradient(0, 0, 0, 64);
    gradient.addColorStop(0, "#000");
    gradient.addColorStop(0.5, "#fff");
    gradient.addColorStop(1, "#000");
    f.fillStyle = gradient;
    f.fillRect(0, 0, 4, 64);
    const glowFalloff = new THREE.CanvasTexture(falloff);

    return {
      tileTexture,
      glowFalloff,
      floor: new THREE.MeshStandardMaterial({ map: tileTexture, roughness: 0.75 }),
      base: new THREE.MeshStandardMaterial({ color: COLORS.base, roughness: 0.8 }),
      wall: new THREE.MeshStandardMaterial({ color: COLORS.wall, roughness: 0.55 }),
      wallCap: new THREE.MeshStandardMaterial({ color: COLORS.wallCap, roughness: 0.35 }),
      steel: new THREE.MeshStandardMaterial({ color: COLORS.steel, metalness: 1, roughness: 0.2 }),
      steelDark: new THREE.MeshStandardMaterial({ color: COLORS.steelDark, metalness: 0.9, roughness: 0.35 }),
      white: new THREE.MeshStandardMaterial({ color: COLORS.white, roughness: 0.45 }),
      panel: new THREE.MeshStandardMaterial({ color: COLORS.panel, roughness: 0.3 }),
      screen: new THREE.MeshStandardMaterial({
        color: COLORS.screen,
        emissive: COLORS.screen,
        emissiveIntensity: 1.1,
        toneMapped: false,
      }),
      cardboard: new THREE.MeshStandardMaterial({ color: COLORS.cardboard, roughness: 0.85 }),
      pallet: new THREE.MeshStandardMaterial({ color: COLORS.pallet, roughness: 0.9 }),
      statusLight: new THREE.MeshStandardMaterial({
        color: COLORS.statusLight,
        emissive: COLORS.statusLight,
        emissiveIntensity: 2.2,
        toneMapped: false,
      }),
      door: new THREE.MeshPhysicalMaterial({ color: "#f4f7fb", roughness: 0.2, clearcoat: 0.6 }),
    };
  }, []);

  useEffect(
    () => () => {
      Object.values(materials).forEach((m) => (m as { dispose?: () => void }).dispose?.());
    },
    [materials],
  );
  return materials;
}

type Materials = ReturnType<typeof useMaterials>;

/* ---------------------------------------------------------------------------
 * Building shell: base, floors, walls, doors
 * ------------------------------------------------------------------------- */

function shapeFrom(outline: PlanPoint[]): THREE.Shape {
  return new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x - FLOOR_CENTER[0], -(z - FLOOR_CENTER[1]))));
}

const FOOTPRINT: PlanPoint[] = [
  [0.52, 5.37],
  [3.22, 5.37],
  [3.22, 3.07],
  [5.72, 3.07],
  [5.72, 0.67],
  [9.78, 0.67],
  [9.78, 14.08],
  [0.52, 14.08],
];

function Shell({ m }: { m: Materials }) {
  const base = useMemo(
    () =>
      new THREE.ExtrudeGeometry(shapeFrom(FOOTPRINT), {
        depth: 0.34,
        bevelEnabled: true,
        bevelSize: 0.05,
        bevelThickness: 0.05,
        bevelSegments: 3,
      }),
    [],
  );
  const floors = useMemo(
    () => FLOOR_ROOMS.map((room) => new THREE.ExtrudeGeometry(shapeFrom(room.outline), { depth: 0.04, bevelEnabled: false })),
    [],
  );

  return (
    <group>
      <mesh geometry={base} material={m.base} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.36, 0]} receiveShadow />
      {floors.map((geometry, i) => (
        <mesh key={i} geometry={geometry} material={m.floor} rotation={[-Math.PI / 2, 0, 0]} receiveShadow />
      ))}
      {FLOOR_WALLS.flatMap((wall, i) => wallPieces(wall).map((piece, j) => <WallPiece key={`${i}-${j}`} {...piece} m={m} />))}
      {FLOOR_DOORS.map((door, i) => (
        <Door key={i} {...door} m={m} />
      ))}
      {FLOOR_LIGHTS.map((at, i) => {
        const p = toWorld(at, WALL.outerHeight + 0.04);
        return (
          <mesh key={i} position={p} material={m.statusLight}>
            <boxGeometry args={[0.2, 0.05, 0.2]} />
          </mesh>
        );
      })}
    </group>
  );
}

/** Splits a wall at its door openings into the solid runs either side. */
function wallPieces(wall: (typeof FLOOR_WALLS)[number]) {
  const length = Math.hypot(wall.to[0] - wall.from[0], wall.to[1] - wall.from[1]);
  const along = (d: number): PlanPoint => [
    wall.from[0] + ((wall.to[0] - wall.from[0]) * d) / length,
    wall.from[1] + ((wall.to[1] - wall.from[1]) * d) / length,
  ];
  const cuts = [...(wall.gaps ?? [])].sort((a, b) => a[0] - b[0]);
  const pieces: { from: PlanPoint; to: PlanPoint; outer: boolean }[] = [];
  let start = 0;
  for (const [gapStart, gapEnd] of cuts) {
    if (gapStart > start) pieces.push({ from: along(start), to: along(gapStart), outer: !!wall.outer });
    start = gapEnd;
  }
  if (start < length) pieces.push({ from: along(start), to: along(length), outer: !!wall.outer });
  return pieces;
}

function WallPiece({ from, to, outer, m }: { from: PlanPoint; to: PlanPoint; outer: boolean; m: Materials }) {
  const a = toWorld(from);
  const b = toWorld(to);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const thickness = outer ? WALL.outerThickness : WALL.innerThickness;
  const height = outer ? WALL.outerHeight : WALL.innerHeight;
  const length = a.distanceTo(b) + thickness;
  return (
    <group position={[mid.x, 0, mid.z]} rotation={[0, headingOf(from, to), 0]}>
      <mesh position={[0, height / 2, 0]} material={m.wall} castShadow receiveShadow>
        <boxGeometry args={[length, height, thickness]} />
      </mesh>
      <mesh position={[0, height + 0.012, 0]} material={m.wallCap}>
        <boxGeometry args={[length + 0.02, 0.024, thickness + 0.03]} />
      </mesh>
    </group>
  );
}

function Door({
  from,
  to,
  double,
  swing,
  m,
}: {
  from: PlanPoint;
  to: PlanPoint;
  double?: boolean;
  swing: 1 | -1;
  m: Materials;
}) {
  const width = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const leaves = double
    ? [
        { hinge: from, towards: to, width: width / 2, turn: swing },
        { hinge: to, towards: from, width: width / 2, turn: -swing },
      ]
    : [{ hinge: from, towards: to, width, turn: swing }];
  return (
    <>
      {leaves.map((leaf, i) => {
        const p = toWorld(leaf.hinge);
        return (
          <group key={i} position={[p.x, 0.04, p.z]} rotation={[0, headingOf(leaf.hinge, leaf.towards) + leaf.turn * 0.65, 0]}>
            <mesh position={[leaf.width / 2, 0.25, 0]} material={m.door} castShadow>
              <boxGeometry args={[leaf.width - 0.02, 0.48, 0.035]} />
            </mesh>
            <mesh position={[leaf.width / 2, 0.36, 0]} material={m.screen}>
              <boxGeometry args={[leaf.width * 0.5, 0.1, 0.04]} />
            </mesh>
          </group>
        );
      })}
    </>
  );
}

/* ---------------------------------------------------------------------------
 * Neon pipes
 * ------------------------------------------------------------------------- */

/** One glowing pipe network: bright core tube, soft halo, and the light it
 *  spills on the floor. Busier rooms pulse, so the bottleneck reads at a
 *  glance. */
function NeonPipes({
  paths,
  color,
  waiting,
  animate,
  glowFalloff,
}: {
  paths: PlanPoint[][];
  color: string;
  waiting: number;
  animate: boolean;
  glowFalloff: THREE.Texture;
}) {
  const busy = waiting > 0;
  const mats = useMemo(() => {
    const tint = new THREE.Color(color).lerp(new THREE.Color("#ffffff"), 0.35);
    return {
      core: new THREE.MeshStandardMaterial({ color: tint, emissive: color, emissiveIntensity: 1.6, toneMapped: false }),
      halo: new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false, toneMapped: false }),
      spill: new THREE.MeshBasicMaterial({
        color,
        alphaMap: glowFalloff,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        toneMapped: false,
      }),
    };
  }, [color, glowFalloff]);
  const live = useRef<typeof mats | null>(null);
  useEffect(() => {
    live.current = mats;
    return () => Object.values(mats).forEach((mat) => mat.dispose());
  }, [mats]);

  useFrame(({ clock }) => {
    const current = live.current;
    if (!current) return;
    const pulse = animate && busy ? (Math.sin(clock.elapsedTime * 2.4) + 1) / 2 : 0.5;
    current.core.emissiveIntensity = busy ? 1.6 + pulse * 1.2 : 1.2;
    current.halo.opacity = busy ? 0.18 + pulse * 0.18 : 0.16;
    current.spill.opacity = busy ? 0.3 + pulse * 0.25 : 0.28;
  });

  const pieces = useMemo(() => {
    const up = new THREE.Vector3(0, 1, 0);
    return paths.flatMap((path) =>
      segmentsOf(path).map(([from, to]) => {
        const a = toWorld(from, PIPE.y);
        const b = toWorld(to, PIPE.y);
        const dir = b.clone().sub(a);
        const length = dir.length();
        return {
          mid: a.clone().add(b).multiplyScalar(0.5),
          quaternion: new THREE.Quaternion().setFromUnitVectors(up, dir.normalize()),
          heading: headingOf(from, to),
          length,
        };
      }),
    );
  }, [paths]);
  const joints = useMemo(() => paths.flatMap((path) => path.map((p) => toWorld(p, PIPE.y))), [paths]);

  return (
    <group>
      {pieces.map((piece, i) => (
        <group key={i}>
          <mesh position={piece.mid} quaternion={piece.quaternion} material={mats.core}>
            <cylinderGeometry args={[PIPE.radius, PIPE.radius, piece.length, 12]} />
          </mesh>
          <mesh position={piece.mid} quaternion={piece.quaternion} material={mats.halo}>
            <cylinderGeometry args={[PIPE.radius * 2.6, PIPE.radius * 2.6, piece.length, 12, 1, true]} />
          </mesh>
          <group position={[piece.mid.x, 0.05, piece.mid.z]} rotation={[0, piece.heading, 0]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} material={mats.spill}>
              <planeGeometry args={[piece.length + 0.3, 0.75]} />
            </mesh>
          </group>
        </group>
      ))}
      {joints.map((p, i) => (
        <group key={`j${i}`} position={p}>
          <mesh material={mats.core}>
            <sphereGeometry args={[PIPE.radius * 1.5, 16, 12]} />
          </mesh>
          <mesh material={mats.halo}>
            <sphereGeometry args={[PIPE.radius * 3, 16, 12]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ---------------------------------------------------------------------------
 * Equipment
 * ------------------------------------------------------------------------- */

/** Stainless process vessel on legs, with a domed head and agitator drive. */
function Vessel({ at, r = 0.32, h = 0.7, m }: { at: PlanPoint; r?: number; h?: number; m: Materials }) {
  const p = toWorld(at, 0.04);
  const skirt = 0.34;
  return (
    <group position={p}>
      {[0, 1, 2, 3].map((i) => {
        const angle = Math.PI / 4 + (i * Math.PI) / 2;
        return (
          <mesh key={i} position={[Math.cos(angle) * r * 0.8, skirt / 2, Math.sin(angle) * r * 0.8]} material={m.steelDark} castShadow>
            <cylinderGeometry args={[0.022, 0.022, skirt, 6]} />
          </mesh>
        );
      })}
      <mesh position={[0, skirt - 0.06, 0]} rotation={[Math.PI, 0, 0]} material={m.steel} castShadow>
        <coneGeometry args={[r, 0.16, 32]} />
      </mesh>
      <mesh position={[0, skirt + h / 2, 0]} material={m.steel} castShadow>
        <cylinderGeometry args={[r, r, h, 40]} />
      </mesh>
      <mesh position={[0, skirt + 0.12, 0]} rotation={[Math.PI / 2, 0, 0]} material={m.steelDark}>
        <torusGeometry args={[r + 0.012, 0.014, 8, 40]} />
      </mesh>
      <mesh position={[0, skirt + h, 0]} scale={[1, 0.42, 1]} material={m.steel} castShadow>
        <sphereGeometry args={[r, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      <mesh position={[0, skirt + h + r * 0.42 + 0.06, 0]} material={m.steelDark} castShadow>
        <cylinderGeometry args={[0.06, 0.07, 0.14, 16]} />
      </mesh>
      <mesh position={[0, skirt + h + r * 0.42 + 0.17, 0]} material={m.white} castShadow>
        <boxGeometry args={[0.12, 0.09, 0.12]} />
      </mesh>
      <mesh position={[r * 0.55, skirt + h + r * 0.3, 0]} material={m.steelDark}>
        <cylinderGeometry args={[0.03, 0.03, 0.12, 8]} />
      </mesh>
    </group>
  );
}

/** Upright cabinet or machine, with a lit display on its front. */
function Cabinet({
  at,
  size,
  facing = 0,
  m,
}: {
  at: PlanPoint;
  size: [number, number, number];
  facing?: number;
  m: Materials;
}) {
  const p = toWorld(at, 0.04);
  const [w, h, d] = size;
  return (
    <group position={p} rotation={[0, facing, 0]}>
      <RoundedBox args={[w, h, d]} radius={0.025} smoothness={2} position={[0, h / 2, 0]} material={m.white} castShadow />
      <mesh position={[0, h * 0.68, d / 2 + 0.004]} material={m.panel}>
        <planeGeometry args={[w * 0.62, h * 0.26]} />
      </mesh>
      <mesh position={[0, h * 0.68, d / 2 + 0.006]} material={m.screen}>
        <planeGeometry args={[w * 0.5, h * 0.16]} />
      </mesh>
      <mesh position={[0, h * 0.28, d / 2 + 0.004]} material={m.steelDark}>
        <planeGeometry args={[w * 0.7, 0.02]} />
      </mesh>
    </group>
  );
}

/** Big multi-module label printer line for the Print Room. */
function PrintLine({ at, m }: { at: PlanPoint; m: Materials }) {
  const modules = [-0.62, 0, 0.62];
  return (
    <group position={toWorld(at, 0.04)}>
      {modules.map((z, i) => (
        <group key={i} position={[0, 0, z]}>
          <RoundedBox args={[0.78, 0.62, 0.56]} radius={0.03} smoothness={2} position={[0, 0.31, 0]} material={m.white} castShadow />
          <mesh position={[0.395, 0.42, 0]} rotation={[0, Math.PI / 2, 0]} material={m.panel}>
            <planeGeometry args={[0.38, 0.16]} />
          </mesh>
          <mesh position={[0.397, 0.42, 0]} rotation={[0, Math.PI / 2, 0]} material={m.screen}>
            <planeGeometry args={[0.28, 0.08]} />
          </mesh>
          <mesh position={[0, 0.66, 0]} rotation={[Math.PI / 2, 0, 0]} material={m.steelDark} castShadow>
            <cylinderGeometry args={[0.07, 0.07, 0.4, 16]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Workbench with twin monitors and a keyboard. */
function Workbench({ at, width, facing = 0, m }: { at: PlanPoint; width: number; facing?: number; m: Materials }) {
  return (
    <group position={toWorld(at, 0.04)} rotation={[0, facing, 0]}>
      <mesh position={[0, 0.34, 0]} material={m.white} castShadow receiveShadow>
        <boxGeometry args={[width, 0.04, 0.55]} />
      </mesh>
      <mesh position={[0, 0.12, 0]} material={m.white} castShadow>
        <boxGeometry args={[width * 0.94, 0.03, 0.46]} />
      </mesh>
      {[-1, 1].map((side) =>
        [-1, 1].map((depth) => (
          <mesh key={`${side}${depth}`} position={[(side * width) / 2.1, 0.17, depth * 0.23]} material={m.steelDark}>
            <boxGeometry args={[0.03, 0.34, 0.03]} />
          </mesh>
        )),
      )}
      {[-0.22, 0.22].map((x) => (
        <group key={x} position={[x * width, 0.36, -0.14]}>
          <mesh position={[0, 0.02, 0]} material={m.steelDark}>
            <boxGeometry args={[0.08, 0.03, 0.06]} />
          </mesh>
          <mesh position={[0, 0.16, 0]} material={m.panel} castShadow>
            <boxGeometry args={[0.36, 0.22, 0.025]} />
          </mesh>
          <mesh position={[0, 0.16, 0.014]} material={m.screen}>
            <planeGeometry args={[0.32, 0.18]} />
          </mesh>
          <mesh position={[0, 0.005, 0.2]} material={m.panel}>
            <boxGeometry args={[0.26, 0.012, 0.09]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Low trolley. */
function Trolley({ at, m }: { at: PlanPoint; m: Materials }) {
  return (
    <group position={toWorld(at, 0.04)}>
      <mesh position={[0, 0.3, 0]} material={m.white} castShadow>
        <boxGeometry args={[0.55, 0.03, 0.38]} />
      </mesh>
      <mesh position={[0, 0.1, 0]} material={m.white} castShadow>
        <boxGeometry args={[0.55, 0.03, 0.38]} />
      </mesh>
      {[-1, 1].map((x) =>
        [-1, 1].map((z) => (
          <mesh key={`${x}${z}`} position={[x * 0.25, 0.16, z * 0.16]} material={m.steelDark}>
            <boxGeometry args={[0.02, 0.32, 0.02]} />
          </mesh>
        )),
      )}
    </group>
  );
}

function Pallet({ at, m, tiers = 2 }: { at: PlanPoint; m: Materials; tiers?: number }) {
  return (
    <group position={toWorld(at, 0.04)}>
      <mesh position={[0, 0.04, 0]} material={m.pallet} castShadow>
        <boxGeometry args={[0.62, 0.08, 0.62]} />
      </mesh>
      {Array.from({ length: tiers }).map((_, level) =>
        [
          [-0.14, -0.14],
          [0.14, -0.14],
          [-0.14, 0.14],
          [0.14, 0.14],
        ].map(([x, z], i) => (
          <mesh key={`${level}-${i}`} position={[x, 0.17 + level * 0.18, z]} material={m.cardboard} castShadow>
            <boxGeometry args={[0.26, 0.17, 0.26]} />
          </mesh>
        )),
      )}
    </group>
  );
}

/* ---------------------------------------------------------------------------
 * Shelving — instanced, since there are hundreds of bins
 * ------------------------------------------------------------------------- */

interface RackSpec {
  at: PlanPoint;
  length: number;
  alongZ?: boolean;
  height?: number;
  levels?: number;
  /** Mix of bin colours on this rack. */
  stock?: "blue" | "white" | "mixed";
}

const RACKS: RackSpec[] = [
  // Dispensary
  { at: [1.05, 6.35], length: 1.4, alongZ: true, height: 1.0, levels: 5 },
  { at: [1.05, 7.85], length: 1.3, alongZ: true, height: 1.0, levels: 5 },
  { at: [3.85, 4.65], length: 1.6, alongZ: true, height: 0.95, levels: 4 },
  { at: [5.42, 5.55], length: 1.4, alongZ: true, height: 0.95, levels: 4 },
  { at: [4.55, 4.55], length: 0.5, height: 0.8, levels: 3, stock: "mixed" },
  // Internals — along the east wall
  { at: [9.3, 2.9], length: 0.9, alongZ: true, height: 0.95, levels: 4, stock: "mixed" },
  { at: [9.3, 4.5], length: 0.8, alongZ: true, height: 0.95, levels: 4, stock: "mixed" },
  { at: [9.3, 6.0], length: 0.8, alongZ: true, height: 0.95, levels: 4, stock: "mixed" },
  { at: [9.3, 7.6], length: 1.4, alongZ: true, height: 0.95, levels: 4, stock: "mixed" },
  { at: [8.6, 6.1], length: 0.5, height: 0.8, levels: 3, stock: "mixed" },
  // Externals
  { at: [7.1, 11.9], length: 0.6, height: 0.9, levels: 4, stock: "white" },
  { at: [9.05, 11.9], length: 0.6, height: 0.9, levels: 4, stock: "white" },
  { at: [7.1, 13.25], length: 0.6, height: 0.6, levels: 3, stock: "white" },
  { at: [9.05, 13.25], length: 0.6, height: 0.6, levels: 3, stock: "white" },
];

const BIN_COLOURS: Record<NonNullable<RackSpec["stock"]>, string[]> = {
  blue: [COLORS.binBlue, COLORS.binLight, COLORS.binBlue],
  white: [COLORS.binWhite, COLORS.binBlue, COLORS.binWhite, COLORS.binLight],
  mixed: [COLORS.binBlue, COLORS.binWhite, COLORS.binLight],
};

function Shelving({ m }: { m: Materials }) {
  const { posts, shelves, bins } = useMemo(() => {
    const posts: { position: THREE.Vector3; scale: [number, number, number] }[] = [];
    const shelves: { position: THREE.Vector3; rotation: number; scale: [number, number, number] }[] = [];
    const bins: { position: THREE.Vector3; rotation: number; color: string }[] = [];
    const depth = 0.3;
    const up = new THREE.Vector3(0, 1, 0);
    RACKS.forEach((rack, r) => {
      const height = rack.height ?? 0.9;
      const levels = rack.levels ?? 4;
      const rotation = rack.alongZ ? Math.PI / 2 : 0;
      const centre = toWorld(rack.at, 0.04);
      const place = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyAxisAngle(up, rotation).add(centre);
      for (const x of [-rack.length / 2, rack.length / 2]) {
        for (const z of [-depth / 2, depth / 2]) posts.push({ position: place(x, height / 2, z), scale: [0.03, height, 0.03] });
      }
      const palette = BIN_COLOURS[rack.stock ?? "blue"];
      const perShelf = Math.max(2, Math.floor(rack.length / 0.15));
      for (let level = 0; level < levels; level++) {
        const y = 0.05 + (level * (height - 0.08)) / Math.max(1, levels - 1);
        shelves.push({ position: place(0, y, 0), rotation, scale: [rack.length, 0.02, depth] });
        if (level === levels - 1) continue;
        for (let i = 0; i < perShelf; i++) {
          // Deterministic gaps and colour mix so racks don't look stamped.
          const seed = (r * 31 + level * 7 + i * 13) % 11;
          if (seed === 3) continue;
          bins.push({
            position: place(-rack.length / 2 + (i + 0.5) * (rack.length / perShelf), y + 0.065, 0),
            rotation,
            color: palette[seed % palette.length],
          });
        }
      }
    });
    return { posts, shelves, bins };
  }, []);

  return (
    <>
      <Instances limit={posts.length} material={m.steelDark} castShadow>
        <boxGeometry args={[1, 1, 1]} />
        {posts.map((post, i) => (
          <Instance key={i} position={post.position} scale={post.scale} />
        ))}
      </Instances>
      <Instances limit={shelves.length} material={m.white} castShadow receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        {shelves.map((shelf, i) => (
          <Instance key={i} position={shelf.position} rotation={[0, shelf.rotation, 0]} scale={shelf.scale} />
        ))}
      </Instances>
      <Instances limit={bins.length} castShadow>
        <boxGeometry args={[0.11, 0.11, 0.24]} />
        <meshStandardMaterial roughness={0.45} />
        {bins.map((bin, i) => (
          <Instance key={i} position={bin.position} rotation={[0, bin.rotation, 0]} color={bin.color} />
        ))}
      </Instances>
    </>
  );
}

const HATCHES: PlanPoint[] = [
  [3.95, 8.62],
  [5.92, 8.7],
  [5.92, 9.15],
  [3.62, 13.5],
];

function Equipment({ m }: { m: Materials }) {
  return (
    <>
      {/* Internals — vessel clusters, as on the drawing */}
      <Vessel at={[7.05, 2.35]} m={m} />
      <Vessel at={[7.15, 3.25]} r={0.36} h={0.78} m={m} />
      <Vessel at={[7.95, 3.6]} r={0.3} m={m} />
      <Vessel at={[7.85, 4.35]} r={0.26} h={0.6} m={m} />
      <Vessel at={[8.35, 1.9]} r={0.28} h={0.62} m={m} />
      <Vessel at={[7.0, 5.35]} r={0.3} m={m} />
      <Vessel at={[7.15, 6.05]} r={0.24} h={0.55} m={m} />
      <Vessel at={[7.05, 7.15]} r={0.33} m={m} />
      <Vessel at={[7.75, 7.15]} r={0.33} m={m} />
      <Vessel at={[7.45, 8.2]} r={0.24} h={0.55} m={m} />
      <Cabinet at={[8.05, 2.95]} size={[0.5, 0.55, 0.4]} m={m} />
      <Cabinet at={[8.45, 3.55]} size={[0.36, 0.7, 0.3]} facing={-Math.PI / 2} m={m} />
      <Cabinet at={[8.4, 8.5]} size={[0.42, 0.7, 0.32]} m={m} />
      <Cabinet at={[9.3, 1.6]} size={[0.42, 0.75, 0.3]} facing={-Math.PI / 2} m={m} />

      {/* Dispensary — weigh desk, trolleys */}
      <Workbench at={[3.0, 5.95]} width={1.5} facing={Math.PI} m={m} />
      <Trolley at={[4.65, 5.25]} m={m} />
      <Trolley at={[5.05, 7.45]} m={m} />
      <Trolley at={[3.85, 8.0]} m={m} />
      <Cabinet at={[4.8, 6.5]} size={[0.3, 0.3, 0.3]} m={m} />

      {/* Print Room — label print line and cabinets */}
      <PrintLine at={[1.85, 12.05]} m={m} />
      <Cabinet at={[2.95, 11.6]} size={[0.44, 0.62, 0.4]} facing={-Math.PI / 2} m={m} />
      <Cabinet at={[2.95, 12.65]} size={[0.44, 0.62, 0.4]} facing={-Math.PI / 2} m={m} />
      <Cabinet at={[2.05, 9.15]} size={[0.8, 0.45, 0.35]} m={m} />
      <Cabinet at={[3.0, 9.12]} size={[0.28, 0.5, 0.26]} m={m} />

      {/* Checking Room — inspection benches */}
      <Workbench at={[4.85, 11.65]} width={1.4} m={m} />
      <Workbench at={[4.65, 12.95]} width={1.1} m={m} />
      <Trolley at={[4.05, 10.9]} m={m} />

      {/* Externals — pallets of finished goods */}
      <Pallet at={[8.1, 12.1]} m={m} />
      <Pallet at={[8.1, 13.2]} m={m} tiers={1} />
      <Cabinet at={[6.8, 10.1]} size={[0.4, 0.4, 0.3]} m={m} />

      {/* Pass-through hatches where service lines cross walls */}
      {HATCHES.map((at, i) => (
        <RoundedBox
          key={i}
          args={[0.26, 0.26, 0.26]}
          radius={0.03}
          smoothness={2}
          position={toWorld(at, 0.17)}
          material={m.white}
          castShadow
        />
      ))}
    </>
  );
}

/* ---------------------------------------------------------------------------
 * Floating room labels
 * ----------------------------------------------------------------------------
 * Plain DOM laid over the canvas, not drei's <Html> (which mounts a separate
 * React root per label and trips over React 19's unmount rules). The canvas
 * projects each room's pin to screen space every frame and moves its label
 * directly — no React re-render per frame.
 * ------------------------------------------------------------------------- */

type LabelRefs = React.RefObject<Record<string, HTMLDivElement | null>>;

const LABEL_HEIGHT = 1.0;

/** Moves one label to a projected screen point — DOM writes, outside React. */
function placeLabel(el: HTMLDivElement, x: number, y: number, depth: number): void {
  el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`;
  // Nearer labels stack on top of further ones.
  el.style.zIndex = String(Math.round((1 - depth) * 10000));
  el.style.opacity = "1";
}

function LabelProjector({ labelRefs }: { labelRefs: LabelRefs }) {
  const scratch = useMemo(() => new THREE.Vector3(), []);
  const pins = useMemo(() => FLOOR_ROOMS.map((room) => ({ id: room.id, at: toWorld(room.pin, LABEL_HEIGHT) })), []);

  useFrame(({ camera, size }) => {
    for (const pin of pins) {
      const el = labelRefs.current?.[pin.id];
      if (!el) continue;
      scratch.copy(pin.at).project(camera);
      placeLabel(el, (scratch.x * 0.5 + 0.5) * size.width, (-scratch.y * 0.5 + 0.5) * size.height, scratch.z);
    }
  });
  return null;
}

/** White card with a coloured icon disc, as on the floor drawing. */
function RoomLabel({
  room,
  load,
  width,
  ref,
}: {
  room: FloorRoom;
  load: RoomLoad | undefined;
  width: number;
  ref: (el: HTMLDivElement | null) => void;
}) {
  const compact = width < 640;
  const Icon = ICONS[room.icon];
  const waiting = load?.waiting ?? 0;
  const stations = load?.stationNames.join(" · ") ?? "";

  return (
    <div
      ref={ref}
      className="absolute left-0 top-0 opacity-0 transition-opacity duration-300 will-change-transform"
      role="img"
      aria-label={`${room.name}: ${waiting} batch${waiting === 1 ? "" : "es"} incoming${stations ? ` (${stations})` : ""}`}
      title={stations}
    >
      <div className="flex items-center">
        <span
          className={`relative z-10 grid shrink-0 place-items-center rounded-full border-[3px] border-white text-white ${
            compact ? "h-8 w-8" : "h-11 w-11"
          }`}
          style={{ background: room.accent, boxShadow: `0 4px 14px ${room.accent}55` }}
        >
          <Icon size={compact ? 15 : 21} weight="bold" />
        </span>
        <span
          className={`-ml-3 whitespace-nowrap rounded-xl bg-white/95 leading-none shadow-[0_6px_20px_rgb(15_23_42/0.14)] ${
            compact ? "py-1 pl-4 pr-2" : "py-1.5 pl-5 pr-3"
          }`}
        >
          {/* Two-line name ("Print / Room"), as on the drawing — keeps the
              cards narrow enough not to collide over small rooms. */}
          <span className={`block font-semibold text-[#1e293b] ${compact ? "text-[10px]" : "text-[12px]"}`}>
            {room.name.split(" ").map((word, i) => (
              <span key={i} className="block leading-[1.15]">
                {word}
              </span>
            ))}
          </span>
          <span className="mt-0.5 flex items-baseline gap-1">
            <span className={`font-bold tabular-nums ${compact ? "text-[15px]" : "text-[22px]"}`} style={{ color: room.accent }}>
              {waiting}
            </span>
            <span className={`font-semibold text-[#64748b] ${compact ? "text-[9px]" : "text-[10.5px]"}`}>incoming</span>
          </span>
        </span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Camera
 * ------------------------------------------------------------------------- */

/** Default view: from the south, tipped back ~30° from straight down — the
 *  angle the floor drawing is rendered at. */
const DEFAULT_TILT = 0.52;

/** How far the floor reaches from its centre, sideways and up the screen at
 *  the default tilt, labels included — what the camera fits to. */
const FIT_ACROSS = 5.0;
const FIT_UP = 7.1;

interface ControlsLike {
  saveState(): void;
  reset(): void;
  update(): void;
}

function setCameraDistance(camera: THREE.Camera, distance: number): void {
  camera.position.setLength(distance);
}

/** Pulls the camera in or out whenever the card resizes so the whole floor
 *  fits — and records that as the view "Reset view" returns to. */
function AutoFit() {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const controls = useThree((state) => state.controls) as unknown as ControlsLike | null;
  const width = useThree((state) => state.size.width);
  const height = useThree((state) => state.size.height);
  useEffect(() => {
    const halfV = THREE.MathUtils.degToRad(camera.fov / 2);
    const halfH = Math.atan(Math.tan(halfV) * (width / Math.max(1, height)));
    setCameraDistance(camera, Math.max(FIT_ACROSS / Math.tan(halfH), FIT_UP / Math.tan(halfV)));
    controls?.update();
    controls?.saveState();
  }, [camera, controls, width, height]);
  return null;
}

/** Nudges the rendered view right so the floor sits clear of the "Pipeline
 *  now" panel overlaid on the card's left. Orbiting still pivots on the
 *  building's centre — only the framing moves. */
function FrameOffset({ fraction }: { fraction: number }) {
  const camera = useThree((state) => state.camera);
  const width = useThree((state) => state.size.width);
  const height = useThree((state) => state.size.height);
  useEffect(() => {
    const shift = width >= 640 ? -width * fraction : 0;
    camera.setViewOffset(width, height, shift, height * 0.02, width, height);
    return () => camera.clearViewOffset();
  }, [camera, width, height, fraction]);
  return null;
}

function ResetOnSignal({ signal }: { signal: number }) {
  const controls = useThree((state) => state.controls) as unknown as ControlsLike | null;
  useEffect(() => {
    if (signal > 0) controls?.reset();
  }, [signal, controls]);
  return null;
}

/* ---------------------------------------------------------------------------
 * Scene
 * ------------------------------------------------------------------------- */

function Scene({
  loads,
  reducedMotion,
  labelRefs,
  resetSignal,
}: {
  loads: Record<string, RoomLoad>;
  reducedMotion: boolean;
  labelRefs: LabelRefs;
  resetSignal: number;
}) {
  const m = useMaterials();

  return (
    <>
      <hemisphereLight args={["#ffffff", "#b8c4d3", 0.55]} />
      <directionalLight position={[4, 12, 6]} intensity={0.9} />
      {/* A bright studio for the steel to reflect — polished metal mirrors
          its surroundings, so a dark environment would turn it black. */}
      <Environment resolution={256} environmentIntensity={0.55}>
        <color attach="background" args={["#e9eef4"]} />
        <Lightformer intensity={2.2} position={[0, 8, 0]} rotation-x={Math.PI / 2} scale={[14, 14, 1]} />
        <Lightformer intensity={1.2} position={[-8, 3, 2]} rotation-y={Math.PI / 2} scale={[12, 4, 1]} />
        <Lightformer intensity={1.2} position={[8, 3, -2]} rotation-y={-Math.PI / 2} scale={[12, 4, 1]} />
        <Lightformer intensity={0.8} position={[0, 2, 10]} scale={[14, 3, 1]} color="#dbeafe" />
      </Environment>

      <Shell m={m} />
      <Shelving m={m} />
      <Equipment m={m} />
      {FLOOR_ROOMS.map((room) => (
        <NeonPipes
          key={room.id}
          paths={room.pipes}
          color={room.pipeColor}
          waiting={loads[room.id]?.waiting ?? 0}
          animate={!reducedMotion}
          glowFalloff={m.glowFalloff}
        />
      ))}
      {SERVICE_PIPES.map((pipe, i) => (
        <NeonPipes key={`s${i}`} paths={[pipe.path]} color={pipe.color} waiting={0} animate={false} glowFalloff={m.glowFalloff} />
      ))}

      {/* Soft, baked contact shadows — on the floor and in a halo round the
          building, like the drawing. The scene is static, so it only has
          to accumulate once. */}
      <AccumulativeShadows temporal frames={70} alphaTest={0.8} opacity={0.75} scale={22} color="#51607a" position={[0, 0.045, 0]}>
        <RandomizedLight amount={8} radius={6} ambient={0.55} intensity={1.1} position={[3, 12, 5]} bias={0.001} />
      </AccumulativeShadows>

      <AutoFit />
      <FrameOffset fraction={0.15} />
      <LabelProjector labelRefs={labelRefs} />
      <ResetOnSignal signal={resetSignal} />
      <OrbitControls
        makeDefault
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        minDistance={9}
        maxDistance={48}
        minPolarAngle={0}
        maxPolarAngle={1.1}
      />
    </>
  );
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export default function FloorModel({ loads }: { loads: Record<string, RoomLoad> }) {
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
  const labelRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [resetSignal, setResetSignal] = useState(0);

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);

    // A plain mouse wheel scrolls the page, as it does everywhere else —
    // zooming only on Ctrl + wheel, which is also what a trackpad pinch
    // sends. Stopping the event before it reaches the canvas keeps
    // OrbitControls from swallowing it. Touch pinch-zoom is unaffected.
    const passWheelToPage = (event: WheelEvent) => {
      if (!event.ctrlKey) event.stopPropagation();
    };
    el.addEventListener("wheel", passWheelToPage, { capture: true });
    return () => {
      observer.disconnect();
      el.removeEventListener("wheel", passWheelToPage, { capture: true });
    };
  }, []);

  return (
    <div ref={container} className="relative h-full w-full">
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [0, Math.cos(DEFAULT_TILT) * 24, Math.sin(DEFAULT_TILT) * 24], fov: 34 }}
        gl={{ antialias: true, alpha: true }}
        style={{ touchAction: "none" }}
      >
        <Scene loads={loads} reducedMotion={reducedMotion} labelRefs={labelRefs} resetSignal={resetSignal} />
      </Canvas>
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {FLOOR_ROOMS.map((room) => (
          <RoomLabel
            key={room.id}
            room={room}
            load={loads[room.id]}
            width={width}
            ref={(el) => {
              labelRefs.current[room.id] = el;
            }}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={() => setResetSignal((n) => n + 1)}
        className="absolute bottom-3 right-3 z-20 flex items-center gap-1.5 rounded-full border border-[#dfe5ee] bg-white/90 px-3 py-1.5
          text-[11px] font-bold text-[#334155] shadow-sm backdrop-blur transition-colors hover:bg-white"
      >
        <ArrowCounterClockwise size={13} weight="bold" />
        Reset view
      </button>
    </div>
  );
}
