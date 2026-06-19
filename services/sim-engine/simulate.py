"""
Motor Monte Carlo — simulación de partidos LPF 2026.

Diseño de goles (correlacionado, no independiente):
  1. xG por equipo = Σ player.goals_per_90_shrunk
  2. Ajuste por fuerza del equipo, debilidad defensiva del rival,
     ventaja de localía, y TÁCTICAS (Fase 2)
  3. total_goals ~ Poisson(xG_ajustado)   ← TEAM level
  4. Distribución entre jugadores via multinomial ∝ tasas individuales
     → player goals correlacionados porque comparten el mismo total

Tácticas (Fase 2) — todos los multiplicadores son 1.0 si no se especifican:
  - Formación   (3-4-3 … 5-3-2): ±10-15% ataque/defensa
  - Mentalidad  (ultra_ofensiva … defensiva): ajuste ataque, defensa y tarjetas
    Contraataque: bonus ×1.15 si el rival juega ofensiva/ultra_ofensiva
  - Intensidad  (alta/media/baja): más tarjetas y fatiga (alta); más solidez (baja)
    Fatiga: si intensity="alta", xG en min 75-90 se reduce ×0.80
  - Capitán     (captain_id): dobla puntos fantasy del jugador designado
    Si el capitán no juega (red_card antes de min 1), vicecapitán hereda ×2 (V2.1)

Scoring fantasy V2 (sincronizado con lib/scoring.ts — 2026-06-15):
  - own_goal: -6 pts (era -4)
  - minutes ≥ 60 → +1 pt (todas las posiciones)
  - rating ≥ 8.5 → +5 | 7.5-8.49 → +2 | < 6.0 → -2 | zona neutral: 0
  - penalty_saved, key_pass, total_tackle, saved_shots_inside_box, error_lead_to_goal:
    incluidos en V2 de lib/scoring.ts pero el motor no los genera → sin efecto (= null en DB).

Pendiente V2.1 (documentado, sin implementar):
  - FOCUS_MARKER: anular figura rival (reducir su goals_per_90_shrunk ~30%)
  - PENALTY_EXECUTOR: jugador designado con bonus xG en penales/tiros libres

Uso:
  python scripts/sim/simulate.py --calibrate [--n-sims N]
  python scripts/sim/simulate.py --match <ruta_a_tu_partido.json> [--n-sims N]
  python scripts/sim/simulate.py --sensitivity [--n-sims N]
"""

import argparse
import json
import math
import os
import random
import sys
from collections import defaultdict

# Forzar UTF-8 en Windows para evitar errores con emojis y caracteres especiales
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

# ── Paths ─────────────────────────────────────────────────────────────────────
DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
PROFILES_FILE     = os.path.join(DATA_DIR, "player_profiles.json")
PRIORS_FILE       = os.path.join(DATA_DIR, "position_priors.json")
CONSTANTS_FILE    = os.path.join(DATA_DIR, "league_constants.json")
REPLACEMENT_FILE  = os.path.join(DATA_DIR, "replacement_priors.json")

# Probabilidad de que un gol lleve asistencia (LPF estimado)
ASSIST_PROB = 0.75

# Scoring rules de lib/scoring.ts — V2 (sincronizado 2026-06-15)
SCORING_RULES = {
    "goal":           {"DEL": 6, "MED": 8, "DEF": 12, "ARQ": 16},
    "assist":         3,
    "clean_sheet":    {"ARQ": 8, "DEF": 4},
    "goals_conceded": -2,   # solo ARQ, por cada gol recibido
    "yellow_card":    -2,
    "red_card":       -5,
    "own_goal":       -6,
    # penalty_saved: {"ARQ": 10} — V2 incluye penales atajados pero el motor no modela
    # penales atajados como evento; si se incorpora el evento en el futuro, agregar aquí.
    "rating": {
        "high_threshold": 8.5, "high": 5,
        "mid_threshold":  7.5, "mid":  2,
        "low_threshold":  6.0, "low": -2,
    },
    "minutes_bonus": 1,     # ≥60 min → +1 pt; todas las posiciones
    # key_pass, total_tackle, saved_shots_inside_box, error_lead_to_goal: V2 las incluye
    # pero el motor no genera esas stats por jugador en la simulación (equivale a que
    # las columnas sean null en player_stats → sin bonus/penalización, igual que V1).
}


# ── Constantes tácticas (Fase 2) ──────────────────────────────────────────────

# Formaciones: (DEF, MED, DEL) → multiplicadores de ataque/defensa.
# Diseño: más delanteros → más ataque, menos solidez defensiva; al revés con más DEF.
# Los multiplicadores promedian ~1.0 entre las 6 formaciones.
# Calibrables: ajustar si una formación rompe el rango de goles.
FORMATION_MULTIPLIERS = {
    "3-4-3":   {"attack": 1.10, "defense": 0.90},  # máximo ataque
    "4-3-3":   {"attack": 1.05, "defense": 0.95},
    "3-5-2":   {"attack": 1.00, "defense": 1.00},  # baseline: dominio de mediocampo
    "4-4-2":   {"attack": 0.98, "defense": 1.02},  # clásico equilibrado
    "4-2-3-1": {"attack": 0.97, "defense": 1.05},  # doble pivote protector
    "5-3-2":   {"attack": 0.90, "defense": 1.12},  # máxima solidez
}
FORMATIONS_SUPPORTED = set(FORMATION_MULTIPLIERS.keys())

# Mentalidad: (mult_attack, mult_defense, card_mult)
# mult_attack  → multiplica xG propio
# mult_defense → multiplica la solidez defensiva propia (reduce xG rival)
# card_mult    → multiplica la probabilidad de tarjeta (presión / agresividad)
# Contraataque: recibe bonus condicional si el rival juega ofensivo (ver CONTRAATAQUE_BONUS).
MENTALITY_PARAMS = {
    "ultra_ofensiva": {"mult_attack": 1.30, "mult_defense": 0.75, "card_mult": 1.10},
    "ofensiva":       {"mult_attack": 1.15, "mult_defense": 0.88, "card_mult": 1.05},
    "equilibrada":    {"mult_attack": 1.00, "mult_defense": 1.00, "card_mult": 1.00},
    "defensiva":      {"mult_attack": 0.85, "mult_defense": 1.15, "card_mult": 1.00},
    "contraataque":   {"mult_attack": 0.95, "mult_defense": 1.05, "card_mult": 1.00},
}
# Bonus de contraataque: si el rival juega ofensiva/ultra_ofensiva,
# el equipo en contraataque se beneficia de los espacios que deja el rival.
CONTRAATAQUE_BONUS   = 1.15
CONTRAATAQUE_TRIGGER = {"ofensiva", "ultra_ofensiva"}

