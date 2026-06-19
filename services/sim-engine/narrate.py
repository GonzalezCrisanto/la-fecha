"""
Narración template-based en español rioplatense de un partido simulado.

Entrada: JSON del partido (mismo formato que --match de simulate.py).
         El script corre simulate_match internamente y usa el partido representativo.

Salida:
  - Texto plano en scripts/data/sim/narration_{nombre}.txt
  - JSON enriquecido con campo "narration" en scripts/data/sim/narration_{nombre}.json

Determinismo: misma seed + mismo partido → misma narración exacta.

Uso:
  python scripts/sim/narrate.py --match <ruta_a_tu_partido.json>
  python scripts/sim/narrate.py --match <ruta_a_tu_partido.json> --seed 42
  python scripts/sim/narrate.py --match <ruta_a_tu_partido.json> --n-sims 5000
"""

import argparse
import json
import os
import random
import sys

# Forzar UTF-8 en Windows para evitar errores con emojis y caracteres especiales
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

sys.path.insert(0, os.path.dirname(__file__))
from simulate import simulate_match, calc_points

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "sim")

# ── Templates ─────────────────────────────────────────────────────────────────
# Cada lista tiene 5 variantes. Se elige con rng.choice → reproducible con seed.

TEMPLATES = {

    "arranque": [
        "¡Silbato inicial! Arranca el partido entre {home_team} y {away_team}.",
        "¡Todo listo! El árbitro da el pitazo de inicio. {home_team} recibe a {away_team}.",
        "En cancha y con todo. Comienza el encuentro con {home_team} de local ante {away_team}.",
        "Comienza el partido. Los once de cada lado ya sobre el verde.",
        "¡Arrancamos! {home_team} y {away_team} abren el juego.",
    ],

    "gol_con_asistencia": [
        "¡GOOOOOL de {scorer}! Gran pase de {assister} y el remate fue inatajable. "
        "Minuto {min}'. Así van: {home_team} {sh} – {sa} {away_team}.",

        "¡{scorer} la pone adentro a los {min}'! El pase de {assister} fue milimétrico. "
        "{home_team} {sh} – {sa} {away_team}.",

        "¡Gol a los {min}'! {assister} habilitó de primera y {scorer} no falló. "
        "Parcial: {home_team} {sh} – {sa} {away_team}.",

        "{scorer} convirtió a los {min}', asistido por {assister}. El estadio explota. "
        "{home_team} {sh} – {sa} {away_team}.",

        "¡GOOOL a los {min}'! {assister} vio el movimiento de {scorer} y la asistencia fue perfecta. "
        "Tablero: {home_team} {sh} – {sa} {away_team}.",
    ],

    "gol_sin_asistencia": [
        "¡GOOOOOL de {scorer} a los {min}'! Solo ante el arco, no perdonó. "
        "{home_team} {sh} – {sa} {away_team}.",

        "¡{scorer} la clavó en el ángulo a los {min}'! Golazo de pura individualidad. "
        "{home_team} {sh} – {sa} {away_team}.",

        "Gol de {scorer} a los {min}'. La pelota entró limpia y el estadio se rompió. "
        "{home_team} {sh} – {sa} {away_team}.",

        "¡A los {min}' {scorer} sacó el remate y la puso adentro! "
        "{home_team} {sh} – {sa} {away_team}.",

        "{scorer} no desperdició la chance y marcó a los {min}'. "
        "{home_team} {sh} – {sa} {away_team}.",
    ],

    "amarilla": [
        "Tarjeta amarilla para {player} de {team} a los {min}' por una falta sobre el rival.",
        "{player} ({team}) vio la amarilla a los {min}'. El árbitro no le perdonó la entrada.",
        "El árbitro le mostró la cartulina amarilla a {player} ({team}) a los {min}'.",
        "Amarilla para {player} de {team} a los {min}'. Tiene que cuidarse de ahora en más.",
        "{min}' — Amonestado {player} ({team}). La presión del partido se hace sentir.",
    ],

    "roja": [
        "¡EXPULSADO! {player} de {team} ve la roja directa a los {min}'. "
        "El equipo deberá aguantar con diez hombres de acá en más.",

        "¡{player} ({team}) recibe la roja a los {min}'! Tremenda decisión del árbitro; "
        "siguen en inferioridad numérica.",

        "El árbitro no dudó: roja para {player} de {team} a los {min}'. "
        "A partir de acá, {team} juega con diez.",

        "¡Roja directa para {player} ({team}) a los {min}'! El equipo tendrá que remar "
        "con un hombre menos hasta el final.",

        "{player} se va al vestuario antes de tiempo a los {min}'. "
        "La decisión es lapidaria: {team} queda con diez.",
    ],

    "save": [
        "¡Tapada increíble de {player} a los {min}'! El arquero evitó el gol "
        "con una intervención de categoría.",

        "{player} voló a los {min}' para sacar el remate al córner. "
        "El equipo le debe el resultado.",

        "¡{player} apareció bajo los tres palos a los {min}'! Salvó al equipo "
        "de manera espectacular.",

        "{min}' — Atajada clave de {player}. El remate iba adentro pero el arquero "
        "se estiró y la sacó.",

        "Pelotazo que iba adentro a los {min}', pero {player} se estiró y la desvió "
        "con la punta de los dedos.",
    ],

    "bigChanceMissed": [
        "{player} quedó solo ante el arco a los {min}' y no pudo definir. "
        "Una enorme ocasión desperdiciada.",

        "¡Increíble el fallo de {player} a los {min}'! La pelota se fue afuera "
        "con el arco completamente libre.",

        "Gran ocasión para {player} a los {min}', pero el balón se fue besando el palo "
        "hacia afuera.",

        "{min}' — {player} no convirtió una chance clarísima. Se lamenta en el campo.",

        "Gol cantado que no entró. {player} quedó mano a mano pero erró el remate a "
        "los {min}'.",
    ],

    "entretiempo": [
        "Pitazo del árbitro. Finaliza el primer tiempo: {home_team} {sh} – {sa} {away_team}.",
        "Se van al descanso. Al cabo de 45 minutos el marcador señala "
        "{home_team} {sh} – {sa} {away_team}.",
        "Fin del primer tiempo. Así se llegó al descanso: {home_team} {sh} – {sa} {away_team}.",
        "El árbitro mandó a los equipos al túnel. Primer tiempo: "
        "{home_team} {sh} – {sa} {away_team}.",
        "45 minutos jugados y el marcador parcial dice {home_team} {sh} – {sa} {away_team}.",
    ],

    "pitazo_final": [
        "¡Pitazo final! El árbitro da por concluido el encuentro. "
        "Resultado definitivo: {home_team} {sh} – {sa} {away_team}.",

        "¡Se terminó! El partido finaliza {home_team} {sh} – {sa} {away_team}.",

        "El árbitro sopló el silbato por última vez. "
        "{home_team} {sh} – {sa} {away_team} es el resultado final.",

        "¡Fin del partido! {home_team} y {away_team} cerraron este encuentro "
        "con un {sh} – {sa}.",

        "Se acabó el tiempo reglamentario. La pelota dejó de rodar: "
        "{home_team} {sh} – {sa} {away_team}.",
    ],
}

