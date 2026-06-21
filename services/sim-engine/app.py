"""
Microservicio FastAPI — Motor de simulación Monte Carlo para La Fecha.
Expone POST /simulate para ser invocado desde el cliente Vite.
"""
import random
from typing import Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from simulate import simulate_match
from narrate import generate_narration, narration_to_text

app = FastAPI(title="La Fecha Sim Engine", version="1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)


# ── Request models ─────────────────────────────────────────────────────────────

class PlayerInput(BaseModel):
    id: Optional[int] = None
    name: str
    position: str          # ARQ | DEF | MED | DEL
    minutes: int = 90
    goals_per_90_shrunk:   Optional[float] = None
    assists_per_90_shrunk: Optional[float] = None
    fouls_per_90:          Optional[float] = None
    rating_mean:           Optional[float] = None
    rating_std:            Optional[float] = None

class Tactics(BaseModel):
    formation: Optional[str] = None
    mentality: str = "equilibrada"
    intensity: str = "media"
class MatchInput(BaseModel):
    home_team: str
    away_team: str
    tactics_home: Tactics = Tactics()
    tactics_away: Tactics = Tactics()
    home: list[PlayerInput]
    away: list[PlayerInput]
    n_sims: int = 1
    seed: int = 42

class SecondHalfInput(MatchInput):
    score_home: int = 0
    score_away: int = 0
    booked_home: list[str] = []
    booked_away: list[str] = []


# ── Endpoints ──────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


# ── Bot rival — formación y mentalidad ────────────────────────────────────────

_FORMATION_TARGETS = {
    "3-4-3":   (3, 4, 3),
    "4-3-3":   (4, 3, 3),
    "3-5-2":   (3, 5, 2),
    "4-4-2":   (4, 4, 2),
    "4-2-3-1": (4, 5, 1),
    "5-3-2":   (5, 3, 2),
}

def _bot_formation(players: list) -> str:
    """Deriva la formación óptima del bot a partir de las posiciones del equipo."""
    from collections import Counter
    counts = Counter(p.position for p in players)
    n_def  = counts.get("DEF", 0)
    n_med  = counts.get("MED", 0)
    n_del  = counts.get("DEL", 0)
    best, best_dist = "4-4-2", float("inf")
    for form, (d, m, f) in _FORMATION_TARGETS.items():
        dist = abs(n_def - d) + abs(n_med - m) + abs(n_del - f)
        if dist < best_dist:
            best_dist, best = dist, form
    return best

def _bot_second_half_intensity(score_bot: int, score_user: int) -> str:
    """Adapts the bot's intensity to the scoreline going into the second half."""
    diff = score_bot - score_user
    if diff >= 2:  return "baja"   # protecting a comfortable lead
    if diff <= -2: return "alta"   # desperate, needs goals
    return "media"

def _bot_second_half_mentality(score_bot: int, score_user: int) -> str:
    """Adapta la mentalidad del bot al marcador del primer tiempo."""
    diff = score_bot - score_user
    if diff >= 2:  return "defensiva"
    if diff == 1:  return "equilibrada"
    if diff == 0:  return "equilibrada"
    if diff == -1: return "ofensiva"
    return "ultra_ofensiva"


@app.post("/simulate")
def simulate(match: MatchInput):
    """Runs n_sims Monte Carlo iterations and returns stats + Spanish narration."""
    random.seed(match.seed)

    def to_player(p: PlayerInput) -> dict:
        d = {k: v for k, v in p.model_dump().items() if v is not None}
        if d.get("id") is None:
            d["generic"] = True
        return d

    tactics_away = match.tactics_away.model_dump()
    tactics_away["mentality"]  = "equilibrada"
    tactics_away["intensity"]  = "media"
    if tactics_away.get("formation") is None:
        tactics_away["formation"] = _bot_formation(match.away)

    result = simulate_match(
        [to_player(p) for p in match.home],
        [to_player(p) for p in match.away],
        home_team=match.home_team,
        away_team=match.away_team,
        tactics_home=match.tactics_home.model_dump(),
        tactics_away=tactics_away,
        n_sims=match.n_sims,
    )

    rep = result.get("representative_match")
    narration: list | None = None
    narration_text = ""

    if rep:
        narration_list, sh, sa = generate_narration(
            rep, match.home_team, match.away_team, seed=match.seed
        )
        narration_text = narration_to_text(
            narration_list, match.home_team, match.away_team, sh, sa
        )
        narration = narration_list

    return {**result, "narration": narration, "narration_text": narration_text}


@app.post("/simulate-second-half")
def simulate_second_half(match: SecondHalfInput):
    """Simulates only the second half (min 46-90) using a given first-half score as context."""
    random.seed(match.seed + 1)

    def to_player(p: PlayerInput) -> dict:
        d = {k: v for k, v in p.model_dump().items() if v is not None}
        if d.get("id") is None:
            d["generic"] = True
        return d

    tactics_away = match.tactics_away.model_dump()
    tactics_away["mentality"]  = _bot_second_half_mentality(match.score_away, match.score_home)
    tactics_away["intensity"]  = _bot_second_half_intensity(match.score_away, match.score_home)
    if tactics_away.get("formation") is None:
        tactics_away["formation"] = _bot_formation(match.away)

    result = simulate_match(
        [to_player(p) for p in match.home],
        [to_player(p) for p in match.away],
        home_team=match.home_team,
        away_team=match.away_team,
        tactics_home=match.tactics_home.model_dump(),
        tactics_away=tactics_away,
        n_sims=match.n_sims,
        start_minute=46,
        end_minute=90,
        booked_home=match.booked_home,
        booked_away=match.booked_away,
        ht_score_home=match.score_home,
        ht_score_away=match.score_away,
    )

    rep = result.get("representative_match")
    narration: list | None = None
    narration_text = ""

    if rep:
        # Offset the representative score with the first-half result
        rep["score_home"] += match.score_home
        rep["score_away"] += match.score_away

        narration_list, sh, sa = generate_narration(
            rep, match.home_team, match.away_team, seed=match.seed + 1,
            start_score_home=match.score_home,
            start_score_away=match.score_away,
            start_minute=46,
            end_minute=90,
        )
        narration_text = narration_to_text(
            narration_list, match.home_team, match.away_team, sh, sa
        )
        narration = narration_list

    return {**result, "narration": narration, "narration_text": narration_text}