# Intensidad: card_mult, def_mult (vs. el rival) y fatiga en últimos 15'.
# Alta: más pressing → más recuperaciones → +25% riesgo tarjetas.
#       Fatiga: el xG de este equipo se reduce ×0.80 en min 75-90.
# Baja: bloque bajo → +10% solidez defensiva (reduce xG del rival).
#       No afecta el ataque propio (menos transiciones, pero más compacto).
INTENSITY_PARAMS = {
    "alta":  {"card_mult": 1.25, "def_mult": 1.00, "fatigue_mult": 0.80, "fatigue_from": 75},
    "media": {"card_mult": 1.00, "def_mult": 1.00, "fatigue_mult": 1.00, "fatigue_from": None},
    "baja":  {"card_mult": 1.00, "def_mult": 1.10, "fatigue_mult": 1.00, "fatigue_from": None},
}

# Defaults de tácticas (neutros: no modifican el comportamiento del motor)
_DEFAULT_TACTICS = {
    "formation":  None,         # sin formación → multiplicador 1.0
    "mentality":  "equilibrada",
    "intensity":  "media",
    "captain_id": None,
}


# ── Carga ─────────────────────────────────────────────────────────────────────

_cache = {}

def _load(path, key):
    if key not in _cache:
        if not os.path.exists(path):
            sys.exit(f"❌ {path} no encontrado. Ejecutá: python scripts/sim/build_distributions.py")
        with open(path, encoding="utf-8") as f:
            _cache[key] = json.load(f)
    return _cache[key]

def get_profiles():      return _load(PROFILES_FILE,    "profiles")
def get_priors():        return _load(PRIORS_FILE,      "priors")
def get_constants():     return _load(CONSTANTS_FILE,   "constants")
def get_replacements():  return _load(REPLACEMENT_FILE, "replacements")


# ── Distribuciones ────────────────────────────────────────────────────────────

def poisson_sample(lam):
    """Knuth's Poisson. Stdlib-only, funciona sin numpy."""
    if lam <= 0:
        return 0
    L = math.exp(-min(lam, 600))
    k, p = 0, 1.0
    while p > L:
        k += 1
        p *= random.random()
    return k - 1

def normal_clamp(mu, sigma, lo=4.0, hi=10.0):
    """Box-Muller, clamped al rango de rating."""
    u1, u2 = max(random.random(), 1e-10), random.random()
    z = math.sqrt(-2 * math.log(u1)) * math.cos(2 * math.pi * u2)
    return max(lo, min(hi, mu + sigma * z))

def multinomial_choice(n, weights):
    """Reparte n items entre bins con probabilidades ∝ weights. Retorna lista de counts."""
    total = sum(weights)
    if total <= 0 or n == 0:
        return [0] * len(weights)
    probs = [w / total for w in weights]
    counts = [0] * len(weights)
    for _ in range(n):
        r, cum = random.random(), 0.0
        for i, p in enumerate(probs):
            cum += p
            if r <= cum:
                counts[i] += 1
                break
    return counts


# ── Perfil de jugador ─────────────────────────────────────────────────────────

def get_player_profile(player_id, position, generic=False):
    """
    Devuelve el perfil del jugador según dos ramas:
    - Con perfil (n_appearances ≥ 1): sus stats shrunk del dataset LPF 2026.
    - Sin perfil:
        generic=True  → media de posición (calibración / squads de referencia).
        generic=False → replacement-level p25 (default para el juego real,
                        incluido id=null de los jugadores sin historial LPF).
    El flag se lee desde el dict del jugador: p.get("generic", False).
    """
    profiles = get_profiles()
    p = profiles["players"].get(str(player_id))
    if p and p["n_appearances"] >= 1:
        return p

    if generic:
        pr = get_priors().get(position, get_priors()["MED"])
    else:
        pr = get_replacements().get(position, get_replacements()["MED"])

    return {
        "goals_per_90_shrunk":   pr["goals_per_90"],
        "assists_per_90_shrunk": pr["assists_per_90"],
        "fouls_per_match":       pr["fouls_per_match"],
        "fouls_per_90":          pr["fouls_per_90"],
        "rating_mean":           pr["rating_mean"],
        "rating_std":            pr["rating_std"],
        "n_appearances":         0,
        "position":              position,
    }


def resolve_profile(player: dict) -> dict:
    """
    Resolves the player profile and merges any per-90 stats provided directly
    on the player dict (e.g. from a client that computed them from season data).
    Provided fields take precedence over priors.
    """
    pos     = player["position"]
    generic = player.get("generic", False)
    base    = get_player_profile(player.get("id"), pos, generic)

    overrides = {}
    for key in ("goals_per_90_shrunk", "assists_per_90_shrunk", "fouls_per_90", "rating_mean", "rating_std"):
        if key in player:
            overrides[key] = player[key]

    return {**base, **overrides} if overrides else base


# ── Multiplicadores tácticos ──────────────────────────────────────────────────

def _formation_mult(tactics):
    """Retorna {attack, defense} de la formación o {1.0, 1.0} si no se especificó."""
    f = tactics.get("formation")
    return FORMATION_MULTIPLIERS.get(f, {"attack": 1.0, "defense": 1.0}) if f else {"attack": 1.0, "defense": 1.0}

def _mentality(tactics):
    m = tactics.get("mentality", "equilibrada")
    return MENTALITY_PARAMS.get(m, MENTALITY_PARAMS["equilibrada"])

def _intensity(tactics):
    i = tactics.get("intensity", "media")
    return INTENSITY_PARAMS.get(i, INTENSITY_PARAMS["media"])


# ── xG ajustado por equipo ────────────────────────────────────────────────────

