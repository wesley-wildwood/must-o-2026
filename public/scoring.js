export function normalizeName(name = "") {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ø/g, "o")
    .replace(/Ø/g, "O")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
}

export function pickNameToDisplay(name) {
  const [last, first] = name.split(",").map((part) => part.trim());
  return first ? `${first} ${last}` : name;
}

export function parsePicksCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"' && quoted && text[index + 1] === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const headers = rows.shift();
  return rows.map((values) => Object.fromEntries(headers.map((header, i) => [header, values[i] || ""])));
}

export function roundPace(round, par = 70) {
  if (!round) return { score: par, state: "not_started" };
  if (round.strokes != null && round.holes >= 18) return { score: round.strokes, state: "complete" };
  if (round.toPar != null) return { score: par + round.toPar, state: round.holes > 0 ? "playing" : "not_started" };
  if (round.status === "not_started") return { score: par, state: "not_started" };
  return { score: null, state: round.status || "unavailable" };
}

function playerRoundPace(player, roundNumber, par) {
  if (roundNumber >= 3 && (player?.status === "missed_cut" || player?.status === "withdrawn")) {
    return { score: null, state: player.status };
  }
  const round = player?.rounds?.[roundNumber] || player?.rounds?.[String(roundNumber)] || null;
  return { ...roundPace(round, par), round };
}

function compareScoreSequences(left = [], right = []) {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? Infinity) - (right[index] ?? Infinity);
    if (difference) return difference;
  }
  return 0;
}

export function buildLeaderboard(picks, livePlayers, selectedRound, par = 70) {
  const playersByName = new Map(livePlayers.map((player) => [normalizeName(player.name), player]));
  const contestantRows = new Map();

  for (const pick of picks) {
    const round = Number(pick.Round);
    const golfers = [1, 2, 3, 4, 5].map((index) => {
      const pickName = pick[`Golfer ${index}`];
      const player = playersByName.get(normalizeName(pickNameToDisplay(pickName)));
      const pace = playerRoundPace(player, round, par);
      return {
        pickName,
        displayName: player?.name || pickNameToDisplay(pickName),
        player,
        round: pace.round || null,
        paceScore: pace.score,
        state: pace.state
      };
    });
    const valid = golfers.filter((golfer) => golfer.paceScore != null);
    const best = valid.length ? Math.min(...valid.map((golfer) => golfer.paceScore)) : null;
    const sortedGolfers = [...golfers].sort((a, b) => {
      const scoreDifference = (a.paceScore ?? Infinity) - (b.paceScore ?? Infinity);
      if (scoreDifference) return scoreDifference;
      const tournamentDifference = (a.player?.tournamentToPar ?? Infinity) - (b.player?.tournamentToPar ?? Infinity);
      return tournamentDifference || a.pickName.localeCompare(b.pickName);
    });
    const bestGolfers = sortedGolfers.filter((golfer) => golfer.paceScore != null && golfer.paceScore === best);
    const bestGolfer = bestGolfers.length
      ? [...bestGolfers].sort((a, b) => a.pickName.localeCompare(b.pickName))[0]
      : null;
    contestantRows.set(`${pick.Contestant}:${round}`, {
      contestant: pick.Contestant,
      round,
      golfers: sortedGolfers,
      best,
      bestGolfers,
      bestGolfer
    });
  }

  const contestants = [...new Set(picks.map((pick) => pick.Contestant))].map((contestant) => {
    const roundRows = Array.from({ length: selectedRound }, (_, index) => contestantRows.get(`${contestant}:${index + 1}`));
    const scores = roundRows.map((row) => row?.best ?? null);
    const complete = scores.every((score) => score != null);
    const tieBreakScores = roundRows.flatMap((row) => {
      if (!row || row.best == null) return [];
      const candidates = row.golfers.map((golfer) => golfer.paceScore).filter((score) => score != null).sort((a, b) => a - b);
      const countedIndex = candidates.indexOf(row.best);
      if (countedIndex >= 0) candidates.splice(countedIndex, 1);
      return candidates;
    }).sort((a, b) => a - b);
    return {
      contestant,
      current: contestantRows.get(`${contestant}:${selectedRound}`),
      previous: selectedRound > 1 ? contestantRows.get(`${contestant}:${selectedRound - 1}`) : null,
      roundScores: scores,
      tieBreakScores,
      total: complete ? scores.reduce((sum, score) => sum + score, 0) : null
    };
  });

  const compare = (a, b) => (a.total ?? Infinity) - (b.total ?? Infinity) || compareScoreSequences(a.tieBreakScores, b.tieBreakScores);
  contestants.sort((a, b) => compare(a, b) || a.contestant.localeCompare(b.contestant));
  let previous = null;
  let previousRank = 0;
  return contestants.map((entry, index) => {
    const rank = previous && compare(previous, entry) === 0 ? previousRank : index + 1;
    previous = entry;
    previousRank = rank;
    return { ...entry, rank };
  });
}

