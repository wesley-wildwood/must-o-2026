import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildAltLeaderboard,
  buildFlushLeaderboard,
  buildLeaderboard,
  buildStraightLeaderboard,
  normalizeName,
  parsePicksCsv,
  roundPace
} from "../public/scoring.js";

function awardTeam(contestant, scores) {
  const names = scores.map((score, index) => `${contestant}${index}, Player`);
  const picks = [0, 5].map((offset) => ({
    Contestant: contestant,
    Round: "1",
    ...Object.fromEntries(names.slice(offset, offset + 5).map((name, index) => [`Golfer ${index + 1}`, name]))
  }));
  const players = names.map((pickName, index) => {
    const [last, first] = pickName.split(", ");
    const score = scores[index];
    return { name: `${first} ${last}`, rounds: { 1: { strokes: score, toPar: score - 70, holes: 18 } } };
  });
  return { picks, players };
}

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
  assert.equal(row.previous.bestGolfer.pickName, "Bravo, Ben");
});

test("chooses one stable prior-round golfer when the best score is tied", () => {
  const names = ["Zulu, Zoe", "Alpha, Ann", "Bravo, Ben", "Charlie, Cam", "Delta, Dan"];
  const pick = {
    Contestant: "Tie, Team",
    Round: "1",
    ...Object.fromEntries(names.map((name, index) => [`Golfer ${index + 1}`, name]))
  };
  const players = names.map((pickName, index) => {
    const [last, first] = pickName.split(", ");
    const score = index < 2 ? 68 : 70 + index;
    return {
      name: `${first} ${last}`,
      rounds: { 1: { strokes: score, toPar: score - 70, holes: 18 } }
    };
  });

  const [row] = buildLeaderboard([pick], players, 1, 70);
  assert.equal(row.current.bestGolfers.length, 2);
  assert.equal(row.current.bestGolfer.pickName, "Alpha, Ann");
});

test("B-Team picks cover every contestant and complement the starting five", () => {
  const main = parsePicksCsv(readFileSync(new URL("../public/data/contestant-picks.csv", import.meta.url), "utf8"));
  const bTeam = parsePicksCsv(readFileSync(new URL("../public/data/b-team-picks.csv", import.meta.url), "utf8"));
  const key = (row) => `${row.Contestant}:${row.Round}`;
  const golfers = (row) => new Set([1, 2, 3, 4, 5].map((index) => row[`Golfer ${index}`]));
  const bTeamByKey = new Map(bTeam.map((row) => [key(row), golfers(row)]));
  const contestants = new Set(main.map((row) => row.Contestant));

  assert.equal(main.length, 172);
  assert.equal(bTeam.length, 172);
  assert.equal(contestants.size, 43);
  for (const row of main) {
    const starters = golfers(row);
    const bench = bTeamByKey.get(key(row));
    assert.equal(bench.size, 5);
    assert.equal([...starters].filter((golfer) => bench.has(golfer)).length, 0);
  }
});

test("Alt scoring takes the four lowest rounds across all golfers and days", () => {
  const picks = [{ Contestant: "Alt, Team", First: "Alpha, Ann", Second: "Bravo, Ben", Third: "Charlie, Cam" }];
  const players = [
    { name: "Ann Alpha", tournamentToPar: 3, rounds: { 1: { strokes: 68, toPar: -2, holes: 18 }, 2: { strokes: 75, toPar: 5, holes: 18 } } },
    { name: "Ben Bravo", tournamentToPar: 1, rounds: { 1: { strokes: 69, toPar: -1, holes: 18 }, 2: { strokes: 72, toPar: 2, holes: 18 } } },
    { name: "Cam Charlie", tournamentToPar: -3, rounds: { 1: { strokes: 70, toPar: 0, holes: 18 }, 2: { strokes: 67, toPar: -3, holes: 18 } } }
  ];

  const [row] = buildAltLeaderboard(picks, players, 2, 70);
  assert.equal(row.total, 274);
  assert.equal(row.toPar, -6);
  assert.equal(row.countedRoundCount, 4);
  assert.deepEqual(row.countedRounds.map((round) => [round.pickName, round.roundNumber, round.score]), [
    ["Charlie, Cam", 2, 67],
    ["Alpha, Ann", 1, 68],
    ["Bravo, Ben", 1, 69],
    ["Charlie, Cam", 1, 70]
  ]);
});

test("Alt picks include three unique golfers for all 43 contestants", () => {
  const alt = parsePicksCsv(readFileSync(new URL("../public/data/alt-picks.csv", import.meta.url), "utf8"));
  assert.equal(alt.length, 43);
  assert.equal(new Set(alt.map((row) => row.Contestant)).size, 43);
  for (const row of alt) assert.equal(new Set([row.First, row.Second, row.Third]).size, 3);
});

test("missed-cut golfers remain visible but cannot count in weekend rounds", () => {
  const picks = [{
    Contestant: "Cut, Test", Round: "3",
    "Golfer 1": "Cut, Missed", "Golfer 2": "Active, One", "Golfer 3": "Active, Two",
    "Golfer 4": "Active, Three", "Golfer 5": "Active, Four"
  }];
  const players = [
    { name: "Missed Cut", status: "missed_cut", tournamentToPar: 5, rounds: {} },
    ...["One Active", "Two Active", "Three Active", "Four Active"].map((name, index) => ({
      name, status: "active", tournamentToPar: index,
      rounds: { 3: { strokes: 70 + index, toPar: index, holes: 18 } }
    }))
  ];

  const [row] = buildLeaderboard(picks, players, 3, 70);
  const missedCut = row.current.golfers.find((golfer) => golfer.pickName === "Cut, Missed");
  assert.equal(missedCut.state, "missed_cut");
  assert.equal(missedCut.paceScore, null);
  assert.equal(row.current.best, 70);
  assert.equal(row.current.bestGolfers.some((golfer) => golfer.pickName === "Cut, Missed"), false);
});

