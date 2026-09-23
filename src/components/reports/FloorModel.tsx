"use client";

/**
 * Rotatable 3D model of the production floor, with each room's live count
 * of batches waiting at its stations floating above it. Built from simple
 * primitives (no model files to load or license) off the plan in
 * src/lib/floorPlan.ts. Loaded client-side only — see the dynamic import in
 * the reports page — so three.js never lands in any other page's bundle.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { CheckCircle, Gear, Pill, Printer, ShareNetwork } from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { FLOOR_CENTER, FLOOR_ROOMS, type FloorRoom, type RoomIcon, type RoomLoad } from "@/lib/floorPlan";

const ICONS: Record<RoomIcon, Icon> = {
  capsule: Pill,
  gear: Gear,
  printer: Printer,
  check: CheckCircle,
  share: ShareNetwork,
};

interface Palette {
  base: string;
  floor: string;
  wall: string;
  wallTop: string;
  metal: string;
  fixture: string;
  bin: string;
  ambient: number;
}

const LIGHT: Palette = {
  base: "#d9e0ea",
  floor: "#eef2f7",
  wall: "#dfe5ee",
  wallTop: "#f8fafc",
  metal: "#cfd6df",
  fixture: "#e6ebf2",
  bin: "#5b8def",
  ambient: 0.75,
};

const DARK: Palette = {
  base: "#070f2a",
  floor: "#101b3d",
  wall: "#1a2854",
  wallTop: "#2b3c73",
  metal: "#8d9bb5",
  fixture: "#233366",
  bin: "#3b82f6",
  ambient: 0.45,
};

const WALL_HEIGHT = 0.5;
const WALL_THICKNESS = 0.08;
const PIPE_INSET = 0.2;

/** Plan [x, z] → world, centred on the origin. */
function toWorld([x, z]: [number, number], y = 0): THREE.Vector3 {
  return new THREE.Vector3(x - FLOOR_CENTER[0], y, z - FLOOR_CENTER[1]);
}

/** Moves every edge of a rectilinear outline `d` inwards. */
function insetOutline(outline: [number, number][], d: number): [number, number][] {
  const n = outline.length;
  // Shoelace sign tells which side of each edge is "inside".
  let area = 0;
  for (let i = 0; i < n; i++) {
    const [x1, z1] = outline[i];
    const [x2, z2] = outline[(i + 1) % n];
    area += x1 * z2 - x2 * z1;
  }
  const inward = area > 0 ? 1 : -1;
  const normal = (a: [number, number], b: [number, number]): [number, number] => {
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz) || 1;
    return [(-dz / len) * inward, (dx / len) * inward];
  };
  return outline.map((p, i) => {
    const prev = outline[(i - 1 + n) % n];
    const next = outline[(i + 1) % n];
    const n1 = normal(prev, p);
    const n2 = normal(p, next);
    // Edges meet at right angles, so the corner moves d along each normal.
    return [p[0] + (n1[0] + n2[0]) * d, p[1] + (n1[1] + n2[1]) * d];
  });
}

function segments(outline: [number, number][]): [[number, number], [number, number]][] {
  return outline.map((p, i) => [p, outline[(i + 1) % outline.length]]);
}

/* ---------------------------------------------------------------------------
 * Building shell
 * ------------------------------------------------------------------------- */

function RoomFloor({ room, palette }: { room: FloorRoom; palette: Palette }) {
  const geometry = useMemo(() => {
    const shape = new THREE.Shape(
      room.outline.map(([x, z]) => new THREE.Vector2(x - FLOOR_CENTER[0], -(z - FLOOR_CENTER[1]))),
    );
    return new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: false });
  }, [room.outline]);
  const color = useMemo(
    () => new THREE.Color(palette.floor).lerp(new THREE.Color(room.accent), 0.05),
    [palette.floor, room.accent],
  );
  return (
    <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <meshStandardMaterial color={color} roughness={0.85} />
    </mesh>
  );
}

