const EVENT_ID = process.env.ESPN_EVENT_ID || "401811952";
const ESPN_URL = `https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard?event=${EVENT_ID}`;

function parseToPar(value) {
  if (value === "E" || value === "-" || value == null) return 0;
  const parsed = Number.parseInt(String(value).replace("+", ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function teeTime(round) {
  const stats = round?.statistics?.categories?.[0]?.stats;
  const raw = stats?.find((item) => /\d{4}/.test(item.displayValue || ""))?.displayValue;
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function firstTwoRounds(competitor) {
  return [1, 2].map((period) => (competitor.linescores || []).find((round) => round.period === period));
}

function computeCutLine(competitors, par) {
  const completed = competitors.flatMap((competitor) => {
    const rounds = firstTwoRounds(competitor);
    if (!rounds.every((round) => round && round.linescores?.length >= 18 && Number.isFinite(round.value))) return [];
    return [rounds[0].value + rounds[1].value - par * 2];
  }).sort((a, b) => a - b);
  if (!completed.length) return null;
  return completed[Math.min(59, completed.length - 1)];
}

function shapePlayer(competitor, { currentRound, cutLine, par }) {
  const rounds = {};
  for (const round of competitor.linescores || []) {
    const roundNumber = round.period;
    if (!roundNumber || roundNumber > 4) continue;
    const holes = round.linescores?.length || 0;
    const strokes = Number.isFinite(round.value) && round.value > 0 ? round.value : null;
    const toPar = parseToPar(round.displayValue);
    rounds[roundNumber] = {
      strokes,
      toPar: strokes == null && round.displayValue === "-" ? null : toPar,
      holes,
      teeTime: teeTime(round),
      status: holes >= 18 ? "complete" : holes > 0 ? "playing" : "not_started"
    };
  }

  const openingRounds = firstTwoRounds(competitor);
  const completed36 = openingRounds.every((round) => round && round.linescores?.length >= 18 && Number.isFinite(round.value));
  const scoreAfter36 = completed36 ? openingRounds[0].value + openingRounds[1].value - par * 2 : null;
  let status = "active";
  if (currentRound >= 3 && cutLine != null) {
    status = !completed36 ? "withdrawn" : scoreAfter36 > cutLine ? "missed_cut" : "active";
  }

  return {
    id: competitor.id,
    name: competitor.athlete?.displayName,
    shortName: competitor.athlete?.shortName,
    country: competitor.athlete?.flag?.alt || null,
    flag: competitor.athlete?.flag?.href || null,
    tournamentToPar: parseToPar(competitor.score),
    position: competitor.order || null,
    status,
    scoreAfter36,
    rounds
  };
}

async function saveSnapshot(payload) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return false;

  const capturedMinute = new Date(payload.updatedAt);
  capturedMinute.setUTCSeconds(0, 0);
  const response = await fetch(`${url}/rest/v1/score_snapshots?on_conflict=event_id,captured_minute`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify({
      event_id: payload.event.id,
      event_status: payload.event.status,
      round_number: payload.event.currentRound,
      captured_minute: capturedMinute.toISOString(),
      payload
    })
  });
  return response.ok;
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    return response.status(405).json({ error: "Method not allowed" });
  }

  try {
    const upstream = await fetch(ESPN_URL, { headers: { Accept: "application/json" } });
    if (!upstream.ok) throw new Error(`Live feed returned ${upstream.status}`);
    const data = await upstream.json();
    const event = data.events?.find((item) => item.id === EVENT_ID) || data.events?.[0];
    const competition = event?.competitions?.[0];
    if (!event || !competition) throw new Error("U.S. Open event was not found");
    const currentRound = competition.status?.period || 1;
    const par = 70;
    const cutLine = currentRound >= 3 ? computeCutLine(competition.competitors || [], par) : null;

    const payload = {
      event: {
        id: event.id,
        name: event.name,
        venue: "Shinnecock Hills Golf Club",
        par,
        cutLine,
        status: competition.status?.type?.description || event.status?.type?.description || "Scheduled",
        statusDetail: competition.status?.type?.detail || null,
        currentRound,
        startDate: event.date,
        endDate: event.endDate
      },
      players: (competition.competitors || []).map((competitor) => shapePlayer(competitor, { currentRound, cutLine, par })),
      updatedAt: new Date().toISOString(),
      source: "ESPN public scoreboard"
    };

    saveSnapshot(payload).catch(() => {});
    return response.status(200).json(payload);
  } catch (error) {
    return response.status(502).json({
      error: "Live scores are temporarily unavailable",
      detail: error instanceof Error ? error.message : String(error)
    });
  }
}
