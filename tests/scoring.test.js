import test from "node:test";
import assert from "node:assert/strict";
import { buildLeaderboard, normalizeName, parsePicksCsv, roundPace } from "../public/scoring.js";

test("normalizes accented live-feed names", () => {
  assert.equal(normalizeName("Ludvig Åberg"), normalizeName("Ludvig Aberg"));
  assert.equal(normalizeName("Nicolai Højgaard"), normalizeName("Nicolai Hojgaard"));
});

test("parses quoted golfer names from CSV", () => {
  const rows = parsePicksCsv('Contestant,Round,Golfer 1\r\n"Smith, Sam",1,"McIlroy, Rory"\r\n');
  assert.deepEqual(rows, [{ Contestant: "Smith, Sam", Round: "1", "Golfer 1": "McIlroy, Rory" }]);
});

test("uses current score to par as 18-hole pace", () => {
  assert.deepEqual(roundPace({ strokes: 34, toPar: -1, holes: 9 }, 70), { score: 69, state: "playing" });
  assert.deepEqual(roundPace({ strokes: 68, toPar: -2, holes: 18 }, 70), { score: 68, state: "complete" });
  assert.deepEqual(roundPace({ strokes: null, toPar: null, holes: 0, status: "not_started" }, 70), { score: 70, state: "not_started" });
});

test("ranks by prior best plus current round pace", () => {
  const picks = ["A", "B"].flatMap((contestant) => [1, 2].map((round) => ({
    Contestant: contestant,
    Round: String(round),
    "Golfer 1": `${contestant}${round}, Player`,
    "Golfer 2": `${contestant}${round}x, Player`,
    "Golfer 3": `${contestant}${round}y, Player`,
    "Golfer 4": `${contestant}${round}z, Player`,
    "Golfer 5": `${contestant}${round}q, Player`
  })));
  const players = picks.flatMap((pick) => [1, 2, 3, 4, 5].map((index) => {
    const pickName = pick[`Golfer ${index}`];
    const [last, first] = pickName.split(", ");
    const round = Number(pick.Round);
    const contestant = pick.Contestant;
    const score = contestant === "A" ? (round === 1 ? 68 : 71) : (round === 1 ? 70 : 67);
    return { name: `${first} ${last}`, rounds: { [round]: { strokes: score, toPar: score - 70, holes: 18 } } };
  }));
  const rows = buildLeaderboard(picks, players, 2, 70);
  assert.equal(rows[0].contestant, "B");
  assert.equal(rows[0].total, 137);
  assert.equal(rows[1].total, 139);
});

test("sorts golfers by round score and exposes the prior-round winner", () => {
  const golferNames = ["Alpha, Ann", "Bravo, Ben", "Charlie, Cam", "Delta, Dan", "Echo, Eve"];
  const picks = [1, 2].map((round) => ({
    Contestant: "Pool, Player",
    Round: String(round),
    ...Object.fromEntries(golferNames.map((name, index) => [`Golfer ${index + 1}`, name]))
  }));
  const roundOne = [72, 68, 71, 70, 69];
  const roundTwo = [70, 72, 68, 71, 69];
  const players = golferNames.map((pickName, index) => {
    const [last, first] = pickName.split(", ");
    return {
      name: `${first} ${last}`,
      tournamentToPar: roundOne[index] + roundTwo[index] - 140,
      rounds: {
        1: { strokes: roundOne[index], toPar: roundOne[index] - 70, holes: 18 },
        2: { strokes: roundTwo[index], toPar: roundTwo[index] - 70, holes: 18 }
      }
    };
  });

  const [row] = buildLeaderboard(picks, players, 2, 70);
  assert.deepEqual(row.current.golfers.map((golfer) => golfer.pickName), [
    "Charlie, Cam", "Echo, Eve", "Alpha, Ann", "Delta, Dan", "Bravo, Ben"
  ]);
  assert.equal(row.previous.best, 68);
  assert.equal(row.previous.bestGolfers[0].pickName, "Bravo, Ben");
});