export function buildAltLeaderboard(picks, livePlayers, throughRound, par = 70) {
  const playersByName = new Map(livePlayers.map((player) => [normalizeName(player.name), player]));
  const rows = picks.map((pick) => {
    const alternates = ["First", "Second", "Third"].map((column) => {
      const pickName = pick[column];
      const player = playersByName.get(normalizeName(pickNameToDisplay(pickName)));
      const rounds = Array.from({ length: throughRound }, (_, index) => {
        const roundNumber = index + 1;
        const pace = playerRoundPace(player, roundNumber, par);
        return {
          key: `${pickName}:${roundNumber}`,
          roundNumber,
          round: pace.round || null,
          score: pace.score,
          state: pace.state,
          counting: false
        };
      });
      return { pickName, player, rounds };
    });

    const postedRounds = alternates
      .flatMap((alternate) => alternate.rounds.map((round) => ({ ...round, pickName: alternate.pickName })))
      .filter((round) => round.score != null)
      .sort((a, b) => a.score - b.score || a.roundNumber - b.roundNumber || a.pickName.localeCompare(b.pickName));
    const countedRounds = postedRounds.slice(0, 4);
    const uncountedRounds = postedRounds.slice(4);
    const countingKeys = new Set(countedRounds.map((round) => round.key));
    const displayedAlternates = alternates.map((alternate) => ({
      ...alternate,
      rounds: alternate.rounds.map((round) => ({ ...round, counting: countingKeys.has(round.key) }))
    }));
    const total = countedRounds.length ? countedRounds.reduce((sum, round) => sum + round.score, 0) : null;
    const toPar = total == null ? null : total - par * countedRounds.length;

    return {
      contestant: pick.Contestant,
      alternates: displayedAlternates,
      countedRounds,
      uncountedRounds,
      tieBreakScores: uncountedRounds.map((round) => round.score),
      countedRoundCount: countedRounds.length,
      total,
      toPar
    };
  });

  const bestScore = Math.min(...rows.map((row) => row.toPar ?? Infinity));
  rows.sort((a, b) => {
    const scoreDifference = (a.toPar ?? Infinity) - (b.toPar ?? Infinity);
    if (scoreDifference) return scoreDifference;
    if (a.toPar === bestScore) {
      const tieBreakDifference = compareScoreSequences(a.tieBreakScores, b.tieBreakScores);
      if (tieBreakDifference) return tieBreakDifference;
    }
    return a.contestant.localeCompare(b.contestant);
  });
  const first = rows[0];
  let previousScore = null;
  let previousRank = 0;
  return rows.map((entry, index) => {
    let rank;
    if (entry.toPar === bestScore) {
      rank = first && compareScoreSequences(first.tieBreakScores, entry.tieBreakScores) === 0 ? 1 : 2;
    } else {
      rank = entry.toPar === previousScore ? previousRank : index + 1;
    }
    previousScore = entry.toPar;
    previousRank = rank;
    return { ...entry, rank };
  });
}

function buildEligibleGolfers(picks, livePlayers, selectedRound, par) {
  const playersByName = new Map(livePlayers.map((player) => [normalizeName(player.name), player]));
  const teams = new Map();

  for (const pick of picks.filter((entry) => Number(entry.Round) <= selectedRound)) {
    const roundNumber = Number(pick.Round);
    const golfers = teams.get(pick.Contestant) || [];
    for (let index = 1; index <= 5; index += 1) {
      const pickName = pick[`Golfer ${index}`];
      if (!pickName) continue;
      const player = playersByName.get(normalizeName(pickNameToDisplay(pickName)));
      const pace = playerRoundPace(player, roundNumber, par);
      golfers.push({
        key: `${roundNumber}:${normalizeName(pickName)}`,
        roundNumber,
        pickName,
        displayName: player?.name || pickNameToDisplay(pickName),
        player,
        round: pace.round || null,
        paceScore: pace.score,
        awardScore: pace.state === "not_started" ? null : pace.score,
        state: pace.state,
        counting: false
      });
    }
    teams.set(pick.Contestant, golfers);
  }

  return [...teams].map(([contestant, golfers]) => ({ contestant, golfers }));
}