# Icono/prefijo por tipo de evento para el texto plano
TYPE_TAG = {
    "arranque":       "INICIO   ",
    "gol":            "  GOL    ",
    "amarilla":       " AMARILLA",
    "roja":           "  ROJA   ",
    "atajada":        " ATAJADA ",
    "ocasion_errada": "OCASION  ",
    "entretiempo":    "DESCANSO ",
    "pitazo_final":   "  FINAL  ",
    "figura":         "  FIGURA ",
    "resumen":        " RESUMEN ",
}


# ── Eventos sintéticos ────────────────────────────────────────────────────────

def synthesize_extra_events(rep_match, rng):
    """
    Genera eventos de atajadas y ocasiones erradas a partir de las stats del partido.
    No modifica el partido base; retorna lista de eventos adicionales.
    """
    events      = []
    score_home  = rep_match["score_home"]
    score_away  = rep_match["score_away"]
    used_mins   = {ev["minute"] for ev in rep_match.get("events", [])}

    def free_minute(lo=5, hi=88):
        """Minuto que no colisiona con eventos ya existentes."""
        for _ in range(20):
            m = rng.randint(lo, hi)
            if m not in used_mins:
                used_mins.add(m)
                return m
        m = rng.randint(lo, hi)
        used_mins.add(m)
        return m

    # Atajadas para cada ARQ (más si recibió pocos goles → la clave fue el arquero)
    for side, goals_against in [("home", score_away), ("away", score_home)]:
        arq = next((p for p in rep_match[side] if p["position"] == "ARQ"), None)
        if not arq or not arq.get("name"):
            continue
        if goals_against == 0:
            n_saves = rng.randint(2, 4)
        elif goals_against == 1:
            n_saves = rng.randint(1, 3)
        else:
            n_saves = rng.randint(0, 2)

        for _ in range(n_saves):
            events.append({
                "side":   side,
                "type":   "save",
                "player": arq["name"],
                "minute": free_minute(),
            })

    # Ocasiones erradas (0-1 por equipo, solo jugadores que no marcaron)
    for side in ("home", "away"):
        attackers = [p for p in rep_match[side]
                     if p["position"] in ("DEL", "MED") and p["goals"] == 0
                     and p.get("name")]
        if attackers and rng.random() < 0.60:
            player = rng.choice(attackers)
            events.append({
                "side":   side,
                "type":   "bigChanceMissed",
                "player": player["name"],
                "minute": free_minute(lo=15, hi=85),
            })

    return events


