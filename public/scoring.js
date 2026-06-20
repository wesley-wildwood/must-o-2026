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
    return {
      contestant,
      current: contestantRows.get(`${contestant}:${selectedRound}`),
      previous: selectedRound > 1 ? contestantRows.get(`${contestant}:${selectedRound - 1}`) : null,
      roundScores: scores,
      total: complete ? scores.reduce((sum, score) => sum + score, 0) : null
    };
  });

  contestants.sort((a, b) => (a.total ?? Infinity) - (b.total ?? Infinity) || a.contestant.localeCompare(b.contestant));
  let previousTotal = null;
  let previousRank = 0;
  return contestants.map((entry, index) => {
    const rank = entry.total === previousTotal ? previousRank : index + 1;
    previousTotal = entry.total;
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
      countedRoundCount: countedRounds.length,
      total,
      toPar
    };
  });

  rows.sort((a, b) => (a.toPar ?? Infinity) - (b.toPar ?? Infinity) || a.contestant.localeCompare(b.contestant));
  let previousScore = null;
  let previousRank = 0;
  return rows.map((entry, index) => {
    const rank = entry.toPar === previousScore ? previousRank : index + 1;
    previousScore = entry.toPar;
    previousRank = rank;
    return { ...entry, rank };
  });
}

export function formatToPar(score, parTotal) {
  if (score == null) return "—";
  const value = score - parTotal;
  return value === 0 ? "E" : value > 0 ? `+${value}` : String(value);
}
