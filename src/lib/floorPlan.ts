/**
 * The site floor plan the production report's 3D model is built from —
 * traced from the Borehamwood floor drawing, in metres-ish plan units (x to
 * the right, z down the drawing).
 *
 * ── WHICH STATION IS IN WHICH ROOM ─────────────────────────────────────────
 * `stationSequences` is the only thing tying a room to the MES: a room's
 * number on the model is the total of batches waiting at those stations.
 * Change the numbers here to move a station to another room; nothing else
 * needs touching. A station listed in no room simply doesn't appear on the
 * model (it still shows everywhere else in the report).
 */

export type RoomIcon = "capsule" | "gear" | "printer" | "check" | "share";

export type PlanPoint = [number, number];

export interface FloorRoom {
  id: string;
  name: string;
  icon: RoomIcon;
  /** Label icon and number colour. */
  accent: string;
  /** Neon pipe colour. */
  pipeColor: string;
  /** MES stage sequence numbers whose waiting batches count towards this room. */
  stationSequences: number[];
  /** Room floor outline as [x, z] corners, walked in order. */
  outline: PlanPoint[];
  /** Neon pipe runs along the room's walls, each a polyline. */
  pipes: PlanPoint[][];
  /** Where the room's label floats. */
  pin: PlanPoint;
}

export const FLOOR_ROOMS: FloorRoom[] = [
  {
    id: "dispensary",
    name: "Dispensary",
    icon: "capsule",
    accent: "#0f9f95",
    pipeColor: "#38a8ff",
    stationSequences: [3],
    outline: [
      [3.4, 3.25],
      [5.9, 3.25],
      [5.9, 8.6],
      [0.7, 8.6],
      [0.7, 5.55],
      [3.4, 5.55],
    ],
    pipes: [
      [
        [3.85, 3.5],
        [3.85, 4.3],
      ],
      [
        [5.45, 3.5],
        [5.45, 4.3],
        [5.7, 4.3],
        [5.7, 8.3],
      ],
    ],
    pin: [3.3, 6.75],
  },
  {
    id: "internals",
    name: "Internals Room",
    icon: "gear",
    accent: "#e8334f",
    pipeColor: "#ff2d55",
    stationSequences: [4, 5],
    outline: [
      [5.9, 0.85],
      [9.6, 0.85],
      [9.6, 9.35],
      [5.9, 9.35],
    ],
    pipes: [
      [
        [6.05, 1.5],
        [6.5, 1.5],
        [6.5, 2.5],
        [6.12, 2.5],
        [6.12, 9.15],
      ],
    ],
    pin: [8.2, 4.9],
  },
  {
    id: "print",
    name: "Print Room",
    icon: "printer",
    accent: "#8b3fd9",
    pipeColor: "#a855f7",
    stationSequences: [2],
    outline: [
      [0.7, 8.6],
      [3.5, 8.6],
      [3.5, 13.9],
      [0.7, 13.9],
    ],
    pipes: [
      [
        [0.9, 13.65],
        [0.9, 8.82],
        [3.3, 8.82],
        [3.3, 13.65],
      ],
    ],
    pin: [2.1, 10.3],
  },
  {
    id: "checking",
    name: "Checking Room",
    icon: "check",
    accent: "#e0a800",
    pipeColor: "#fbbf24",
    stationSequences: [6],
    outline: [
      [3.5, 8.6],
      [5.9, 8.6],
      [5.9, 13.9],
      [3.5, 13.9],
    ],
    pipes: [
      [
        [3.95, 8.82],
        [3.95, 9.25],
        [3.72, 9.25],
        [3.72, 13.65],
        [5.05, 13.65],
      ],
      [
        [5.68, 9.05],
        [5.68, 13.4],
      ],
    ],
    pin: [4.75, 10.3],
  },
  {
    id: "externals",
    name: "Externals Room",
    icon: "share",
    accent: "#0f9f95",
    pipeColor: "#22d3ee",
    stationSequences: [7],
    outline: [
      [5.9, 9.35],
      [9.6, 9.35],
      [9.6, 13.9],
      [5.9, 13.9],
    ],
    pipes: [
      [
        [6.12, 9.5],
        [6.12, 13.65],
        [7.3, 13.65],
      ],
      [
        [6.35, 9.58],
        [7.2, 9.58],
      ],
      [
        [8.4, 9.58],
        [9.38, 9.58],
        [9.38, 13.65],
        [8.2, 13.65],
      ],
    ],
    pin: [8.1, 10.75],
  },
];