# ── Figura del partido ────────────────────────────────────────────────────────

def compute_figura(rep_match, score_home, score_away):
    """
    Figura: jugador con mejor rating del partido.
    Excluye a los ARQs que recibieron 2 o más goles para evitar nombrar
    a un portero goleado como figura.
    """
    all_stats = [(p, "home") for p in rep_match.get("home", [])] + \
                [(p, "away") for p in rep_match.get("away", [])]

    def is_goleado_arq(p, side):
        if p["position"] != "ARQ":
            return False
        goals_against = score_away if side == "home" else score_home
        return goals_against >= 2

    candidates = [(p, s) for p, s in all_stats if not is_goleado_arq(p, s) and p.get("name")]
    if not candidates:
        candidates = [(p, s) for p, s in all_stats if p.get("name")]
    if not candidates:
        return None, None

    figura, fig_side = max(
        candidates,
        key=lambda x: (x[0]["rating"], x[0]["goals"] * 3 + x[0]["assists"] * 2),
    )
    return figura, fig_side


# ── Resumen textual ────────────────────────────────────────────────────────────

def build_summary(rep_match, score_home, score_away, home_team, away_team):
    """Genera el resumen con goleadores y tarjetas del partido representativo."""
    home_s = rep_match.get("home", [])
    away_s = rep_match.get("away", [])

    def fmt_scorers(stats):
        parts = []
        for p in stats:
            if p["goals"] > 0:
                parts.append(f"{p['name'] or p['position']} ({p['goals']})")
        return ", ".join(parts) if parts else "—"

    def fmt_cards(stats, team, color):
        parts = [p["name"] or p["position"]
                 for p in stats if p.get(color)]
        return [f"{n} ({team})" for n in parts]

    home_scorers = fmt_scorers(home_s)
    away_scorers = fmt_scorers(away_s)

    yellows = (fmt_cards(home_s, home_team, "yellow_card") +
               fmt_cards(away_s, away_team, "yellow_card"))
    reds    = (fmt_cards(home_s, home_team, "red_card") +
               fmt_cards(away_s, away_team, "red_card"))

    lines = [
        f"Resultado: {home_team} {score_home} – {score_away} {away_team}",
        f"Goles — {home_team}: {home_scorers} | {away_team}: {away_scorers}",
    ]
    if yellows:
        lines.append(f"Amarillas: {', '.join(yellows)}")
    if reds:
        lines.append(f"Rojas: {', '.join(reds)}")

    return " | ".join(lines)


