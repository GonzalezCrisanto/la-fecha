"""
Integration tests: simulation engine + narration consistency.

Each test runs simulate_match → generate_narration and asserts that the
narrated output is internally consistent and agrees with the Monte Carlo
engine's own accounting.

Run with:  pytest test_narrate.py -v
"""

import pytest
from simulate import simulate_match
from narrate import generate_narration, build_summary

# ── Minimal player fixtures ───────────────────────────────────────────────────

def _player(name, position, goals_per_90=0.3, assists_per_90=0.2):
    return {
        "name": name,
        "position": position,
        "goals_per_90_shrunk": goals_per_90,
        "assists_per_90_shrunk": assists_per_90,
        "fouls_per_90": 1.2,
        "fouls_per_match": 1.0,
        "rating_mean": 7.0,
        "rating_std": 0.6,
    }

HOME_LINEUP = [
    _player("Arquero Local",   "ARQ", goals_per_90=0.0),
    _player("Defensa L1",      "DEF", goals_per_90=0.05),
    _player("Defensa L2",      "DEF", goals_per_90=0.05),
    _player("Defensa L3",      "DEF", goals_per_90=0.05),
    _player("Defensa L4",      "DEF", goals_per_90=0.05),
    _player("Mediocampista L1","MED", goals_per_90=0.15),
    _player("Mediocampista L2","MED", goals_per_90=0.15),
    _player("Mediocampista L3","MED", goals_per_90=0.15),
    _player("Delantero L1",    "DEL", goals_per_90=0.40),
    _player("Delantero L2",    "DEL", goals_per_90=0.40),
    _player("Delantero L3",    "DEL", goals_per_90=0.40),
]

AWAY_LINEUP = [
    _player("Arquero Visitante",   "ARQ", goals_per_90=0.0),
    _player("Defensa V1",          "DEF", goals_per_90=0.05),
    _player("Defensa V2",          "DEF", goals_per_90=0.05),
    _player("Defensa V3",          "DEF", goals_per_90=0.05),
    _player("Defensa V4",          "DEF", goals_per_90=0.05),
    _player("Mediocampista V1",    "MED", goals_per_90=0.15),
    _player("Mediocampista V2",    "MED", goals_per_90=0.15),
    _player("Mediocampista V3",    "MED", goals_per_90=0.15),
    _player("Delantero V1",        "DEL", goals_per_90=0.40),
    _player("Delantero V2",        "DEL", goals_per_90=0.40),
    _player("Delantero V3",        "DEL", goals_per_90=0.40),
]

# ── Helpers ───────────────────────────────────────────────────────────────────

def _sim_and_narrate(seed):
    import random
    random.seed(seed)
    result = simulate_match(
        HOME_LINEUP, AWAY_LINEUP,
        home_team="Local", away_team="Visitante",
        n_sims=1,
    )
    rep = result["representative_match"]
    narration, sh, sa = generate_narration(rep, "Local", "Visitante", seed=seed)
    return rep, narration, sh, sa


# ── Tests ─────────────────────────────────────────────────────────────────────

SEEDS = [1, 7, 42, 99, 137, 256, 512, 1001, 2024, 9999]


@pytest.mark.parametrize("seed", SEEDS)
def test_narrated_score_matches_simulation(seed):
    """Narrated final score must equal the Monte Carlo engine's score."""
    rep, _, sh, sa = _sim_and_narrate(seed)
    assert sh == rep["score_home"], (
        f"seed={seed}: narrated home={sh} but engine home={rep['score_home']}"
    )
    assert sa == rep["score_away"], (
        f"seed={seed}: narrated away={sa} but engine away={rep['score_away']}"
    )


@pytest.mark.parametrize("seed", SEEDS)
def test_goal_events_equal_score(seed):
    """Every goal must produce exactly one 'gol' narration event.

    Catches the free-kick / corner goal desync where sh/sa is incremented
    but no narration event is emitted, making the live score counter wrong.
    """
    rep, narration, sh, sa = _sim_and_narrate(seed)
    goles = sum(1 for ev in narration if ev["tipo"] in ("gol", "gol_en_contra"))
    total = sh + sa
    assert goles == total, (
        f"seed={seed}: {goles} 'gol' events but score is {sh}+{sa}={total}"
    )


@pytest.mark.parametrize("seed", SEEDS)
def test_player_stats_match_simulation_score(seed):
    """Sum of p['goals'] in rep_match player stats must equal the engine score.

    Catches the bug where the summary shows fewer scorers than goals scored —
    meaning simulate.py credited goals to events but not to player stat lines.
    """
    rep, _, sh, sa = _sim_and_narrate(seed)

    home_goals_in_stats = sum(p.get("goals", 0) for p in rep["home"])
    away_goals_in_stats = sum(p.get("goals", 0) for p in rep["away"])

    assert home_goals_in_stats == rep["score_home"], (
        f"seed={seed}: home player stats total {home_goals_in_stats} goals "
        f"but engine score_home={rep['score_home']}"
    )
    assert away_goals_in_stats == rep["score_away"], (
        f"seed={seed}: away player stats total {away_goals_in_stats} goals "
        f"but engine score_away={rep['score_away']}"
    )


@pytest.mark.parametrize("seed", SEEDS)
def test_every_engine_goal_event_is_narrated(seed):
    """Every goal event in rep_match['events'] must produce a narration entry.

    Specifically checks that corner goals and free-kick goals don't silently
    update the score without generating a visible narration event.
    """
    rep, narration, sh, sa = _sim_and_narrate(seed)

    engine_goals = [
        ev for ev in rep.get("events", [])
        if ev.get("type") == "goal" and not ev.get("_penalty")
    ]
    own_goals = [
        ev for ev in rep.get("events", [])
        if ev.get("type") == "own_goal"
    ]
    penalty_goals = [
        ev for ev in rep.get("events", [])
        if ev.get("type") == "goal" and ev.get("_penalty")
    ]

    narrated_goals   = sum(1 for ev in narration if ev["tipo"] == "gol")
    narrated_own     = sum(1 for ev in narration if ev["tipo"] == "gol_en_contra")
    expected_total   = len(engine_goals) + len(own_goals) + len(penalty_goals)

    assert narrated_goals + narrated_own == expected_total, (
        f"seed={seed}: engine has {len(engine_goals)} goals + {len(own_goals)} og "
        f"+ {len(penalty_goals)} penalties = {expected_total} total, "
        f"but narration has {narrated_goals} gol + {narrated_own} gol_en_contra"
    )


@pytest.mark.parametrize("seed", SEEDS)
def test_narrated_scorers_have_goals_in_stats(seed):
    """Any player named as a scorer in a 'gol' event must have goals > 0 in stats.

    Catches the mismatch between who the narration credits with a goal and
    who the engine's player stats actually credit — which makes the match
    summary show the wrong (or incomplete) list of scorers.
    """
    rep, narration, sh, sa = _sim_and_narrate(seed)

    all_players = {p["name"]: p for p in rep["home"] + rep["away"] if p.get("name")}

    for ev in narration:
        if ev["tipo"] != "gol":
            continue
        scorer = ev.get("player", "")
        if not scorer or scorer not in all_players:
            continue
        assert all_players[scorer].get("goals", 0) > 0, (
            f"seed={seed}: '{scorer}' narrated as scorer but goals=0 in player stats"
        )
