import { buildAltLeaderboard, buildLeaderboard, formatToPar, parsePicksCsv } from "./scoring.js";

const state = { picks: { main: [], bteam: [], alt: [] }, live: null, selectedGame: "main", selectedRound: 1, query: "" };
const elements = {
  leaderboard: document.querySelector("#leaderboard"),
  gameTabs: document.querySelector("#gameTabs"),
  tabs: document.querySelector("#roundTabs"),
  summary: document.querySelector("#summary"),
  status: document.querySelector("#liveStatus"),
  updated: document.querySelector("#updatedAt"),
  title: document.querySelector("#boardTitle"),
  kicker: document.querySelector("#boardKicker"),
  teamHeader: document.querySelector("#teamHeader"),
  cumulativeHeader: document.querySelector("#cumulativeHeader"),
  roundHeader: document.querySelector("#roundHeader"),
  golfersHeader: document.querySelector("#golfersHeader"),
  search: document.querySelector("#searchInput")
};

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function relativeScore(value, par = 70) {
  if (value == null) return "—";
  const difference = value - par;
  return difference === 0 ? "E" : difference > 0 ? `+${difference}` : String(difference);
}

function tournamentScore(value) {
  if (value == null) return "—";
  return value === 0 ? "E" : value > 0 ? `+${value}` : String(value);
}