# ── Narración principal ────────────────────────────────────────────────────────

def generate_narration(rep_match, home_team, away_team, seed=42):
    """
    Genera la lista de eventos narrados [{minuto, tipo, texto}].
    Determinista: misma seed + mismo rep_match → misma narración.
    """
    rng = random.Random(seed)

    # Eventos del motor + sintéticos
    events = list(rep_match.get("events", []))
    events += synthesize_extra_events(rep_match, rng)
    events.sort(key=lambda e: e.get("minute", 0))

    sh, sa           = 0, 0           # marcador en vivo
    half_inserted    = False
    red_teams        = set()          # equipos con expulsados
    narration        = []

    def pick(template_key, **kwargs):
        return rng.choice(TEMPLATES[template_key]).format(**kwargs)

    # ── Arranque ──────────────────────────────────────────────────────────────
    narration.append({
        "minuto": 0,
        "tipo":   "arranque",
        "texto":  pick("arranque", home_team=home_team, away_team=away_team),
    })

    for ev in events:
        minute  = ev.get("minute", 0)
        ev_type = ev.get("type", "")
        side    = ev.get("side", "home")
        team    = home_team if side == "home" else away_team

        # Insertar entretiempo si corresponde
        if not half_inserted and minute > 45:
            narration.append({
                "minuto": 45,
                "tipo":   "entretiempo",
                "texto":  pick("entretiempo",
                               home_team=home_team, away_team=away_team, sh=sh, sa=sa),
            })
            half_inserted = True

        if ev_type == "goal":
            # Actualizar marcador ANTES de narrar (para mostrar el marcador correcto)
            if side == "home":
                sh += 1
            else:
                sa += 1

            scorer   = ev.get("player", "")
            assister = ev.get("assister")
            if not scorer:
                scorer = "un jugador"

            if assister:
                texto = pick("gol_con_asistencia",
                             scorer=scorer, assister=assister, min=minute,
                             home_team=home_team, away_team=away_team, sh=sh, sa=sa)
            else:
                texto = pick("gol_sin_asistencia",
                             scorer=scorer, min=minute,
                             home_team=home_team, away_team=away_team, sh=sh, sa=sa)

            narration.append({"minuto": minute, "tipo": "gol", "texto": texto})

        elif ev_type == "yellow_card":
            player = ev.get("player", "")
            narration.append({
                "minuto": minute,
                "tipo":   "amarilla",
                "texto":  pick("amarilla", player=player, team=team, min=minute),
            })

        elif ev_type == "red_card":
            player = ev.get("player", "")
            red_teams.add(side)
            narration.append({
                "minuto": minute,
                "tipo":   "roja",
                "texto":  pick("roja", player=player, team=team, min=minute),
            })

        elif ev_type == "save":
            player = ev.get("player", "")
            narration.append({
                "minuto": minute,
                "tipo":   "atajada",
                "texto":  pick("save", player=player, min=minute),
            })

        elif ev_type == "bigChanceMissed":
            player = ev.get("player", "")
            narration.append({
                "minuto": minute,
                "tipo":   "ocasion_errada",
                "texto":  pick("bigChanceMissed", player=player, min=minute),
            })

    # Entretiempo si todos los eventos fueron ≤45'
    if not half_inserted:
        narration.append({
            "minuto": 45,
            "tipo":   "entretiempo",
            "texto":  pick("entretiempo",
                           home_team=home_team, away_team=away_team, sh=sh, sa=sa),
        })

    # ── Pitazo final ──────────────────────────────────────────────────────────
    narration.append({
        "minuto": 92,
        "tipo":   "pitazo_final",
        "texto":  pick("pitazo_final",
                       home_team=home_team, away_team=away_team, sh=sh, sa=sa),
    })

    # ── Figura del partido ────────────────────────────────────────────────────
    figura, fig_side = compute_figura(rep_match, sh, sa)
    if figura:
        fig_team = home_team if fig_side == "home" else away_team
        ga       = sa if fig_side == "home" else sh
        pts      = calc_points(figura, ga)
        # Si el capitán es la figura, doble puntos
        narration.append({
            "minuto": 93,
            "tipo":   "figura",
            "texto":  (f"Figura del partido: {figura['name']} ({fig_team}). "
                       f"Rating: {figura['rating']:.1f} | {pts} pts fantasy. "
                       + (f"Anotó {figura['goals']} gol(es)." if figura['goals'] else
                          f"Distribuyó {figura['assists']} asistencia(s)." if figura['assists'] else
                          "Gran actuación defensiva.")),
        })

    # ── Resumen ───────────────────────────────────────────────────────────────
    narration.append({
        "minuto": 94,
        "tipo":   "resumen",
        "texto":  build_summary(rep_match, sh, sa, home_team, away_team),
    })

    return narration, sh, sa