def compute_team_xg(lineup, own_team, opp_team, is_home,
                    own_tactics=None, opp_tactics=None):
    """
    xG del equipo = Σ player.goals_per_90_shrunk
    × sqrt(own_atk_effective / opp_def_effective)
    × loc_factor

    own_atk_effective = team_atk_base × formation_atk × mentality_atk × contraataque_bonus
    opp_def_effective = team_def_base × opp_formation_def × opp_mentality_def × opp_intensity_def
    """
    own_tactics = own_tactics or {}
    opp_tactics = opp_tactics or {}
    consts = get_constants()

    raw_xg = sum(resolve_profile(p)["goals_per_90_shrunk"] for p in lineup)

    team_strengths = consts.get("team_strengths", {})
    own_atk = team_strengths.get(own_team, {}).get("attack_strength",  1.0)
    opp_def = team_strengths.get(opp_team, {}).get("defense_strength", 1.0)

    own_form = _formation_mult(own_tactics)
    opp_form = _formation_mult(opp_tactics)
    own_ment = _mentality(own_tactics)
    opp_ment = _mentality(opp_tactics)
    opp_int  = _intensity(opp_tactics)

    # Ataque efectivo del equipo propio
    atk_mult = own_form["attack"] * own_ment["mult_attack"]
    # Bonus de contraataque si el rival juega ofensivo
    own_mentality_str = own_tactics.get("mentality", "equilibrada")
    opp_mentality_str = opp_tactics.get("mentality", "equilibrada")
    if own_mentality_str == "contraataque" and opp_mentality_str in CONTRAATAQUE_TRIGGER:
        atk_mult *= CONTRAATAQUE_BONUS

    # Defensa efectiva del rival (reduce nuestro xG)
    # opp_int["def_mult"] > 1.0 solo para intensidad "baja" del rival (bloque bajo)
    def_mult = opp_form["defense"] * opp_ment["mult_defense"] * opp_int["def_mult"]

    effective_atk = own_atk * atk_mult
    effective_def = opp_def * def_mult
    strength_mult = math.sqrt(max(effective_atk / max(effective_def, 0.01), 0.1))

    loc_factor = consts["home_factor"] if is_home else consts["away_factor"]

    return raw_xg * strength_mult * loc_factor


# ── Tarjetas ──────────────────────────────────────────────────────────────────

def simulate_cards(player, fouls, position, consts, card_mult=1.0,
                   start_minute=1, end_minute=90):
    """
    Retorna (yellow, red, red_minute).
    card_mult combina el multiplicador de mentalidad e intensidad del equipo.
    """
    p_yellow = min(fouls * consts["yellow_per_foul"] * card_mult, consts["yellow_prob_cap"])
    yellow   = 1 if random.random() < p_yellow else 0

    pos_mult  = consts["red_position_multiplier"].get(position, 1.0)
    fouls_p90 = player.get("fouls_per_90", player.get("fouls_per_match", 1.0))
    foul_mult = (consts["red_high_foul_multiplier"]
                 if fouls_p90 >= consts["red_high_foul_threshold"] else 1.0)
    p_red = consts["red_base_prob"] * pos_mult * foul_mult * card_mult
    red   = 1 if random.random() < p_red else 0
    red_min = random.randint(start_minute, end_minute) if red else None

    return yellow, red, red_min


# ── Efecto 10 hombres ─────────────────────────────────────────────────────────

def apply_ten_men(xg_with_10, xg_opponent, red_minute, consts):
    """Ajusta xG después de una expulsión (proporcional al tiempo restante)."""
    remaining = (90 - red_minute) / 90
    off_mult  = 1 - (1 - consts["ten_men_offense_multiplier"]) * remaining
    def_mult  = 1 + (consts["ten_men_defense_multiplier"] - 1) * remaining
    return xg_with_10 * off_mult, xg_opponent * def_mult


# ── Simulación de un partido ──────────────────────────────────────────────────

