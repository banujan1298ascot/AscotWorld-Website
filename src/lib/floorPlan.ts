/**
 * The site floor plan the production report's 3D model is built from —
 * traced from the Borehamwood floor drawing, in metres-ish plan units (x to
 * the right, z towards the viewer).
 *
 * ── WHICH STATION IS IN WHICH ROOM ─────────────────────────────────────────
 * `stationSequences` is the only thing tying a room to the MES: a room's
 * number on the model is the total of batches waiting at those stations.
 * Change the numbers here to move a station to another room; nothing else
 * needs touching. A station listed in no room simply doesn't appear on the
 * model (it still shows everywhere else in the report).
 */

export type RoomIcon = "capsule" | "gear" | "printer" | "check" | "share";

/** What to furnish the room with — purely visual. */
export type RoomFurniture = "dispensary" | "internals" | "print" | "checking" | "externals";

export interface FloorRoom {
  id: string;
  name: string;
  icon: RoomIcon;
  /** Pipe glow, label icon and number colour. */
  accent: string;
  /** MES stage sequence numbers whose waiting batches count towards this room. */
  stationSequences: number[];
  /** Room outline as [x, z] corners, walked in order. Rectilinear only. */
  outline: [number, number][];
  /** Where the room's label floats. */
  pin: [number, number];
  furniture: RoomFurniture;
}

export const FLOOR_ROOMS: FloorRoom[] = [
  {
    id: "dispensary",
    name: "Dispensary",
    icon: "capsule",
    accent: "#14b8a6",
    stationSequences: [3],
    outline: [
      [3.4, 3.3],
      [5.9, 3.3],
      [5.9, 8.6],
      [0.6, 8.6],
      [0.6, 5.5],
      [3.4, 5.5],
    ],
    pin: [2.6, 6.9],
    furniture: "dispensary",
  },
  {
    id: "internals",
    name: "Internals Room",
    icon: "gear",
    accent: "#f43f5e",
    stationSequences: [4, 5],
    outline: [
      [5.9, 0.8],
      [9.9, 0.8],
      [9.9, 9.3],
      [5.9, 9.3],
    ],
    pin: [8.0, 4.9],
    furniture: "internals",
  },
  {
    id: "print",
    name: "Print Room",
    icon: "printer",
    accent: "#8b5cf6",
    stationSequences: [6],
    outline: [
      [0.6, 8.6],
      [3.45, 8.6],
      [3.45, 13.7],
      [0.6, 13.7],
    ],
    pin: [2.0, 10.2],
    furniture: "print",
  },
  {
    id: "checking",
    name: "Checking Room",
    icon: "check",
    accent: "#f5b400",
    stationSequences: [2],
    outline: [
      [3.45, 8.6],
      [5.9, 8.6],
      [5.9, 13.7],
      [3.45, 13.7],
    ],
    pin: [4.7, 11.2],
    furniture: "checking",
  },
  {
    id: "externals",
    name: "Externals Room",
    icon: "share",
    accent: "#06b6d4",
    stationSequences: [7],
    outline: [
      [5.9, 9.3],
      [9.9, 9.3],
      [9.9, 13.7],
      [5.9, 13.7],
    ],
    pin: [7.9, 11.5],
    furniture: "externals",
  },
];

/** Plan centre, so the model sits (and orbits) around the origin. */
export const FLOOR_CENTER: [number, number] = [5.25, 7.25];

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