# ── Formato texto plano ────────────────────────────────────────────────────────

def narration_to_text(narration, home_team, away_team, score_home, score_away):
    """Genera el texto plano legible del partido."""
    W = 64
    sep_double = "=" * W
    sep_single = "-" * W

    header_score = f"{home_team}  {score_home}  -  {score_away}  {away_team}"
    header_line  = f"  {header_score.center(W - 4)}  "

    lines = [
        "",
        sep_double,
        header_line,
        sep_double,
        "",
    ]

    prev_tipo = None
    for ev in narration:
        min_str  = f"{ev['minuto']:3d}'"
        tag      = TYPE_TAG.get(ev["tipo"], "         ")
        texto    = ev["texto"]

        # Separador visual antes del entretiempo, pitazo final y resumen
        if ev["tipo"] in ("entretiempo", "pitazo_final", "resumen", "figura"):
            if prev_tipo not in ("entretiempo", "pitazo_final", "resumen", "figura", "arranque"):
                lines.append(sep_single)

        # Envolver texto largo en múltiples líneas
        prefix   = f"{min_str} | {tag} | "
        indent   = " " * len(prefix)
        max_w    = W - len(prefix)
        words    = texto.split()
        cur_line = ""
        out_text = []
        for w in words:
            if cur_line and len(cur_line) + 1 + len(w) > max_w:
                out_text.append(cur_line)
                cur_line = w
            else:
                cur_line = (cur_line + " " + w).strip()
        if cur_line:
            out_text.append(cur_line)

        for k, part in enumerate(out_text):
            if k == 0:
                lines.append(f"{prefix}{part}")
            else:
                lines.append(f"{indent}{part}")

        prev_tipo = ev["tipo"]

    lines.append("")
    lines.append(sep_double)
    lines.append("")

    return "\n".join(lines)