function rankedRows(rows, compare, sameRank) {
  rows.sort((a, b) => compare(a, b) || a.contestant.localeCompare(b.contestant));
  let previous = null;
  let previousRank = 0;
  return rows.map((row, index) => {
    const rank = previous && sameRank(previous, row) ? previousRank : index + 1;
    previous = row;
    previousRank = rank;
    return { ...row, rank };
  });
}

export function buildStraightLeaderboard(picks, livePlayers, selectedRound, par = 70) {
  const rows = buildEligibleGolfers(picks, livePlayers, selectedRound, par).map((team) => {
    const scores = [...new Set(team.golfers.map((golfer) => golfer.awardScore).filter((score) => score != null))].sort((a, b) => a - b);
    const runs = [];
    for (let startIndex = 0; startIndex < scores.length; startIndex += 1) {
      let endIndex = startIndex;
      while (endIndex + 1 < scores.length && scores[endIndex + 1] === scores[endIndex] + 1) endIndex += 1;
      const runScores = scores.slice(startIndex, endIndex + 1);
      const runSet = new Set(runScores);
      const outsideScore = scores.find((score) => !runSet.has(score)) ?? Infinity;
      runs.push({ runScores, length: runScores.length, startScore: runScores[0], outsideScore });
      startIndex = endIndex;
    }
    const bestRun = runs.sort((a, b) => b.length - a.length || a.startScore - b.startScore || a.outsideScore - b.outsideScore)[0]
      || { runScores: [], length: 0, startScore: Infinity, outsideScore: Infinity };
    const highlightedScores = new Set(bestRun.runScores);
    const golfers = team.golfers
      .map((golfer) => ({ ...golfer, counting: highlightedScores.has(golfer.awardScore) }))
      .sort((a, b) => (a.paceScore ?? Infinity) - (b.paceScore ?? Infinity) || a.pickName.localeCompare(b.pickName));
    return { ...team, golfers, ...bestRun };
  });
  const compare = (a, b) => {
    if (a.length !== b.length) return b.length - a.length;
    if (a.startScore !== b.startScore) return a.startScore - b.startScore;
    if (a.outsideScore !== b.outsideScore) return a.outsideScore - b.outsideScore;
    return 0;
  };
  return rankedRows(rows, compare, (a, b) => compare(a, b) === 0);
}

function compareFlushGroups(a = [], b = []) {
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const left = a[index] || { count: 0, score: Infinity };
    const right = b[index] || { count: 0, score: Infinity };
    if (left.count !== right.count) return right.count - left.count;
    if (left.score !== right.score) return left.score - right.score;
  }
  return 0;
}

export function buildFlushLeaderboard(picks, livePlayers, selectedRound, par = 70) {
  const rows = buildEligibleGolfers(picks, livePlayers, selectedRound, par).map((team) => {
    const counts = new Map();
    for (const golfer of team.golfers) {
      if (golfer.awardScore != null) counts.set(golfer.awardScore, (counts.get(golfer.awardScore) || 0) + 1);
    }
    const groups = [...counts].map(([score, count]) => ({ score, count })).sort((a, b) => b.count - a.count || a.score - b.score);
    const primary = groups[0] || { score: null, count: 0 };
    const golfers = team.golfers
      .map((golfer) => ({ ...golfer, counting: golfer.awardScore != null && golfer.awardScore === primary.score }))
      .sort((a, b) => (a.paceScore ?? Infinity) - (b.paceScore ?? Infinity) || a.pickName.localeCompare(b.pickName));
    return { ...team, golfers, groups, flushScore: primary.score, flushCount: primary.count };
  });
  return rankedRows(rows, (a, b) => compareFlushGroups(a.groups, b.groups), (a, b) => compareFlushGroups(a.groups, b.groups) === 0);
}

export function formatToPar(score, parTotal) {
  if (score == null) return "—";
  const value = score - parTotal;
  return value === 0 ? "E" : value > 0 ? `+${value}` : String(value);
}
