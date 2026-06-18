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

export function buildLeaderboard(picks, livePlayers, selectedRound, par = 70) {
  const playersByName = new Map(livePlayers.map((player) => [normalizeName(player.name), player]));
  const contestantRows = new Map();

  for (const pick of picks) {
    const round = Number(pick.Round);
    const golfers = [1, 2, 3, 4, 5].map((index) => {
      const pickName = pick[`Golfer ${index}`];
      const player = playersByName.get(normalizeName(pickNameToDisplay(pickName)));
      const roundData = player?.rounds?.[round] || player?.rounds?.[String(round)] || null;
      const pace = roundPace(roundData, par);
      return {
        pickName,
        displayName: player?.name || pickNameToDisplay(pickName),
        player,
        round: roundData,
        paceScore: pace.score,
        state: pace.state
      };
    });
    const valid = golfers.filter((golfer) => golfer.paceScore != null);
    const best = valid.length ? Math.min(...valid.map((golfer) => golfer.paceScore)) : null;
    contestantRows.set(`${pick.Contestant}:${round}`, { contestant: pick.Contestant, round, golfers, best });
  }

  const contestants = [...new Set(picks.map((pick) => pick.Contestant))].map((contestant) => {
    const roundRows = Array.from({ length: selectedRound }, (_, index) => contestantRows.get(`${contestant}:${index + 1}`));
    const scores = roundRows.map((row) => row?.best ?? null);
    const complete = scores.every((score) => score != null);
    return {
      contestant,
      current: contestantRows.get(`${contestant}:${selectedRound}`),
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

export function formatToPar(score, parTotal) {
  if (score == null) return "—";
  const value = score - parTotal;
  return value === 0 ? "E" : value > 0 ? `+${value}` : String(value);
}