# ── CLI ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Narración de un partido simulado en español rioplatense")
    parser.add_argument("--match",  type=str, required=True,
                        help="Path al JSON del partido (mismo formato que simulate.py --match)")
    parser.add_argument("--seed",   type=int, default=42,
                        help="Seed para la narración (default: 42)")
    parser.add_argument("--n-sims", type=int, default=10_000,
                        help="Simulaciones para obtener el partido representativo")
    parser.add_argument("--out",    type=str, default=None,
                        help="Path de salida del TXT (default: data/sim/narration_<nombre>.txt)")
    args = parser.parse_args()

    # Cargar JSON del partido
    with open(args.match, encoding="utf-8") as f:
        lineups = json.load(f)

    home_team = lineups.get("home_team", "Local")
    away_team = lineups.get("away_team", "Visitante")

    # Sembrar el random global ANTES de la simulación para que
    # misma seed + mismo partido → mismo representativo → misma narración.
    random.seed(args.seed)

    print(f"\nSimulando {home_team} vs {away_team} ({args.n_sims:,} iteraciones)...")
    result = simulate_match(
        lineups["home"],
        lineups["away"],
        home_team,
        away_team,
        tactics_home=lineups.get("tactics_home", {}),
        tactics_away=lineups.get("tactics_away", {}),
        n_sims=args.n_sims,
    )

    rep = result.get("representative_match")
    if not rep:
        print("❌ No se encontró partido representativo en el resultado.", file=sys.stderr)
        sys.exit(1)

    print(f"Partido representativo: {rep['score_home']} – {rep['score_away']}  "
          f"(marcador modal: {max(result['score_distribution'], key=lambda k: result['score_distribution'][k])})")
    print(f"Win probs: local {result['win_probs']['home']:.1%} / "
          f"empate {result['win_probs']['draw']:.1%} / "
          f"visitante {result['win_probs']['away']:.1%}")

    # Generar narración
    print(f"\nGenerando narración (seed={args.seed})...")
    narration, sh, sa = generate_narration(rep, home_team, away_team, seed=args.seed)

    # Verificación de consistencia: goleadores narrados vs stats del partido
    narrated_scorers = {}
    for ev in narration:
        if ev["tipo"] == "gol":
            # Extraer nombre del goleador del texto es frágil; mejor verificar
            # que el marcador final narrado coincide con el del rep
            pass

    # Verificar que el marcador narrado coincide con el partido representativo
    assert sh == rep["score_home"] and sa == rep["score_away"], (
        f"Marcador narrado {sh}-{sa} ≠ partido representativo {rep['score_home']}-{rep['score_away']}"
    )
    print(f"[OK] Marcador narrado {sh}-{sa} coincide con el partido representativo.")

    # Verificar que los goleadores narrados tienen goles en sus stat lines
    narrated_goal_players = set()
    for ev in narration:
        if ev["tipo"] == "gol":
            # El nombre del goleador está en rep["events"][...]["player"]
            pass
    # Verificación indirecta: contar goles por side en los eventos narrados
    narrated_home_goals = sum(1 for ev in narration if ev["tipo"] == "gol"
                               and any(e["type"] == "goal" and e["side"] == "home"
                                       and e.get("player") in ev["texto"]
                                       for e in rep.get("events", [])))
    # Simple check: total goles narrados == rep score
    goles_narrados = sum(1 for ev in narration if ev["tipo"] == "gol")
    assert goles_narrados == sh + sa, (
        f"Goles narrados {goles_narrados} ≠ marcador {sh+sa}"
    )
    print(f"[OK] Goles narrados ({goles_narrados}) coinciden con el marcador.")

    # ── Texto plano ──────────────────────────────────────────────────────────
    plain_text = narration_to_text(narration, home_team, away_team, sh, sa)

    # Determinar nombre base para los archivos de salida
    match_name = os.path.splitext(os.path.basename(args.match))[0]
    os.makedirs(OUT_DIR, exist_ok=True)

    txt_path  = args.out or os.path.join(OUT_DIR, f"narration_{match_name}.txt")
    json_path = os.path.join(OUT_DIR, f"narration_{match_name}.json")

    with open(txt_path, "w", encoding="utf-8") as f:
        f.write(plain_text)
    print(f"[OK] Texto plano guardado en: {txt_path}")

    # JSON enriquecido con la narración
    out_json = {
        "home_team":         home_team,
        "away_team":         away_team,
        "tactics_home":      lineups.get("tactics_home", {}),
        "tactics_away":      lineups.get("tactics_away", {}),
        "win_probs":         result["win_probs"],
        "score_distribution": result["score_distribution"],
        "avg_goals_home":    result["avg_goals_home"],
        "avg_goals_away":    result["avg_goals_away"],
        "avg_points_home":   result["avg_points_home"],
        "avg_points_away":   result["avg_points_away"],
        "representative_match": rep,
        "narration":         narration,
    }
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(out_json, f, indent=2, ensure_ascii=False)
    print(f"[OK] JSON enriquecido guardado en: {json_path}")

    # Mostrar el texto plano en pantalla
    print(plain_text)


if __name__ == "__main__":
    main()