def simulate_one(home_lineup, away_lineup, home_team="", away_team="",
                 tactics_home=None, tactics_away=None,
                 start_minute=1, end_minute=90):
    """
    Simula un partido (o fracción). start_minute/end_minute acotan el tiempo simulado.
    tactics_home/away: dict con keys opcionales formation, mentality, intensity, captain_id.
    """
    tactics_home = tactics_home or {}
    tactics_away = tactics_away or {}
    consts = get_constants()

    duration        = end_minute - start_minute + 1
    duration_factor = duration / 90

    result = {"home": [], "away": [], "events": [],
              "score_home": 0, "score_away": 0,
              "goals_home_late": 0, "goals_away_late": 0}

    # ── 1. xG por equipo (incluye tácticas, escalado al tiempo simulado) ──────
    xg_home = compute_team_xg(home_lineup, home_team, away_team,
                               is_home=True,  own_tactics=tactics_home, opp_tactics=tactics_away) * duration_factor
    xg_away = compute_team_xg(away_lineup, away_team, home_team,
                               is_home=False, own_tactics=tactics_away, opp_tactics=tactics_home) * duration_factor

    # ── 2. Tarjetas y efecto 10 hombres ───────────────────────────────────────
    home_red_min = away_red_min = None
    card_results = {"home": [], "away": []}

    for side, lineup, own_tactics in [("home", home_lineup, tactics_home),
                                       ("away", away_lineup, tactics_away)]:
        own_ment_p = _mentality(own_tactics)
        own_int_p  = _intensity(own_tactics)
        team_card_mult = own_ment_p["card_mult"] * own_int_p["card_mult"]

        for player in lineup:
            pos     = player["position"]
            profile = resolve_profile(player)
            mins    = player.get("minutes", 90)

            fouls_rate = profile.get("fouls_per_90", profile["fouls_per_match"])
            fouls = poisson_sample(fouls_rate * duration_factor)
            yellow, red, red_min = simulate_cards(
                profile, fouls, pos, consts, team_card_mult, start_minute, end_minute)

            card_results[side].append((yellow, red, red_min, fouls))

            if red and red_min is not None:
                if side == "home" and (home_red_min is None or red_min < home_red_min):
                    home_red_min = red_min
                elif side == "away" and (away_red_min is None or red_min < away_red_min):
                    away_red_min = red_min

    if home_red_min is not None:
        xg_home, xg_away = apply_ten_men(xg_home, xg_away, home_red_min, consts)
    if away_red_min is not None:
        xg_away, xg_home = apply_ten_men(xg_away, xg_home, away_red_min, consts)

    # ── 3. Goles — Poisson con fatiga (fatiga en min 76-90) ──────────────────
    def _draw_goals_with_fatigue(xg, intensity_str):
        """
        Divide xG en early (hasta min 75) y late (76-end) según el rango simulado.
        Para intensidad 'alta': aplica fatigue_mult en el segmento tardío.
        """
        int_p      = INTENSITY_PARAMS.get(intensity_str, INTENSITY_PARAMS["media"])
        fat        = int_p.get("fatigue_mult", 1.0)
        boundary   = 76
        early_mins = max(0, min(boundary - 1, end_minute) - start_minute + 1)
        late_mins  = max(0, end_minute - max(start_minute, boundary) + 1)
        early = poisson_sample(max(xg * early_mins / duration, 0))
        late  = poisson_sample(max(xg * late_mins  / duration * fat, 0))
        return early + late, late

    int_home_str = tactics_home.get("intensity", "media")
    int_away_str = tactics_away.get("intensity", "media")

    total_home, home_late = _draw_goals_with_fatigue(xg_home, int_home_str)
    total_away, away_late = _draw_goals_with_fatigue(xg_away, int_away_str)

    result["score_home"]       = total_home
    result["score_away"]       = total_away
    result["goals_home_late"]  = home_late
    result["goals_away_late"]  = away_late

    # ── 4. Distribución de goles entre jugadores (correlacionada) ─────────────
    def goal_weights(lineup):
        return [resolve_profile(p)["goals_per_90_shrunk"] for p in lineup]

    home_goal_w  = goal_weights(home_lineup)
    away_goal_w  = goal_weights(away_lineup)
    home_goal_dist = multinomial_choice(total_home, home_goal_w)
    away_goal_dist = multinomial_choice(total_away, away_goal_w)

    def asst_weights(lineup):
        return [resolve_profile(p)["assists_per_90_shrunk"] for p in lineup]

    home_asst_w = asst_weights(home_lineup)
    away_asst_w = asst_weights(away_lineup)

    def distribute_assists(n_goals, weights, scorer_idx):
        """
        Retorna (counts_por_jugador, lista_índice_asistente_por_gol_o_None).
        El índice permite atribuir cada gol a su asistente para la narración.
        """
        asst_w  = list(weights)
        asst_w[scorer_idx] = 0
        total_w = sum(asst_w)
        counts   = [0] * len(weights)
        per_goal = []
        for _ in range(n_goals):
            asst_idx = None
            if random.random() < ASSIST_PROB and total_w > 0:
                choice = multinomial_choice(1, asst_w)
                for j, c in enumerate(choice):
                    if c > 0:
                        asst_idx = j
                        counts[j] += c
                        break
            per_goal.append(asst_idx)
        return counts, per_goal

    # ── 5. Stats por jugador ──────────────────────────────────────────────────
    for side, lineup, goal_dist, asst_wts, cards in [
        ("home", home_lineup, home_goal_dist, home_asst_w, card_results["home"]),
        ("away", away_lineup, away_goal_dist, away_asst_w, card_results["away"]),
    ]:
        side_assists = [0] * len(lineup)
        for i, (player, goals) in enumerate(zip(lineup, goal_dist)):
            if goals > 0:
                asst_counts, asst_per_goal = distribute_assists(goals, asst_wts, i)
                for j, a in enumerate(asst_counts):
                    side_assists[j] += a
                # Generar eventos de gol con goleador + asistente (para narración)
                scorer_name = player.get("name", "") or player.get("position", "")
                for asst_idx in asst_per_goal:
                    assister_name = None
                    if asst_idx is not None:
                        assister_name = (lineup[asst_idx].get("name", "")
                                         or lineup[asst_idx].get("position", ""))
                    result["events"].append({
                        "side":     side,
                        "type":     "goal",
                        "player":   scorer_name,
                        "assister": assister_name,
                        "minute":   random.randint(start_minute, end_minute),
                    })

        for i, (player, goals) in enumerate(zip(lineup, goal_dist)):
            pos     = player["position"]
            profile = resolve_profile(player)
            mins    = player.get("minutes", 90)
            yellow, red, red_min, fouls = cards[i]

            eff_mins   = min(mins, red_min - 1) if red and red_min else mins
            rating_raw = normal_clamp(profile["rating_mean"], profile["rating_std"])
            rating     = max(4.0, rating_raw - (1.5 if red else 0))

            stat = {
                "id":          player.get("id"),
                "name":        player.get("name", ""),
                "position":    pos,
                "minutes":     eff_mins,
                "goals":       goals,
                "assists":     side_assists[i],
                "fouls":       fouls,
                "yellow_card": yellow,
                "red_card":    red,
                "red_minute":  red_min,
                "own_goals":   0,
                "rating":      round(rating, 2),
            }
            result[side].append(stat)

            if yellow:
                result["events"].append({
                    "side": side, "type": "yellow_card",
                    "player": player.get("name", str(player.get("id"))),
                    "minute": random.randint(start_minute, end_minute),
                })
            if red:
                result["events"].append({
                    "side": side, "type": "red_card",
                    "player": player.get("name", str(player.get("id"))),
                    "minute": red_min,
                })

    # Los eventos de gol se generaron con atribución completa (scorer + assister)
    # dentro del loop de stats de arriba; no hace falta agregar eventos genéricos.

    result["events"].sort(key=lambda e: e["minute"])
    return result


# ── Puntos fantasy ────────────────────────────────────────────────────────────

