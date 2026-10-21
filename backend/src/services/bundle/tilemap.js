/**
 * A tile-grid map of India: every state and union territory is one equal-sized
 * square placed roughly where it sits on the map (x = west to east, y = north
 * to south). Equal tiles keep small states such as Goa or Delhi as readable as
 * Rajasthan, which a true-to-scale map cannot do. The coordinates travel inside
 * each bundle snapshot so the screen and the PDF draw the identical map.
 */
export const TILE_GRID = Object.freeze({
  JK: [2, 0], LA: [3, 0],
  CH: [1, 1], PB: [2, 1], HP: [3, 1], UK: [4, 1],
  HR: [2, 2], DL: [3, 2], UP: [4, 2], BR: [5, 2], SK: [6, 2], AS: [7, 2], AR: [8, 2],
  RJ: [1, 3], MP: [3, 3], CG: [4, 3], JH: [5, 3], WB: [6, 3], ML: [7, 3], NL: [8, 3],
  GJ: [1, 4], MH: [3, 4], OD: [5, 4], TR: [7, 4], MN: [8, 4],
  DD: [2, 5], TG: [4, 5], AP: [5, 5], MZ: [8, 5],
  GA: [2, 6], KA: [3, 6],
  LD: [2, 7], KL: [3, 7], TN: [4, 7], PY: [5, 7], AN: [8, 7],
});

export const TILE_COLUMNS = 9;
export const TILE_ROWS = 8;