function Wall({ from, to, palette }: { from: [number, number]; to: [number, number]; palette: Palette }) {
  const a = toWorld(from);
  const b = toWorld(to);
  const length = a.distanceTo(b);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const angle = Math.atan2(-(b.z - a.z), b.x - a.x);
  return (
    <group position={[mid.x, 0, mid.z]} rotation={[0, angle, 0]}>
      <mesh position={[0, WALL_HEIGHT / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[length + WALL_THICKNESS, WALL_HEIGHT, WALL_THICKNESS]} />
        <meshStandardMaterial color={palette.wall} roughness={0.7} />
      </mesh>
      <mesh position={[0, WALL_HEIGHT + 0.01, 0]}>
        <boxGeometry args={[length + WALL_THICKNESS, 0.02, WALL_THICKNESS + 0.02]} />
        <meshStandardMaterial color={palette.wallTop} roughness={0.5} />
      </mesh>
    </group>
  );
}

/** Neon pipe tracing the inside of a room's walls. Busier rooms glow
 *  brighter and pulse, so the bottleneck reads at a glance. */
function RoomPipe({ room, load, animate }: { room: FloorRoom; load: RoomLoad | undefined; animate: boolean }) {
  const waiting = load?.waiting ?? 0;
  const base = waiting === 0 ? 0.6 : Math.min(2.6, 1.3 + waiting * 0.25);

  // One material for every piece of this room's pipe, so the pulse only has
  // one thing to animate.
  const material = useMemo(
    () => new THREE.MeshStandardMaterial({ color: room.accent, emissive: room.accent, toneMapped: false }),
    [room.accent],
  );
  // The frame loop mutates it through a ref — three.js materials are meant
  // to be changed in place every frame, outside React's render.
  const live = useRef<THREE.MeshStandardMaterial | null>(null);
  useEffect(() => {
    live.current = material;
    return () => material.dispose();
  }, [material]);

  useFrame(({ clock }) => {
    if (!live.current) return;
    live.current.emissiveIntensity =
      animate && waiting > 0 ? base + Math.sin(clock.elapsedTime * 2.2) * 0.45 : base;
  });

  const pieces = useMemo(() => {
    const inset = insetOutline(room.outline, PIPE_INSET);
    const up = new THREE.Vector3(0, 1, 0);
    return segments(inset).map(([from, to]) => {
      const a = toWorld(from, 0.14);
      const b = toWorld(to, 0.14);
      const dir = b.clone().sub(a);
      const length = dir.length();
      return {
        position: a.clone().add(b).multiplyScalar(0.5),
        quaternion: new THREE.Quaternion().setFromUnitVectors(up, dir.normalize()),
        length,
        corner: a,
      };
    });
  }, [room.outline]);

  return (
    <group>
      {pieces.map((piece, i) => (
        <group key={i}>
          <mesh position={piece.position} quaternion={piece.quaternion} material={material}>
            <cylinderGeometry args={[0.045, 0.045, piece.length, 10]} />
          </mesh>
          <mesh position={piece.corner} material={material}>
            <sphereGeometry args={[0.07, 12, 12]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ---------------------------------------------------------------------------
 * Furniture — simple primitives, placed per room type
 * ------------------------------------------------------------------------- */

function Tank({ at, palette, scale = 1 }: { at: [number, number]; palette: Palette; scale?: number }) {
  const p = toWorld(at);
  return (
    <group position={[p.x, 0.06, p.z]} scale={scale}>
      <mesh position={[0, 0.55, 0]} castShadow>
        <cylinderGeometry args={[0.32, 0.32, 0.8, 24]} />
        <meshStandardMaterial color={palette.metal} metalness={0.85} roughness={0.25} />
      </mesh>
      <mesh position={[0, 0.95, 0]} castShadow>
        <sphereGeometry args={[0.32, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={palette.metal} metalness={0.85} roughness={0.25} />
      </mesh>
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} position={[Math.cos((i * Math.PI) / 2) * 0.24, 0.08, Math.sin((i * Math.PI) / 2) * 0.24]}>
          <cylinderGeometry args={[0.025, 0.025, 0.16, 6]} />
          <meshStandardMaterial color={palette.metal} metalness={0.6} roughness={0.4} />
        </mesh>
      ))}
    </group>
  );
}

/** Shelving run, long side along x unless `alongZ`. */
function Rack({
  at,
  length,
  alongZ = false,
  palette,
}: {
  at: [number, number];
  length: number;
  alongZ?: boolean;
  palette: Palette;
}) {
  const p = toWorld(at);
  const bins = Math.max(2, Math.floor(length / 0.28));
  return (
    <group position={[p.x, 0.06, p.z]} rotation={[0, alongZ ? Math.PI / 2 : 0, 0]}>
      <mesh position={[0, 0.42, 0]} castShadow>
        <boxGeometry args={[length, 0.84, 0.3]} />
        <meshStandardMaterial color={palette.fixture} roughness={0.6} />
      </mesh>
      {[0.22, 0.5, 0.76].map((y) =>
        Array.from({ length: bins }).map((_, i) => (
          <mesh key={`${y}-${i}`} position={[-length / 2 + (i + 0.5) * (length / bins), y, 0.1]}>
            <boxGeometry args={[(length / bins) * 0.7, 0.12, 0.14]} />
            <meshStandardMaterial color={palette.bin} roughness={0.5} />
          </mesh>
        )),
      )}
    </group>
  );
}

function Bench({ at, width, palette, alongZ = false }: { at: [number, number]; width: number; palette: Palette; alongZ?: boolean }) {
  const p = toWorld(at);
  return (
    <group position={[p.x, 0.06, p.z]} rotation={[0, alongZ ? Math.PI / 2 : 0, 0]}>
      <mesh position={[0, 0.3, 0]} castShadow>
        <boxGeometry args={[width, 0.06, 0.55]} />
        <meshStandardMaterial color={palette.fixture} roughness={0.5} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[(side * width) / 2.3, 0.14, 0]}>
          <boxGeometry args={[0.05, 0.28, 0.5]} />
          <meshStandardMaterial color={palette.metal} metalness={0.5} roughness={0.4} />
        </mesh>
      ))}
      {[-0.25, 0.25].map((x) => (
        <group key={x} position={[x * width, 0.33, -0.12]}>
          <mesh position={[0, 0.14, 0]}>
            <boxGeometry args={[0.32, 0.22, 0.03]} />
            <meshStandardMaterial color="#1e293b" roughness={0.3} />
          </mesh>
          <mesh position={[0, 0.14, 0.017]}>
            <planeGeometry args={[0.28, 0.18]} />
            <meshStandardMaterial color="#38bdf8" emissive="#38bdf8" emissiveIntensity={0.6} toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Machine({ at, size, palette }: { at: [number, number]; size: [number, number, number]; palette: Palette }) {
  const p = toWorld(at);
  const [w, h, d] = size;
  return (
    <group position={[p.x, 0.06, p.z]}>
      <mesh position={[0, h / 2, 0]} castShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color={palette.fixture} roughness={0.45} metalness={0.2} />
      </mesh>
      <mesh position={[0, h * 0.72, d / 2 + 0.005]}>
        <planeGeometry args={[w * 0.5, h * 0.18]} />
        <meshStandardMaterial color="#60a5fa" emissive="#60a5fa" emissiveIntensity={0.5} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Pallet({ at, palette, seed }: { at: [number, number]; palette: Palette; seed: number }) {
  const p = toWorld(at);
  const stacks = 2 + (seed % 2);
  return (
    <group position={[p.x, 0.06, p.z]}>
      <mesh position={[0, 0.04, 0]}>
        <boxGeometry args={[0.7, 0.08, 0.7]} />
        <meshStandardMaterial color="#b08a5a" roughness={0.9} />
      </mesh>
      {Array.from({ length: stacks }).map((_, level) =>
        [
          [-0.16, -0.16],
          [0.16, -0.16],
          [-0.16, 0.16],
          [0.16, 0.16],
        ].map(([x, z], i) => (
          <mesh key={`${level}-${i}`} position={[x, 0.17 + level * 0.19, z]} castShadow>
            <boxGeometry args={[0.3, 0.18, 0.3]} />
            <meshStandardMaterial color={(i + level + seed) % 3 === 0 ? "#d9a45b" : palette.bin} roughness={0.7} />
          </mesh>
        )),
      )}
    </group>
  );
}

function Furniture({ room, palette }: { room: FloorRoom; palette: Palette }) {
  switch (room.furniture) {
    case "internals":
      return (
        <>
          <Tank at={[6.8, 1.9]} palette={palette} />
          <Tank at={[7.7, 1.9]} palette={palette} scale={0.85} />
          <Tank at={[6.8, 3.1]} palette={palette} scale={0.9} />
          <Tank at={[7.2, 6.6]} palette={palette} />
          <Tank at={[8.1, 6.6]} palette={palette} scale={0.85} />
          <Tank at={[7.6, 7.8]} palette={palette} scale={0.7} />
          <Machine at={[8.6, 2.9]} size={[0.6, 0.6, 0.5]} palette={palette} />
          <Rack at={[9.5, 3.2]} length={1.8} alongZ palette={palette} />
          <Rack at={[9.5, 6.9]} length={2.2} alongZ palette={palette} />
        </>
      );
    case "dispensary":
      return (
        <>
          <Rack at={[1.0, 7.0]} length={2.4} alongZ palette={palette} />
          <Rack at={[3.85, 4.5]} length={1.6} alongZ palette={palette} />
          <Rack at={[5.45, 4.5]} length={1.6} alongZ palette={palette} />
          <Bench at={[2.6, 5.95]} width={1.6} palette={palette} />
          <Bench at={[4.65, 7.3]} width={1.2} palette={palette} />
          <Machine at={[4.65, 4.2]} size={[0.5, 0.5, 0.5]} palette={palette} />
        </>
      );
    case "print":
      return (
        <>
          <Machine at={[1.45, 12.3]} size={[0.8, 0.7, 1.3]} palette={palette} />
          <Machine at={[2.75, 12.6]} size={[0.6, 0.55, 0.8]} palette={palette} />
          <Machine at={[2.75, 11.4]} size={[0.6, 0.5, 0.6]} palette={palette} />
          <Rack at={[1.9, 9.0]} length={1.4} palette={palette} />
        </>
      );
    case "checking":
      return (
        <>
          <Bench at={[4.7, 9.9]} width={1.6} palette={palette} />
          <Bench at={[4.7, 12.4]} width={1.6} palette={palette} />
        </>
      );
    case "externals":
      return (
        <>
          {[6.8, 7.9, 9.0].map((x, i) => (
            <Pallet key={`a${x}`} at={[x, 10.3]} palette={palette} seed={i} />
          ))}
          {[6.8, 7.9, 9.0].map((x, i) => (
            <Pallet key={`b${x}`} at={[x, 12.8]} palette={palette} seed={i + 1} />
          ))}
          <Rack at={[9.55, 11.55]} length={1.4} alongZ palette={palette} />
        </>
      );
  }
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

/** Pin height above the floor, in world units (the building group sits 0.3 down). */
const LABEL_HEIGHT = 1.05;

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
  const compact = width < 700;
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
      <div
        className={`flex items-center whitespace-nowrap rounded-xl border border-[var(--border)] bg-[var(--surface)]/90 shadow-lg backdrop-blur ${
          compact ? "gap-1.5 py-1 pl-1 pr-2" : "gap-2 py-1.5 pl-1.5 pr-3"
        }`}
      >
        <span
          className={`grid shrink-0 place-items-center rounded-full text-white ${compact ? "h-6 w-6" : "h-8 w-8"}`}
          style={{ background: room.accent, boxShadow: `0 0 12px ${room.accent}88` }}
        >
          <Icon size={compact ? 13 : 16} weight="bold" />
        </span>
        <span className="leading-none">
          <span className={`block font-bold text-[var(--foreground)] ${compact ? "text-[10px]" : "text-[12px]"}`}>
            {room.name}
          </span>
          <span className="mt-0.5 flex items-baseline gap-1">
            <span
              className={`font-extrabold tabular-nums ${compact ? "text-sm" : "text-lg"}`}
              style={{ color: room.accent }}
            >
              {waiting}
            </span>
            <span className="text-[10px] font-semibold text-[var(--muted-foreground)]">incoming</span>
          </span>
        </span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Scene
 * ------------------------------------------------------------------------- */

/** Nudges the rendered view sideways so the model sits clear of the
 *  "Pipeline now" panel overlaid on the card's bottom-left, and up a touch
 *  because perspective draws the near half of the floor larger than the far
 *  half. Orbiting still pivots on the building's centre — only the framing
 *  moves. */
function FrameOffset({ fraction }: { fraction: number }) {
  const camera = useThree((state) => state.camera);
  const width = useThree((state) => state.size.width);
  const height = useThree((state) => state.size.height);
  useEffect(() => {
    const shift = width >= 640 ? -width * fraction : 0;
    camera.setViewOffset(width, height, shift, height * 0.05, width, height);
    return () => camera.clearViewOffset();
  }, [camera, width, height, fraction]);
  return null;
}

/** How far the building reaches from its centre, sideways and (foreshortened
 *  by the downward viewing angle) up the screen, labels included. Fitting
 *  these as spheres rather than flat extents leaves room for the corner
 *  nearest the camera, which perspective draws larger than the rest. */
const FIT_RADIUS_ACROSS = 7.5;
const FIT_RADIUS_UP = 6.6;

function setCameraDistance(camera: THREE.Camera, distance: number): void {
  camera.position.setLength(distance);
}

/** Pulls the camera in or out whenever the card resizes so the whole floor
 *  fits — close on a wide desktop card, further back on a narrow phone. */
function AutoFit() {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const width = useThree((state) => state.size.width);
  const height = useThree((state) => state.size.height);
  useEffect(() => {
    const halfV = THREE.MathUtils.degToRad(camera.fov / 2);
    const halfH = Math.atan(Math.tan(halfV) * (width / Math.max(1, height)));
    const distance = Math.max(FIT_RADIUS_ACROSS / Math.sin(halfH), FIT_RADIUS_UP / Math.sin(halfV));
    setCameraDistance(camera, distance);
  }, [camera, width, height]);
  return null;
}

function Scene({
  loads,
  palette,
  reducedMotion,
  labelRefs,
}: {
  loads: Record<string, RoomLoad>;
  palette: Palette;
  reducedMotion: boolean;
  labelRefs: LabelRefs;
}) {
  const [autoRotate, setAutoRotate] = useState(true);
  const resumeTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(resumeTimer.current), []);

  const baseOutline = useMemo(() => {
    const shape = new THREE.Shape();
    // Slab under the whole building, a little proud of the walls.
    const pts: [number, number][] = [
      [0.35, 5.25],
      [3.15, 5.25],
      [3.15, 3.05],
      [5.65, 3.05],
      [5.65, 0.55],
      [10.15, 0.55],
      [10.15, 13.95],
      [0.35, 13.95],
    ];
    pts.forEach(([x, z], i) => {
      const v = new THREE.Vector2(x - FLOOR_CENTER[0], -(z - FLOOR_CENTER[1]));
      if (i === 0) shape.moveTo(v.x, v.y);
      else shape.lineTo(v.x, v.y);
    });
    return new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.04, bevelSegments: 2 });
  }, []);

  return (
    <>
      <ambientLight intensity={palette.ambient} />
      <directionalLight
        position={[8, 14, 6]}
        intensity={1.3}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-9}
        shadow-camera-right={9}
        shadow-camera-top={9}
        shadow-camera-bottom={-9}
      />
      <Environment resolution={128}>
        <Lightformer intensity={2} position={[0, 6, 0]} rotation-x={Math.PI / 2} scale={[12, 12, 1]} />
        <Lightformer intensity={1} position={[-6, 3, 4]} rotation-y={Math.PI / 2} scale={[8, 3, 1]} />
        <Lightformer intensity={1} position={[6, 3, -4]} rotation-y={-Math.PI / 2} scale={[8, 3, 1]} />
      </Environment>

      <group position={[0, -0.3, 0]}>
        <mesh geometry={baseOutline} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.12, 0]} receiveShadow>
          <meshStandardMaterial color={palette.base} roughness={0.9} />
        </mesh>
        {FLOOR_ROOMS.map((room) => (
          <group key={room.id}>
            <RoomFloor room={room} palette={palette} />
            {segments(room.outline).map(([from, to], i) => (
              <Wall key={i} from={from} to={to} palette={palette} />
            ))}
            <RoomPipe room={room} load={loads[room.id]} animate={!reducedMotion} />
            <Furniture room={room} palette={palette} />
          </group>
        ))}
      </group>

      <AutoFit />
      <FrameOffset fraction={0.1} />
      <LabelProjector labelRefs={labelRefs} />
      <OrbitControls
        makeDefault
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        minDistance={9}
        maxDistance={48}
        minPolarAngle={0.25}
        maxPolarAngle={1.02}
        autoRotate={autoRotate && !reducedMotion}
        autoRotateSpeed={0.5}
        onStart={() => {
          window.clearTimeout(resumeTimer.current);
          setAutoRotate(false);
        }}
        onEnd={() => {
          if (reducedMotion) return;
          // Hand control back to the slow spin once people stop exploring.
          resumeTimer.current = window.setTimeout(() => setAutoRotate(true), 8000);
        }}
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

export default function FloorModel({ loads, dark }: { loads: Record<string, RoomLoad>; dark: boolean }) {
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
  const labelRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

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
        shadows="percentage"
        dpr={[1, 2]}
        camera={{ position: [15, 17.5, 19.5], fov: 34 }}
        gl={{ antialias: true, alpha: true }}
        style={{ touchAction: "none" }}
      >
        <Scene loads={loads} palette={dark ? DARK : LIGHT} reducedMotion={reducedMotion} labelRefs={labelRefs} />
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
    </div>
  );
}