function golferStatus(golfer) {
  const round = golfer.round;
  if (!round || golfer.state === "not_started") {
    if (round?.teeTime) return new Date(round.teeTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return "Not started";
  }
  if (golfer.state === "complete") return "F";
  return `Thru ${round.holes}`;
}

function golferCard(golfer, best, selectedRound) {
  const isCounting = golfer.paceScore != null && golfer.paceScore === best;
  const score = relativeScore(golfer.paceScore);
  return `<div class="golfer ${isCounting ? "counting" : ""}">
    <div class="golfer-top">
      <span class="golfer-name">${escapeHtml(golfer.pickName)}</span>
      ${isCounting ? '<span class="counts">Counts</span>' : ""}
    </div>
    <div class="golfer-metrics">
      <div class="golfer-metric"><span>R${selectedRound}</span><strong>${score}</strong></div>
      <div class="golfer-metric tournament"><span>Total</span><strong>${tournamentScore(golfer.player?.tournamentToPar)}</strong></div>
      <span class="golfer-progress">${golferStatus(golfer)}</span>
    </div>
  </div>`;
}

function priorRoundSummary(row) {
  if (!row.previous) return '<span class="round-history">Opening round</span>';
  const golferName = row.previous.bestGolfer?.pickName;
  return `<span class="prior-best">R${row.previous.round} · ${escapeHtml(golferName || "No score")} <b>${row.previous.best ?? "—"}</b></span>`;
}

function altGolferCard(alternate) {
  const rounds = alternate.rounds.map((round) => `<div class="alt-round ${round.counting ? "counting" : ""}">
    <span>R${round.roundNumber}</span><strong>${relativeScore(round.score)}</strong><small>${golferStatus(round)}</small>
  </div>`).join("");
  return `<div class="alt-golfer">
    <div class="alt-golfer-top"><span class="golfer-name">${escapeHtml(alternate.pickName)}</span><span class="alt-total">Total ${tournamentScore(alternate.player?.tournamentToPar)}</span></div>
    <div class="alt-rounds">${rounds}</div>
  </div>`;
}

function renderSummary(rows) {
  const leader = rows[0];
  const leaderLabel = state.selectedGame === "bteam" ? "Current B-Team leader" : state.selectedGame === "alt" ? "Current Alt leader" : "Current leader";
  const onCourse = state.live.players.filter((player) => player.rounds?.[state.selectedRound]?.status === "playing").length;
  const completed = state.live.players.filter((player) => player.rounds?.[state.selectedRound]?.status === "complete").length;
  if (state.selectedGame === "alt") {
    elements.summary.innerHTML = `
      <article class="summary-feature"><span>${leaderLabel}</span><strong>${escapeHtml(leader?.contestant || "—")}</strong><small>${leader?.toPar == null ? "No score" : tournamentScore(leader.toPar)} · ${leader?.countedRoundCount || 0}/4 rounds counted through R${state.selectedRound}</small></article>
      <article><span>Leading total</span><strong>${leader?.total ?? "—"}</strong><small>Best ${leader?.countedRoundCount || 0}/4 rounds</small></article>
      <article><span>On the course</span><strong>${onCourse}</strong><small>${completed} finished today</small></article>
      <article><span>Field</span><strong>43</strong><small>Alt teams</small></article>`;
    return;
  }
  elements.summary.innerHTML = `
    <article class="summary-feature"><span>${leaderLabel}</span><strong>${escapeHtml(leader?.contestant || "—")}</strong><small>${leader?.total == null ? "No score" : formatToPar(leader.total, 70 * state.selectedRound)} through ${state.selectedRound} round${state.selectedRound === 1 ? "" : "s"}</small></article>
    <article><span>Leading total</span><strong>${leader?.total ?? "—"}</strong><small>Projected strokes</small></article>
    <article><span>On the course</span><strong>${onCourse}</strong><small>${completed} finished today</small></article>
    <article><span>Field</span><strong>43</strong><small>Contestants</small></article>`;
}

function configureView() {
  const roundTitle = state.selectedRound === 4 ? "Final round" : `Round ${state.selectedRound}`;
  if (state.selectedGame === "alt") {
    elements.title.textContent = `Alt leaderboard through ${roundTitle}`;
    elements.kicker.textContent = "Best four rounds";
    elements.cumulativeHeader.textContent = "Best 4 total";
    elements.roundHeader.textContent = "Rounds counted";
    elements.golfersHeader.textContent = "Alternates · counting rounds highlighted";
  } else {
    elements.title.textContent = state.selectedGame === "bteam" ? `${roundTitle} B-Team leaderboard` : `${roundTitle} leaderboard`;
    elements.kicker.textContent = state.selectedGame === "bteam" ? "B-Team standings" : "Live standings";
    elements.cumulativeHeader.textContent = "Cumulative score";
    elements.roundHeader.textContent = "Round pace";
    elements.golfersHeader.textContent = "Golfers";
  }
  elements.teamHeader.textContent = "Team";
}

function renderAltRows(rows) {
  return rows.map((row) => `<article class="leader-row alt-row ${row.rank <= 3 ? `top top-${row.rank}` : ""}">
    <div class="rank"><span>${row.rank}</span></div>
    <div class="contestant"><strong>${escapeHtml(row.contestant)}</strong><span>3 alternates · best four rounds</span></div>
    <div class="total"><strong>${row.total ?? "—"}</strong><span>${tournamentScore(row.toPar)}</span></div>
    <div class="round-score"><strong>${row.countedRoundCount}/4</strong><span>Rounds</span></div>
    <div class="golfers alt-golfers">${row.alternates.map(altGolferCard).join("")}</div>
  </article>`).join("");
}

function render() {
  const activePicks = state.picks[state.selectedGame];
  if (!state.live || !activePicks.length) return;
  const altMode = state.selectedGame === "alt";
  const rows = altMode
    ? buildAltLeaderboard(activePicks, state.live.players, state.selectedRound, state.live.event.par)
    : buildLeaderboard(activePicks, state.live.players, state.selectedRound, state.live.event.par);
  const query = state.query.toLowerCase();
  const filtered = rows.filter((row) => !query || row.contestant.toLowerCase().includes(query) || (altMode
    ? row.alternates.some((alternate) => alternate.pickName.toLowerCase().includes(query))
    : row.current.golfers.some((golfer) => golfer.displayName.toLowerCase().includes(query))));

  elements.gameTabs.querySelectorAll("button").forEach((button) => {
    const active = button.dataset.game === state.selectedGame;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  elements.tabs.querySelectorAll("button").forEach((button) => button.classList.toggle("active", Number(button.dataset.round) === state.selectedRound));
  configureView();
  document.body.dataset.game = state.selectedGame;
  renderSummary(rows);

  if (!filtered.length) {
    elements.leaderboard.innerHTML = '<div class="empty"><strong>No matches found</strong><span>Try a contestant or golfer’s last name.</span></div>';
    return;
  }

  if (altMode) {
    elements.leaderboard.innerHTML = renderAltRows(filtered);
    return;
  }

  elements.leaderboard.innerHTML = filtered.map((row) => {
    const currentBest = row.current.best;
    const totalPar = state.live.event.par * state.selectedRound;
    return `<article class="leader-row ${row.rank <= 3 ? `top top-${row.rank}` : ""}">
      <div class="rank"><span>${row.rank}</span></div>
      <div class="contestant"><strong>${escapeHtml(row.contestant)}</strong>${priorRoundSummary(row)}</div>
      <div class="total"><strong>${row.total ?? "—"}</strong><span>${formatToPar(row.total, totalPar)}</span></div>
      <div class="round-score"><strong>${currentBest ?? "—"}</strong><span>${formatToPar(currentBest, state.live.event.par)}</span></div>
      <div class="golfers">${row.current.golfers.map((golfer) => golferCard(golfer, currentBest, state.selectedRound)).join("")}</div>
    </article>`;
  }).join("");
}

async function refreshScores({ initial = false } = {}) {
  try {
    const response = await fetch("/api/scores", { cache: "no-store" });
    if (!response.ok) throw new Error(`Score service returned ${response.status}`);
    state.live = await response.json();
    if (initial) state.selectedRound = Math.min(4, Math.max(1, state.live.event.currentRound || 1));
    elements.status.innerHTML = `<span></span> ${escapeHtml(state.live.event.statusDetail || state.live.event.status)}`;
    elements.status.classList.add("connected");
    elements.updated.textContent = `Updated ${new Date(state.live.updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    render();
  } catch (error) {
    elements.status.innerHTML = "<span></span> Scores delayed";
    elements.status.classList.remove("connected");
    if (!state.live) elements.leaderboard.innerHTML = `<div class="empty error"><strong>Live scores are taking a breather</strong><span>${escapeHtml(error.message)}. We’ll try again automatically.</span></div>`;
  }
}

async function init() {
  const [mainResponse, bTeamResponse, altResponse] = await Promise.all([
    fetch("/data/contestant-picks.csv"),
    fetch("/data/b-team-picks.csv"),
    fetch("/data/alt-picks.csv")
  ]);
  if (!mainResponse.ok || !bTeamResponse.ok || !altResponse.ok) throw new Error("One or more picks files could not be loaded");
  state.picks.main = parsePicksCsv(await mainResponse.text());
  state.picks.bteam = parsePicksCsv(await bTeamResponse.text());
  state.picks.alt = parsePicksCsv(await altResponse.text());
  await refreshScores({ initial: true });
  window.setInterval(refreshScores, 60_000);
}

elements.gameTabs.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-game]");
  if (!button) return;
  state.selectedGame = button.dataset.game;
  render();
});

elements.tabs.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-round]");
  if (!button) return;
  state.selectedRound = Number(button.dataset.round);
  render();
});
elements.search.addEventListener("input", (event) => {
  state.query = event.target.value.trim();
  render();
});

init().catch((error) => {
  elements.leaderboard.innerHTML = `<div class="empty error"><strong>Couldn’t load the picks</strong><span>${escapeHtml(error.message)}</span></div>`;
});
