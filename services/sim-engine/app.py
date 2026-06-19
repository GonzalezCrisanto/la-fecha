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
    position: str   # ARQ | DEF | MED | DEL
    minutes: int = 90

class Tactics(BaseModel):
    formation: Optional[str] = None
    mentality: str = "equilibrada"
    intensity: str = "media"
    captain_id: Optional[int] = None

class MatchInput(BaseModel):
    home_team: str
    away_team: str
    tactics_home: Tactics = Tactics()
    tactics_away: Tactics = Tactics()
    home: list[PlayerInput]
    away: list[PlayerInput]
    n_sims: int = 5_000
    seed: int = 42


# ── Endpoints ──────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/simulate")
def simulate(match: MatchInput):
    """Runs n_sims Monte Carlo iterations and returns stats + Spanish narration."""
    random.seed(match.seed)

    result = simulate_match(
        [p.model_dump() for p in match.home],
        [p.model_dump() for p in match.away],
        home_team=match.home_team,
        away_team=match.away_team,
        tactics_home=match.tactics_home.model_dump(),
        tactics_away=match.tactics_away.model_dump(),
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