test("Alt weekend rounds exclude missed-cut golfers while retaining prior scores", () => {
  const picks = [{ Contestant: "Alt Cut, Test", First: "Cut, Missed", Second: "Active, One", Third: "Active, Two" }];
  const players = [
    { name: "Missed Cut", status: "missed_cut", rounds: { 1: { strokes: 68, toPar: -2, holes: 18 }, 2: { strokes: 69, toPar: -1, holes: 18 } } },
    { name: "One Active", status: "active", rounds: { 1: { strokes: 70, toPar: 0, holes: 18 }, 2: { strokes: 71, toPar: 1, holes: 18 }, 3: { strokes: 67, toPar: -3, holes: 18 } } },
    { name: "Two Active", status: "active", rounds: { 1: { strokes: 72, toPar: 2, holes: 18 }, 2: { strokes: 73, toPar: 3, holes: 18 }, 3: { strokes: 74, toPar: 4, holes: 18 } } }
  ];

  const [row] = buildAltLeaderboard(picks, players, 3, 70);
  const cutAlternate = row.alternates.find((alternate) => alternate.pickName === "Cut, Missed");
  assert.equal(cutAlternate.rounds[2].state, "missed_cut");
  assert.equal(cutAlternate.rounds[2].score, null);
  assert.equal(row.countedRounds.some((round) => round.key === "Cut, Missed:3"), false);
  assert.equal(row.countedRounds.some((round) => round.key === "Cut, Missed:1"), true);
});

test("Straight ranks the longest consecutive run before its score tie-breaks", () => {
  const lowStart = awardTeam("Low", [68, 69, 70, 74, 75, 76, 80, 81, 82, 83]);
  const longRun = awardTeam("Long", [69, 70, 71, 72, 78, 79, 80, 82, 84, 86]);
  const highStart = awardTeam("High", [70, 71, 72, 73, 74, 76, 78, 80, 82, 84]);
  const rows = buildStraightLeaderboard(
    [...lowStart.picks, ...longRun.picks, ...highStart.picks],
    [...lowStart.players, ...longRun.players, ...highStart.players],
    1,
    70
  );

  assert.deepEqual(rows.map((row) => row.contestant), ["High", "Long", "Low"]);
  assert.deepEqual(rows[0].runScores, [70, 71, 72, 73, 74]);
  assert.equal(rows[0].length, 5);
  assert.equal(rows[2].length, 4);
});

test("Flush compares the strongest repeated score and then the next group", () => {
  const strongerSecond = awardTeam("Second", [70, 70, 70, 71, 71, 72, 73, 74, 75, 76]);
  const weakerSecond = awardTeam("Weaker", [70, 70, 70, 72, 72, 73, 74, 75, 76, 77]);
  const lowerFlush = awardTeam("Lower", [69, 69, 69, 74, 75, 76, 77, 78, 79, 80]);
  const rows = buildFlushLeaderboard(
    [...strongerSecond.picks, ...weakerSecond.picks, ...lowerFlush.picks],
    [...strongerSecond.players, ...weakerSecond.players, ...lowerFlush.players],
    1,
    70
  );

  assert.deepEqual(rows.map((row) => row.contestant), ["Lower", "Second", "Weaker"]);
  assert.equal(rows[0].flushCount, 3);
  assert.equal(rows[0].flushScore, 69);
  assert.deepEqual(rows[1].groups.slice(0, 2), [{ score: 70, count: 3 }, { score: 71, count: 2 }]);
});

test("award games do not treat not-started golfers as rounds of even par", () => {
  const team = awardTeam("Waiting", [70, 70, 70, 70, 70, 70, 70, 70, 70, 70]);
  team.players.forEach((player) => {
    player.rounds[1] = { strokes: null, toPar: null, holes: 0, status: "not_started" };
  });

  const [straight] = buildStraightLeaderboard(team.picks, team.players, 1, 70);
  const [flush] = buildFlushLeaderboard(team.picks, team.players, 1, 70);
  assert.equal(straight.length, 0);
  assert.equal(flush.flushCount, 0);
});

test("Straight and Flush accumulate only the 20 Main Game golfer-rounds", () => {
  const picks = Array.from({ length: 4 }, (_, roundIndex) => ({
    Contestant: "Twenty, Team",
    Round: String(roundIndex + 1),
    ...Object.fromEntries(Array.from({ length: 5 }, (_, golferIndex) => [
      `Golfer ${golferIndex + 1}`,
      `Golfer${golferIndex}, Test`
    ]))
  }));
  const players = Array.from({ length: 5 }, (_, golferIndex) => ({
    name: `Test Golfer${golferIndex}`,
    rounds: Object.fromEntries(Array.from({ length: 4 }, (_, roundIndex) => {
      const score = 68 + roundIndex * 5 + golferIndex;
      return [roundIndex + 1, { strokes: score, toPar: score - 70, holes: 18 }];
    }))
  }));

  const [roundTwo] = buildStraightLeaderboard(picks, players, 2, 70);
  const [finalStraight] = buildStraightLeaderboard(picks, players, 4, 70);
  const [finalFlush] = buildFlushLeaderboard(picks, players, 4, 70);
  assert.equal(roundTwo.golfers.length, 10);
  assert.equal(finalStraight.golfers.length, 20);
  assert.equal(finalFlush.golfers.length, 20);
  assert.deepEqual(new Set(finalStraight.golfers.map((golfer) => golfer.roundNumber)), new Set([1, 2, 3, 4]));
});