def calc_points(stat, goals_against, is_captain=False):
    """Calcula puntos fantasy V2. is_captain=True dobla el total."""
    pos = stat["position"]
    pts = 0
    pts += stat["goals"]       * SCORING_RULES["goal"].get(pos, 6)
    pts += stat["assists"]     * SCORING_RULES["assist"]
    pts += stat["yellow_card"] * SCORING_RULES["yellow_card"]
    pts += stat["red_card"]    * SCORING_RULES["red_card"]
    pts += stat["own_goals"]   * SCORING_RULES["own_goal"]
    if goals_against == 0 and pos in SCORING_RULES["clean_sheet"]:
        pts += SCORING_RULES["clean_sheet"][pos]
    if pos == "ARQ":
        pts += goals_against * SCORING_RULES["goals_conceded"]

    # V2 — bonus por minutos jugados (todas las posiciones)
    if stat.get("minutes", 0) >= 60:
        pts += SCORING_RULES["minutes_bonus"]

    # V2 — bonus/penalización por rating (usando el rating simulado del jugador)
    r_rules = SCORING_RULES["rating"]
    r = stat.get("rating")
    if r is not None:
        if r >= r_rules["high_threshold"]:
            pts += r_rules["high"]
        elif r >= r_rules["mid_threshold"]:
            pts += r_rules["mid"]
        elif r < r_rules["low_threshold"]:
            pts += r_rules["low"]
        # zona neutral [6.0, 7.5): sin bonus ni penalización

    if is_captain:
        pts *= 2
    return pts


# ── API pública ───────────────────────────────────────────────────────────────

def simulate_match(home_lineup, away_lineup, home_team="", away_team="",
                   tactics_home=None, tactics_away=None, n_sims=10_000,
                   start_minute=1, end_minute=90):
    """
    Corre n_sims iteraciones y devuelve stats agregadas.
    tactics_home/away: ver _DEFAULT_TACTICS para los keys soportados.
    captain_id en tactics: el jugador designado recibe ×2 en puntos fantasy.
    """
    tactics_home = tactics_home or {}
    tactics_away = tactics_away or {}

    cap_id_home = tactics_home.get("captain_id")
    cap_id_away = tactics_away.get("captain_id")

    agg        = {"home": defaultdict(lambda: defaultdict(float)),
                  "away": defaultdict(lambda: defaultdict(float))}
    score_dist = defaultdict(int)
    outcomes   = {"home": 0, "draw": 0, "away": 0}
    total_sh = total_sa = 0
    total_sh_late = total_sa_late = 0
    total_yh = total_ya = 0
    total_rh = total_ra = 0

    for _ in range(n_sims):
        m  = simulate_one(home_lineup, away_lineup, home_team, away_team,
                          tactics_home, tactics_away, start_minute, end_minute)
        sh, sa = m["score_home"], m["score_away"]
        score_dist[f"{sh}-{sa}"] += 1
        outcomes["home" if sh > sa else "draw" if sh == sa else "away"] += 1
        total_sh      += sh;        total_sa      += sa
        total_sh_late += m["goals_home_late"]
        total_sa_late += m["goals_away_late"]
        total_yh += sum(p["yellow_card"] for p in m["home"])
        total_ya += sum(p["yellow_card"] for p in m["away"])
        total_rh += sum(p["red_card"]    for p in m["home"])
        total_ra += sum(p["red_card"]    for p in m["away"])

        ga_home = sa
        ga_away = sh
        for side in ("home", "away"):
            ga     = ga_home if side == "home" else ga_away
            cap_id = cap_id_home if side == "home" else cap_id_away
            for p in m[side]:
                key = p["id"] or p["name"]
                a   = agg[side][key]
                a["goals"]       += p["goals"]
                a["assists"]     += p["assists"]
                a["yellow_card"] += p["yellow_card"]
                a["red_card"]    += p["red_card"]
                a["minutes"]     += p["minutes"]
                a["rating"]      += p["rating"]
                a["_count"]      += 1
                a["_pts"]        += calc_points(p, ga, is_captain=(p["id"] == cap_id and cap_id is not None))
                a["_name"]        = p["name"]
                a["_pos"]         = p["position"]

    # Partido representativo: una muestra al azar de la distribución.
    # Antes buscábamos el marcador modal (re-simulando hasta encontrarlo), lo que
    # producía siempre el mismo resultado para el mismo enfrentamiento.
    # Ahora corremos un único simulate_one; el seed aleatorio por request garantiza
    # variedad entre partidos. win_probs y score_distribution siguen siendo las
    # métricas agregadas de las n_sims (no cambian).
    rep_match = simulate_one(home_lineup, away_lineup, home_team, away_team,
                             tactics_home, tactics_away, start_minute, end_minute)

    def summarize(side):
        out = []
        for pid, a in agg[side].items():
            n = a["_count"]
            out.append({
                "id":          pid,
                "name":        a["_name"],
                "position":    a["_pos"],
                "avg_goals":   round(a["goals"]       / n, 3),
                "avg_assists": round(a["assists"]      / n, 3),
                "yellow_rate": round(a["yellow_card"]  / n, 3),
                "red_rate":    round(a["red_card"]     / n, 4),
                "avg_minutes": round(a["minutes"]      / n, 1),
                "avg_rating":  round(a["rating"]       / n, 2),
                "avg_points":  round(a["_pts"]         / n, 2),
            })
        return out

    top_scores = sorted(score_dist.items(), key=lambda x: -x[1])[:10]

    return {
        "players_home":             summarize("home"),
        "players_away":             summarize("away"),
        "score_distribution":       dict(top_scores),
        "win_probs": {
            "home": round(outcomes["home"] / n_sims, 4),
            "draw": round(outcomes["draw"] / n_sims, 4),
            "away": round(outcomes["away"] / n_sims, 4),
        },
        "avg_goals_home":           round(total_sh / n_sims, 3),
        "avg_goals_away":           round(total_sa / n_sims, 3),
        "avg_goals_last15_home":    round(total_sh_late / n_sims, 3),
        "avg_goals_last15_away":    round(total_sa_late / n_sims, 3),
        "avg_yellows_home":         round(total_yh / n_sims, 2),
        "avg_yellows_away":         round(total_ya / n_sims, 2),
        "avg_reds_home":            round(total_rh / n_sims, 4),
        "avg_reds_away":            round(total_ra / n_sims, 4),
        "avg_points_home":          round(sum(a["_pts"]   for a in agg["home"].values()) /
                                          max(sum(a["_count"] for a in agg["home"].values()), 1), 2),
        "avg_points_away":          round(sum(a["_pts"]   for a in agg["away"].values()) /
                                          max(sum(a["_count"] for a in agg["away"].values()), 1), 2),
        "representative_match":     rep_match,
    }


