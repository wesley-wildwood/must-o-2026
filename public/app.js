import { buildLeaderboard, formatToPar, parsePicksCsv } from "./scoring.js";

const state = { picks: [], live: null, selectedRound: 1, query: "" };
const elements = {
  leaderboard: document.querySelector("#leaderboard"),
  tabs: document.querySelector("#roundTabs"),
  summary: document.querySelector("#summary"),
  status: document.querySelector("#liveStatus"),
  updated: document.querySelector("#updatedAt"),
  title: document.querySelector("#boardTitle"),
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
  const golferNames = row.previous.bestGolfers.map((golfer) => golfer.pickName).join(" / ");
  return `<span class="prior-best">R${row.previous.round} · ${escapeHtml(golferNames || "No score")} <b>${row.previous.best ?? "—"}</b></span>`;
}

function renderSummary(rows) {
  const leader = rows[0];
  const onCourse = state.live.players.filter((player) => player.rounds?.[state.selectedRound]?.status === "playing").length;
  const completed = state.live.players.filter((player) => player.rounds?.[state.selectedRound]?.status === "complete").length;
  elements.summary.innerHTML = `
    <article class="summary-feature"><span>Current leader</span><strong>${escapeHtml(leader?.contestant || "—")}</strong><small>${leader?.total == null ? "No score" : formatToPar(leader.total, 70 * state.selectedRound)} through ${state.selectedRound} round${state.selectedRound === 1 ? "" : "s"}</small></article>
    <article><span>Leading total</span><strong>${leader?.total ?? "—"}</strong><small>Projected strokes</small></article>
    <article><span>On the course</span><strong>${onCourse}</strong><small>${completed} finished today</small></article>
    <article><span>Field</span><strong>43</strong><small>Contestants</small></article>`;
}

function render() {
  if (!state.live || !state.picks.length) return;
  const rows = buildLeaderboard(state.picks, state.live.players, state.selectedRound, state.live.event.par);
  const query = state.query.toLowerCase();
  const filtered = rows.filter((row) => !query || row.contestant.toLowerCase().includes(query) || row.current.golfers.some((golfer) => golfer.displayName.toLowerCase().includes(query)));

  elements.tabs.querySelectorAll("button").forEach((button) => button.classList.toggle("active", Number(button.dataset.round) === state.selectedRound));
  elements.title.textContent = `${state.selectedRound === 4 ? "Final round" : `Round ${state.selectedRound}`} leaderboard`;
  renderSummary(rows);

  if (!filtered.length) {
    elements.leaderboard.innerHTML = '<div class="empty"><strong>No matches found</strong><span>Try a contestant or golfer’s last name.</span></div>';
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
  const picksResponse = await fetch("/data/contestant-picks.csv");
  state.picks = parsePicksCsv(await picksResponse.text());
  await refreshScores({ initial: true });
  window.setInterval(refreshScores, 60_000);
}

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