/** Pipe runs that belong to no one room — service lines between them. */
export const SERVICE_PIPES: { color: string; path: PlanPoint[] }[] = [
  {
    color: "#34d399",
    path: [
      [4.2, 8.75],
      [5.75, 8.75],
    ],
  },
];

export interface FloorWall {
  from: PlanPoint;
  to: PlanPoint;
  /** Door openings, as [start, end] distances along the wall from `from`. */
  gaps?: [number, number][];
  outer?: boolean;
}

export const FLOOR_WALLS: FloorWall[] = [
  { from: [0.7, 5.55], to: [3.4, 5.55], outer: true },
  { from: [3.4, 5.55], to: [3.4, 3.25], outer: true },
  { from: [3.4, 3.25], to: [5.9, 3.25], outer: true, gaps: [[1.0, 1.7]] },
  { from: [5.9, 3.25], to: [5.9, 0.85], outer: true, gaps: [[1.1, 1.8]] },
  { from: [5.9, 0.85], to: [9.6, 0.85], outer: true },
  { from: [9.6, 0.85], to: [9.6, 13.9], outer: true },
  {
    from: [9.6, 13.9],
    to: [0.7, 13.9],
    outer: true,
    gaps: [
      [4.0, 4.5],
      [8.15, 8.65],
    ],
  },
  { from: [0.7, 13.9], to: [0.7, 5.55], outer: true, gaps: [[6.35, 7.0]] },
  { from: [5.9, 3.25], to: [5.9, 13.9] },
  { from: [0.7, 8.6], to: [5.9, 8.6] },
  { from: [3.5, 8.6], to: [3.5, 13.9] },
  { from: [5.9, 9.35], to: [9.6, 9.35], gaps: [[1.4, 2.4]] },
];

/** Door leaves standing open in the openings above. */
export const FLOOR_DOORS: { from: PlanPoint; to: PlanPoint; double?: boolean; swing: 1 | -1 }[] = [
  { from: [4.4, 3.25], to: [5.1, 3.25], double: true, swing: -1 },
  { from: [5.9, 2.15], to: [5.9, 1.45], swing: 1 },
  { from: [7.3, 9.35], to: [8.3, 9.35], double: true, swing: 1 },
  { from: [0.7, 7.55], to: [0.7, 6.9], swing: -1 },
  { from: [1.45, 13.9], to: [0.95, 13.9], swing: -1 },
  { from: [5.6, 13.9], to: [5.1, 13.9], swing: -1 },
];

/** Blue status lights on the wall tops by the doors. */
export const FLOOR_LIGHTS: PlanPoint[] = [
  [4.75, 3.25],
  [7.45, 0.85],
  [0.7, 7.22],
  [1.2, 13.9],
  [5.35, 13.9],
];

/** Plan centre, so the model sits (and orbits) around the origin. */
export const FLOOR_CENTER: PlanPoint = [5.15, 7.375];

export interface RoomLoad {
  /** Waiting to be picked up: Incoming + Returned. */
  waiting: number;
  /** Of those, how many came back for rework. */
  returned: number;
  inProgress: number;
  /** "Order/Calculation Check" etc., in stage order. */
  stationNames: string[];
}

/** Totals each room's stations from a per-station load list. */
export function roomLoads(
  stations: readonly { sequenceNumber: number; stageName: string; incoming: number; returned: number; inProgress: number }[],
): Record<string, RoomLoad> {
  const out: Record<string, RoomLoad> = {};
  for (const room of FLOOR_ROOMS) {
    const mine = stations
      .filter((s) => room.stationSequences.includes(s.sequenceNumber))
      .sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    out[room.id] = {
      waiting: mine.reduce((n, s) => n + s.incoming + s.returned, 0),
      returned: mine.reduce((n, s) => n + s.returned, 0),
      inProgress: mine.reduce((n, s) => n + s.inProgress, 0),
      stationNames: mine.map((s) => s.stageName),
    };
  }
  return out;
}