# ── Modo calibración ──────────────────────────────────────────────────────────

def calibrate(n_sims=10_000):
    """Corre sims con equipos genéricos (sin tácticas = todo 1.0) y reporta goles + tarjetas."""
    consts = get_constants()

    f442 = ["ARQ", "DEF", "DEF", "DEF", "DEF",
            "MED", "MED", "MED", "MED", "DEL", "DEL"]

    def generic_squad():
        return [{"id": None, "name": pos, "position": pos, "minutes": 90, "generic": True} for pos in f442]

    home_l, away_l = generic_squad(), generic_squad()

    total_sh = total_sa = 0
    total_yh = total_ya = 0
    total_rh = total_ra = 0
    score_dist = defaultdict(int)
    outcomes   = {"home": 0, "draw": 0, "away": 0}

    for _ in range(n_sims):
        # Sin tácticas → todos los multiplicadores son 1.0 (mismo comportamiento que Fase 1)
        m  = simulate_one(home_l, away_l, "SimHome", "SimAway")
        sh, sa = m["score_home"], m["score_away"]
        total_sh += sh; total_sa += sa
        total_yh += sum(p["yellow_card"] for p in m["home"])
        total_ya += sum(p["yellow_card"] for p in m["away"])
        total_rh += sum(p["red_card"]    for p in m["home"])
        total_ra += sum(p["red_card"]    for p in m["away"])
        score_dist[f"{sh}-{sa}"] += 1
        outcomes["home" if sh > sa else "draw" if sh == sa else "away"] += 1

    avg_sh = total_sh / n_sims
    avg_sa = total_sa / n_sims
    avg_yh = total_yh / n_sims
    avg_rh = total_rh / n_sims
    league_target = consts["league_avg_goals"]

    print(f"\n{'═'*55}")
    print(f" Calibración — {n_sims:,} simulaciones (genérico 4-4-2, sin tácticas)")
    print(f"{'═'*55}")
    print(f" Goles promedio local    : {avg_sh:.3f}  (target real: {consts['goals_home_mean']:.3f})")
    print(f" Goles promedio visitante: {avg_sa:.3f}  (target real: {consts['goals_away_mean']:.3f})")
    print(f" Goles promedio/equipo   : {(avg_sh+avg_sa)/2:.3f}  (target real: {league_target:.3f})")
    print()
    print(f" Win probs  local/empate/visitante: "
          f"{outcomes['home']/n_sims:.1%} / {outcomes['draw']/n_sims:.1%} / {outcomes['away']/n_sims:.1%}")
    print()
    print(f" Amarillas / equipo : {avg_yh:.2f}  (target: 3.0–4.0)")
    print(f" Rojas     / equipo : {avg_rh:.4f}  (target: 0.015–0.080)")
    print()
    print(" Top 10 marcadores:")
    for score, cnt in sorted(score_dist.items(), key=lambda x: -x[1])[:10]:
        print(f"   {score:6s} → {cnt/n_sims:.1%}")

    print()
    avg_g = (avg_sh + avg_sa) / 2
    ok_g  = abs(avg_g - league_target) / league_target < 0.15
    ok_y  = 3.0 <= avg_yh <= 4.5
    ok_r  = 0.015 <= avg_rh <= 0.08
    print(f" {'✅' if ok_g else '⚠️ '} Goles {'en rango' if ok_g else 'FUERA de rango'} (±15% del target {league_target:.3f}): {avg_g:.3f}")
    print(f" {'✅' if ok_y else '⚠️ '} Amarillas {'en rango' if ok_y else 'FUERA de rango'}: {avg_yh:.2f}/equipo")
    print(f" {'✅' if ok_r else '⚠️ '} Rojas {'en rango' if ok_r else 'FUERA de rango'}: {avg_rh:.4f}/equipo")
    print(f"{'═'*55}\n")


# ── Análisis de sensibilidad táctica ─────────────────────────────────────────

