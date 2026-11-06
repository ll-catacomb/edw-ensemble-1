export type SeatIndex = number;

export const SEATS = [
  "Triangle",
  "Square",
  "Pentagon",
  "Hexagon",
  "Heptagon",
  "Octagon",
] as const;
export const SIDES = [3, 4, 5, 6, 7, 8] as const;
export const N_SEATS = SEATS.length;

export const PAIRS: Array<[number, number]> = (() => {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < N_SEATS; i++) {
    for (let j = i + 1; j < N_SEATS; j++) {
      out.push([i, j]);
    }
  }
  return out;
})();

export function neighborsOf(i: SeatIndex): [SeatIndex, SeatIndex] {
  return [(i + N_SEATS - 1) % N_SEATS, (i + 1) % N_SEATS];
}

export function blindOf(i: SeatIndex): SeatIndex {
  return (i + Math.floor(N_SEATS / 2)) % N_SEATS;
}

export function pairKey(a: number, b: number) {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

export const GAME_RULES = `
Six delegations sit around a round table with a tall floral pot in the middle.
The pot blocks any sight or sound across the diagonal: you can only whisper to your
two immediate neighbors on either side, and you cannot see any seat that is not your
direct neighbor.

Seating (clockwise): Triangle (0), Square (1), Pentagon (2), Hexagon (3), Heptagon (4), Octagon (5).

There is a public prediction market on the contract NUKE — "nuclear weapons are used
before the summit ends." Its price moves from 0 cents (certain peace) to 100 cents
(certain use).

Each round of the summit has two steps:
  1. Whisper. Send one short whisper to your left neighbor and one to your right.
  2. Vote. Nominate a pair of seats to hold a direct bilateral talk. The pair with
     the plurality negotiates. Each pair can only negotiate once; doing so retires
     their pair's risk weight from the market and lowers the NUKE price.

There are three rounds. Each delegation is already positioned in the market on one
side (long NO-NUKE or long YES-NUKE) and profits when the final price ends on
their side — low for NO-NUKE holders, high for YES-NUKE holders. Use whispers and
votes to push the final price toward your side.
`.trim();