def sensitivity_analysis(n_sims=5000):
    """
    Compara efectos tácticos sobre equipos idénticos genéricos usando comparaciones
    HEAD-TO-HEAD (no vs baseline sin tácticas) para aislar cada variable táctica.
    """
    f442 = ["ARQ", "DEF", "DEF", "DEF", "DEF",
            "MED", "MED", "MED", "MED", "DEL", "DEL"]

    def squad():
        return [{"id": None, "name": pos, "position": pos, "minutes": 90, "generic": True} for pos in f442]

    def run(th, ta):
        total_sh = total_sa = 0
        total_yh = total_ya = 0
        total_rh = total_ra = 0
        total_sh_late = total_sa_late = 0
        outcomes = {"home": 0, "draw": 0, "away": 0}
        home_l, away_l = squad(), squad()
        for _ in range(n_sims):
            m = simulate_one(home_l, away_l, "SimHome", "SimAway", th, ta)
            sh, sa = m["score_home"], m["score_away"]
            total_sh += sh;        total_sa += sa
            total_sh_late += m["goals_home_late"]
            total_sa_late += m["goals_away_late"]
            total_yh += sum(p["yellow_card"] for p in m["home"])
            total_ya += sum(p["yellow_card"] for p in m["away"])
            total_rh += sum(p["red_card"]    for p in m["home"])
            total_ra += sum(p["red_card"]    for p in m["away"])
            outcomes["home" if sh > sa else "draw" if sh == sa else "away"] += 1
        return {
            "gh":      total_sh / n_sims,
            "ga":      total_sa / n_sims,
            "gh_late": total_sh_late / n_sims,
            "ga_late": total_sa_late / n_sims,
            "yh":      total_yh / n_sims,
            "ya":      total_ya / n_sims,
            "rh":      total_rh / n_sims,
            "ra":      total_ra / n_sims,
            "win_h":   outcomes["home"] / n_sims,
            "draw":    outcomes["draw"] / n_sims,
            "win_a":   outcomes["away"] / n_sims,
        }

    W = 70
    print(f"\n{'═'*W}")
    print(f" Análisis de sensibilidad táctica — {n_sims:,} sims/escenario")
    print(f" Metodología: comparaciones HEAD-TO-HEAD, misma táctica rival")
    print(f"{'═'*W}")
    sep = f"{'─'*W}"

    # ── [1] Mentalidad ataque: ultra_ofensiva vs equilibrada (mismo rival: defensiva) ──
    print(f"\n{sep}")
    print(f" [1] Mentalidad — home=ultra_ofensiva vs home=equilibrada (rival: defensiva)")
    print(f"     Pregunta: ¿ultra_ofensiva mejora a un equipo frente al mismo oponente?")
    r_ultra = run({"mentality": "ultra_ofensiva"}, {"mentality": "defensiva"})
    r_eq    = run({"mentality": "equilibrada"},    {"mentality": "defensiva"})
    dgh  = (r_ultra["gh"] - r_eq["gh"]) / r_eq["gh"] * 100
    dyh  = (r_ultra["yh"] - r_eq["yh"]) / r_eq["yh"] * 100
    print(f"   Ultra_ofensiva: goles home={r_ultra['gh']:.3f}  win={r_ultra['win_h']:.1%}")
    print(f"   Equilibrada:    goles home={r_eq['gh']:.3f}    win={r_eq['win_h']:.1%}")
    print(f"   Delta goles home: {dgh:+.1f}%  |  Delta amarillas: {dyh:+.1f}%")
    ok1_goals = r_ultra["gh"] > r_eq["gh"]
    ok1_wins  = r_ultra["win_h"] > r_eq["win_h"]
    print(f"   {'✅' if ok1_goals else '⚠️ '} Ultra_ofensiva marca más goles que equilibrada {'✓' if ok1_goals else '✗'}")
    print(f"   {'✅' if ok1_wins  else '⚠️ '} Ultra_ofensiva tiene mejor win prob que equilibrada {'✓' if ok1_wins else '✗'}")

    # ── [2] Mentalidad defensa: defensiva vs ultra_ofensiva (mismo rival: ofensiva) ────
    print(f"\n{sep}")
    print(f" [2] Mentalidad — away=ultra_ofensiva vs away=defensiva (rival home: ofensiva)")
    print(f"     Pregunta: ¿ultra_ofensiva away gana más que defensiva away?")
    r_ultra_a = run({"mentality": "ofensiva"}, {"mentality": "ultra_ofensiva"})
    r_def_a   = run({"mentality": "ofensiva"}, {"mentality": "defensiva"})
    dga = (r_ultra_a["ga"] - r_def_a["ga"]) / r_def_a["ga"] * 100
    print(f"   Ultra_ofensiva away: goles away={r_ultra_a['ga']:.3f}  win={r_ultra_a['win_a']:.1%}")
    print(f"   Defensiva away:      goles away={r_def_a['ga']:.3f}   win={r_def_a['win_a']:.1%}")
    print(f"   Delta goles away: {dga:+.1f}%")
    ok2_goals = r_ultra_a["ga"] > r_def_a["ga"]
    ok2_wins  = r_ultra_a["win_a"] > r_def_a["win_a"]
    print(f"   {'✅' if ok2_goals else '⚠️ '} Ultra_ofensiva away marca más que defensiva away {'✓' if ok2_goals else '✗'}")
    print(f"   {'✅' if ok2_wins  else '⚠️ '} Ultra_ofensiva away gana más que defensiva away {'✓' if ok2_wins else '✗'}")

    # ── [3] Intensidad: alta vs media y baja vs media ─────────────────────────
    print(f"\n{sep}")
    print(f" [3a] Intensidad — home=alta vs home=media (rival: neutral)")
    print(f"      Pregunta: ¿alta intensidad genera más tarjetas?")
    r_alta  = run({"intensity": "alta"},  {})
    r_media = run({"intensity": "media"}, {})
    dyh3 = (r_alta["yh"] - r_media["yh"]) / r_media["yh"] * 100
    drh3 = (r_alta["rh"] - r_media["rh"]) / r_media["rh"] * 100
    print(f"   Alta:  amarillas home={r_alta['yh']:.2f}  rojas={r_alta['rh']:.4f}")
    print(f"   Media: amarillas home={r_media['yh']:.2f}  rojas={r_media['rh']:.4f}")
    print(f"   Delta amarillas: {dyh3:+.1f}%  |  Delta rojas: {drh3:+.1f}%")
    ok3a = r_alta["yh"] > r_media["yh"] * 1.15   # al menos +15%
    print(f"   {'✅' if ok3a else '⚠️ '} Alta intensidad genera significativamente más tarjetas {'✓' if ok3a else '✗'}")

    print(f"\n{sep}")
    print(f" [3b] Intensidad — away=baja vs away=media (rival home: neutral)")
    print(f"      Pregunta: ¿baja intensidad (bloque bajo) concede menos goles?")
    r_baja_opp  = run({}, {"intensity": "baja"})
    r_media_opp = run({}, {"intensity": "media"})
    # Si away juega baja → home debería marcar MENOS (away defiende mejor)
    dgh3b = (r_baja_opp["gh"] - r_media_opp["gh"]) / r_media_opp["gh"] * 100
    print(f"   Away baja:  goles home={r_baja_opp['gh']:.3f}  (concede {dgh3b:+.1f}% vs media)")
    print(f"   Away media: goles home={r_media_opp['gh']:.3f}")
    ok3b = r_baja_opp["gh"] < r_media_opp["gh"]
    print(f"   {'✅' if ok3b else '⚠️ '} Baja intensidad (away) → rival home marca menos {'✓' if ok3b else '✗'}")

    print(f"\n{sep}")
    print(f" [3c] Fatiga — home=alta vs home=media, goles en últimos 15' (min 76-90)")
    print(f"      Pregunta: ¿alta intensidad muestra fatiga con menos goles tardíos?")
    # Ambos tienen igual total xg; comparo proporción de goles tardíos
    prop_alta  = r_alta["gh_late"]  / max(r_alta["gh"],  0.001)
    prop_media = r_media["gh_late"] / max(r_media["gh"], 0.001)
    print(f"   Alta:  goles tardíos={r_alta['gh_late']:.3f}  ({prop_alta:.1%} del total)")
    print(f"   Media: goles tardíos={r_media['gh_late']:.3f}  ({prop_media:.1%} del total)")
    print(f"   Fatigue delta (últimos 15'): {r_alta['gh_late'] - r_media['gh_late']:+.3f} goles/partido")
    ok3c = prop_alta < prop_media   # alta debería tener menor proporción de goles tardíos
    print(f"   {'✅' if ok3c else '⚠️ '} Alta intensidad reduce proporción goles en últimos 15' {'✓' if ok3c else '✗'}")

    # ── [4] Contraataque vs rival ofensivo ─────────────────────────────────────
    print(f"\n{sep}")
    print(f" [4] Contraataque — home=contraataque, bonus activo vs rival ofensivo")
    print(f"     Pregunta: ¿el bonus +×{CONTRAATAQUE_BONUS} se activa correctamente?")
    r_contra_bonus  = run({"mentality": "contraataque"}, {"mentality": "ofensiva"})    # bonus ACTIVO
    r_contra_nobonus = run({"mentality": "contraataque"}, {"mentality": "equilibrada"}) # sin bonus
    delta_bonus = r_contra_bonus["gh"] - r_contra_nobonus["gh"]
    print(f"   Contra vs ofensiva (bonus):   goles home={r_contra_bonus['gh']:.3f}   win={r_contra_bonus['win_h']:.1%}")
    print(f"   Contra vs equilibrada (sin):  goles home={r_contra_nobonus['gh']:.3f}  win={r_contra_nobonus['win_h']:.1%}")
    print(f"   Delta del bonus: {delta_bonus:+.3f} goles/partido")
    ok4 = delta_bonus > 0.02   # al menos +0.02 goles (señal real, no ruido)
    print(f"   {'✅' if ok4 else '⚠️ '} Bonus de contraataque eleva goles cuando rival es ofensivo {'✓' if ok4 else '✗'}")

    # ── [5] Formaciones: head-to-head, mismo rival neutro ─────────────────────
    print(f"\n{sep}")
    print(f" [5] Formaciones — mismo rival neutro, varía solo HOME")
    print(f"     Pregunta: ¿3-4-3 marca más y 5-3-2 concede menos que 4-4-2?")
    r_343  = run({"formation": "3-4-3"},   {})   # más ataque
    r_442  = run({"formation": "4-4-2"},   {})   # referencia
    r_532  = run({"formation": "5-3-2"},   {})   # más defensa
    d343 = (r_343["gh"] - r_442["gh"]) / r_442["gh"] * 100
    d532 = (r_532["ga"] - r_442["ga"]) / r_442["ga"] * 100  # away marca MENOS vs 5-3-2
    print(f"   3-4-3 home: goles home={r_343['gh']:.3f} ({d343:+.1f}% vs 4-4-2)")
    print(f"   4-4-2 home: goles home={r_442['gh']:.3f}  [referencia]")
    print(f"   5-3-2 home: goles away={r_532['ga']:.3f} ({d532:+.1f}% que vs 4-4-2 → away marca menos)")
    ok5a = r_343["gh"] > r_442["gh"]    # 3-4-3 ataca más que 4-4-2
    ok5b = r_532["ga"] < r_442["ga"]    # 5-3-2 concede menos que 4-4-2
    print(f"   {'✅' if ok5a else '⚠️ '} 3-4-3 marca más goles que 4-4-2 {'✓' if ok5a else '✗'}")
    print(f"   {'✅' if ok5b else '⚠️ '} 5-3-2 concede menos goles que 4-4-2 {'✓' if ok5b else '✗'}")

    # ── Reconfirmación global ─────────────────────────────────────────────────
    print(f"\n{sep}")
    print(f" Reconfirmación core: equilibrada/media/4-4-2 (tácticas explícitas)")
    r_eq_full = run({"mentality": "equilibrada", "intensity": "media", "formation": "4-4-2"},
                    {"mentality": "equilibrada", "intensity": "media", "formation": "4-4-2"})
    target = get_constants()["league_avg_goals"]
    avg_eq = (r_eq_full["gh"] + r_eq_full["ga"]) / 2
    ok_eq  = abs(avg_eq - target) / target < 0.15
    print(f"   Goles/equipo: {avg_eq:.3f}  (target ≈ {target:.3f}, tolerancia ±15%)")
    print(f"   {'✅' if ok_eq else '⚠️ '} Core calibración intacta con tácticas neutras {'✓' if ok_eq else '✗'}")

    all_ok = all([ok1_goals, ok1_wins, ok2_goals, ok2_wins, ok3a, ok3b, ok3c, ok4, ok5a, ok5b, ok_eq])
    print(f"\n{'═'*W}")
    print(f" {'✅ TODOS los efectos tácticos en dirección esperada' if all_ok else '⚠️  Revisar items marcados con ✗'}")
    print(f"{'═'*W}\n")


# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Motor Monte Carlo LPF 2026 — Fase 2 (tácticas)")
    parser.add_argument("--calibrate",   action="store_true",
                        help="Calibración core sin tácticas")
    parser.add_argument("--match",       type=str, default=None,
                        help="Path al JSON del partido (incluye tactics_home/away opcionales)")
    parser.add_argument("--sensitivity", action="store_true",
                        help="Análisis de sensibilidad táctica")
    parser.add_argument("--n-sims",     type=int, default=10_000)
    args = parser.parse_args()

    if args.calibrate:
        calibrate(args.n_sims)

    elif args.sensitivity:
        sensitivity_analysis(args.n_sims)

    elif args.match:
        with open(args.match, encoding="utf-8") as f:
            lineups = json.load(f)
        result = simulate_match(
            lineups["home"],
            lineups["away"],
            lineups.get("home_team", ""),
            lineups.get("away_team", ""),
            tactics_home=lineups.get("tactics_home", {}),
            tactics_away=lineups.get("tactics_away", {}),
            n_sims=args.n_sims,
        )
        # Imprimir resumen sin el partido representativo completo
        summary = {k: v for k, v in result.items() if k != "representative_match"}
        print(json.dumps(summary, indent=2, ensure_ascii=False))
        if result["representative_match"]:
            print("\n--- Partido representativo ---")
            rep = result["representative_match"]
            print(f"Marcador: {rep['score_home']}-{rep['score_away']}")
            for ev in rep["events"]:
                print(f"  min {ev['minute']:2d}  [{ev['side'][:4]}] {ev['type']} — {ev.get('player', '')}")
    else:
        parser.print_help()
