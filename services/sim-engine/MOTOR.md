# Motor de Simulación — Documentación Técnica

> `services/sim-engine/` — Python + FastAPI + Monte Carlo

---

## Índice

1. [Arquitectura general](#1-arquitectura-general)
2. [Fuentes de datos](#2-fuentes-de-datos)
3. [Resolución de perfil de jugador](#3-resolución-de-perfil-de-jugador)
4. [Calidad de quite de balón (tackle rating)](#4-calidad-de-quite-de-balón-tackle-rating)
5. [Cálculo de xG por equipo](#5-cálculo-de-xg-por-equipo)
6. [Sistema táctico](#6-sistema-táctico)
7. [Simulación de tarjetas y faltas](#7-simulación-de-tarjetas-y-faltas)
8. [Efecto de hombres de menos](#8-efecto-de-hombres-de-menos)
9. [Distribución de goles entre jugadores](#9-distribución-de-goles-entre-jugadores)
10. [Autogoles](#10-autogoles)
11. [Puntos fantasy](#11-puntos-fantasy)
12. [Loop Monte Carlo y resultados agregados](#12-loop-monte-carlo-y-resultados-agregados)
13. [Segundo tiempo](#13-segundo-tiempo)
14. [Bot rival](#14-bot-rival)
15. [Capa de narración](#15-capa-de-narración)
16. [Endpoints de la API](#16-endpoints-de-la-api)
17. [Inconsistencias conocidas y oportunidades de mejora](#17-inconsistencias-conocidas-y-oportunidades-de-mejora)

---

## 1. Arquitectura general

El motor corre **1 simulación** (default) de Monte Carlo por request y devuelve:
- Estadísticas del partido representativo (goles, asistencias, tarjetas, rating, puntos fantasy).
- **Probabilidades de resultado** (gana local / empate / gana visitante).
- Un **partido representativo** con la secuencia completa de eventos.

```
Frontend → POST /simulate → simulate_match() → simulate_one() → resultado
                          → generate_narration(resultado) → crónica en español
```

> `n_sims` puede aumentarse desde la CLI para calibración y análisis de sensibilidad, pero en producción siempre es `1`.

---

## 2. Fuentes de datos

### `player_profiles.json`
Stats reales de jugadores LPF 2026, con **shrinkage bayesiano** para jugadores con pocos partidos:
- `goals_per_90_shrunk` — tasa de goles por 90 min (shrunk hacia la media posicional)
- `assists_per_90_shrunk` — tasa de asistencias
- `fouls_per_90` — faltas por 90 min
- `rating_mean` / `rating_std` — rating promedio y varianza del jugador

Si un jugador no tiene perfil (`n_appearances < 1`), se usa `replacement_priors.json`.

### `position_priors.json`
Media posicional LPF. Se usa cuando un jugador tiene perfil con pocos partidos (suaviza el estimador) y como fallback genérico:

| Posición | goals/90 | fouls/90 | rating_mean |
|----------|----------|----------|-------------|
| ARQ | 0.000 | 0.018 | 7.05 |
| DEF | 0.035 | 1.016 | 6.72 |
| MED | 0.087 | 1.301 | 6.68 |
| DEL | 0.246 | 1.512 | 6.43 |

### `replacement_priors.json`
Stats de jugador desconocido (p25 de cada posición — reemplazo de nivel básico):

| Posición | goals/90 | fouls/90 |
|----------|----------|----------|
| ARQ | 0.000 | 0.018 |
| DEF | 0.015 | 1.016 |
| MED | 0.020 | 1.301 |
| DEL | 0.050 | 1.512 |

### `league_constants.json`
Constantes de calibración LPF:
- `league_avg_goals: 1.0093` — promedio goles/equipo/partido (target de calibración)
- `own_goal_prob: 0.008` — probabilidad de autogol por partido
- `team_strengths` — fuerza de ataque y defensa histórica por club
- Parámetros de tarjetas: `yellow_per_foul`, `yellow_prob_cap`, `red_base_prob`, etc.
- `ten_men_offense_multiplier: 0.75` / `ten_men_defense_multiplier: 1.25`

---

## 3. Resolución de perfil de jugador

```python
resolve_profile(player) → dict de stats
```

1. Busca el jugador por `id` en `player_profiles.json`.
2. Si tiene `n_appearances >= 1` → usa sus stats reales.
3. Si no → usa `replacement_priors` (jugador desconocido, conservador).
4. El frontend puede sobreescribir cualquier stat pasándola directamente en el dict del jugador (`goals_per_90_shrunk`, `fouls_per_90`, etc.). Eso tiene **precedencia** sobre el perfil.

El frontend convierte el **overall** (60–100) a `rating_mean` con esta fórmula:
```
rating_mean = 6.0 + (overall - 65) / 35 × 2.0   →   rango: 5.5 – 8.5
```

---

## 4. Calidad de quite de balón (tackle rating)

```python
compute_tackle_rating(player) → float [0, 1]
```

Derivado de posición + rating del jugador. No es una stat externa: se **calcula en el momento**.

```
factor_posición = { ARQ: 0.05, DEF: 0.80, MED: 0.55, DEL: 0.25 }
normalizado     = clamp((rating_mean - 5.0) / 3.5, 0, 1)
tackle_rating   = normalizado × factor_posición
```

**Ejemplos con rating típico 7.0:**
- DEF: (7.0 - 5.0) / 3.5 × 0.80 = 0.457
- MED: (7.0 - 5.0) / 3.5 × 0.55 = 0.314
- DEL: (7.0 - 5.0) / 3.5 × 0.25 = 0.143

Tiene **dos efectos**:
1. La calidad colectiva del equipo rival reduce tu xG (ver §5).
2. Los quites fallidos generan faltas → tarjetas (ver §7).

---

## 5. Cálculo de xG por equipo

```python
compute_team_xg(lineup, own_team, opp_team,
                own_tactics, opp_tactics,
                opp_tackle_quality) → float
```

### Paso 1 — xG base (raw)
```
raw_xg = Σ goals_per_90_shrunk   (los 11 titulares)
```
Este número refleja cuántos goles por partido aportaría ese equipo puro, sin contexto.

### Paso 2 — Fuerzas de equipo (histórico LPF)
```
effective_atk = team_strengths[equipo_propio].attack_strength
                × formation_attack_mult
                × mentality_attack_mult
                [× 1.15 si mentality=contraataque y rival juega ofensiva/ultra_ofensiva]

effective_def = team_strengths[equipo_rival].defense_strength
                × rival_formation_defense_mult
                × rival_mentality_defense_mult
                × rival_intensity_def_mult
```

`attack_strength` y `defense_strength` son índices históricos calculados de la LPF real. Valores > 1.0 = por encima del promedio.

> **Semántica de defense_strength:** valores MÁS ALTOS significan que el equipo es más difícil de vencer. Newell's = 1.63 (muy difícil), Estudiantes LP = 0.50 (muy permeable).

### Paso 3 — Multiplicador de fuerza relativa
```
strength_mult = √(effective_atk / effective_def)
```
La raíz cuadrada **comprime** diferencias extremas: si la ratio es 4.0 (enorme ventaja), el multiplicador es solo 2.0. Reduce la probabilidad de goleadas irreales.

### Paso 4 — Reducción por calidad de quite rival
```
tackle_xg_mult = 1.15 - (opp_tackle_quality × 0.30)
```
- Rival con tackle_quality = 0.0 → mult = 1.15 (+15% de xG)
- Rival con tackle_quality = 0.5 → mult = 1.00 (neutro)
- Rival con tackle_quality = 1.0 → mult = 0.85 (-15% de xG)

### Paso 5 — xG final (escalado al tiempo simulado)
```
xg = raw_xg × strength_mult × tackle_xg_mult × duration_factor
```
`duration_factor = minutos_simulados / 90`
- Partido completo: 90/90 = 1.0
- Solo segundo tiempo: 45/90 = 0.5

---

## 6. Sistema táctico

### Formaciones
| Formación | Ataque | Defensa |
|-----------|--------|---------|
| 3-4-3 | ×1.10 | ×0.90 |
| 4-3-3 | ×1.05 | ×0.95 |
| 3-5-2 | ×1.00 | ×1.00 |
| 4-4-2 | ×0.98 | ×1.02 |
| 4-2-3-1 | ×0.97 | ×1.05 |
| 5-3-2 | ×0.90 | ×1.12 |

### Mentalidades
| Mentalidad | Ataque propio | Defensa propia | Tarjetas |
|-----------|---------------|----------------|----------|
| ultra_ofensiva | ×1.30 | ×0.75 | ×1.10 |
| ofensiva | ×1.15 | ×0.88 | ×1.05 |
| equilibrada | ×1.00 | ×1.00 | ×1.00 |
| defensiva | ×0.85 | ×1.15 | ×1.00 |
| contraataque | ×0.95 | ×1.05 | ×1.00 |

**Bonus contraataque**: si el equipo juega `contraataque` Y el rival juega `ofensiva` o `ultra_ofensiva`, el multiplicador de ataque recibe un ×1.15 adicional (los espacios que deja el rival).

### Intensidad
| Intensidad | Tarjetas | Defensa rival | Fatiga (min 76–90) |
|-----------|----------|---------------|---------------------|
| alta | ×1.25 | ×1.00 | ×0.80 xG propio |
| media | ×1.00 | ×1.00 | sin efecto |
| baja | ×1.00 | ×1.10 | sin efecto |

La fatiga reduce el xG del equipo en los últimos 15 minutos cuando juega con intensidad `alta`.

---

## 7. Simulación de tarjetas y faltas

Para cada jugador se simulan **dos fuentes de faltas independientes**:

### Fuente A — Faltas de perfil
```
fouls_A = Poisson(fouls_per_90 × duration_factor)
```

### Fuente B — Faltas por quites fallidos
```
intentos    = Poisson(acciones_por_posición × duration_factor)
            donde: ARQ=0, DEF=6, MED=4, DEL=2

fallidos    = Poisson(intentos × (1 - tackle_rating))
fouls_B     = Poisson(fallidos × 0.18)
```
Un DEF malo (tackle_rating bajo) falla más quites → más faltas → más riesgo de tarjeta.

### Total de faltas
```
fouls = fouls_A + fouls_B
```

### Tarjeta amarilla
```
p_yellow = min(fouls × 0.14 × card_mult_equipo, 0.45)
yellow   = Bernoulli(p_yellow)
```
Si el jugador ya tiene una amarilla del primer tiempo (`booked`), una segunda → **expulsión directa** (reemplaza a la amarilla por roja con minuto aleatorio).

### Tarjeta roja directa
```
pos_mult   = { ARQ: 0.2, DEF: 1.4, MED: 1.0, DEL: 0.8 }
foul_mult  = 1.5 si fouls_per_90 ≥ 1.5 (perfil de jugador "faulero"), si no 1.0
p_red      = 0.0025 × pos_mult × foul_mult × card_mult_equipo
red        = Bernoulli(p_red)
```

---

## 8. Efecto de hombres de menos

### En el mismo partido (roja en el tiempo simulado)
```python
apply_ten_men(xg_equipo_con_10, xg_rival, red_minute, consts)
```
```
remaining    = (90 - red_minute) / 90
off_mult     = 1 - (1 - 0.75) × remaining   # reduce xG propio
def_mult     = 1 + (1.25 - 1) × remaining   # aumenta xG rival
```
Si la roja es en el minuto 60: `remaining = 30/90 = 0.33` → se pierde solo el 33% del efecto.

### Segundo tiempo con jugadores pre-expulsados del primer tiempo
```python
for _ in range(11 - len(lineup)):
    apply_ten_men(xg, xg_rival, red_minute=0, consts)
```
`red_minute=0` → `remaining=1.0` → aplica el 100% del multiplicador sobre toda la ventana del segundo tiempo.

Con los valores actuales:
- El equipo con 10 genera **25% menos xG**
- El rival genera **25% más xG**

---

## 9. Distribución de goles entre jugadores

### Total de goles por equipo
```
goals_home = _draw_goals_with_fatigue(xg_home, intensity_home)
```
Internamente divide el tiempo en dos segmentos (hasta min 75 y min 76–90) y samplea Poisson separado para cada uno, reduciendo el segmento tardío por la fatiga si corresponde.

### Distribución entre jugadores (multinomial correlacionada)
```
pesos = [p.goals_per_90_shrunk for p in lineup]
dist  = Multinomial(total_goles, pesos)
```
Los goles están **correlacionados** entre jugadores porque comparten el mismo total de equipo. Evita que todos marquen en el mismo partido.

### Asistencias
Por cada gol (con probabilidad 0.75), se sortea un asistente entre los demás jugadores proporcional a `assists_per_90_shrunk`. El goleador queda excluido de asistirse a sí mismo.

---

## 10. Autogoles

```
own_goal_prob = 0.008  (leído de league_constants.json)
```
Con probabilidad 0.8% por partido, se sortea un autogol:
- Se elige aleatoriamente si es de un jugador local o visitante.
- El candidato es un jugador DEF o MED del equipo que mete el autogol.
- Se suma 1 al marcador del equipo contrario.

---

## 11. Puntos fantasy

| Evento | ARQ | DEF | MED | DEL |
|--------|-----|-----|-----|-----|
| Gol | +16 | +12 | +8 | +6 |
| Asistencia | +3 | +3 | +3 | +3 |
| Portería a cero | +8 | +4 | — | — |
| Gol recibido (ARQ) | −2 | — | — | — |
| Amarilla | −2 | −2 | −2 | −2 |
| Roja | −5 | −5 | −5 | −5 |
| Autogol | −6 | −6 | −6 | −6 |
| ≥ 60 minutos | +1 | +1 | +1 | +1 |
| Rating ≥ 8.5 | +5 | +5 | +5 | +5 |
| Rating 7.5–8.49 | +2 | +2 | +2 | +2 |
| Rating < 6.0 | −2 | −2 | −2 | −2 |

### Rating del jugador (por partido)
```
rating = Normal(rating_mean, rating_std), clamped [4.0, 10.0]
        − 1.5 si el jugador fue expulsado
```

---

## 12. Loop Monte Carlo y resultados agregados

```python
simulate_match(home_lineup, away_lineup, ..., n_sims=1)
```

Con `n_sims=1`, los `win_probs` son binarios (0 o 1) — reflejan el resultado del partido representativo, no una distribución probabilística.

En el **segundo tiempo**, el resultado de cada simulación se combina con el marcador del primer tiempo antes de contar victorias/derrotas:
```
total_home = goles_ST_home + score_home_PT
total_away = goles_ST_away + score_away_PT
```

---

## 13. Segundo tiempo

El endpoint `/simulate-second-half` recibe:
- `score_home` / `score_away` — marcador al descanso
- `booked_home` / `booked_away` — jugadores con amarilla acumulada
- `home` / `away` — lineups (el frontend ya filtró a los expulsados)
- `tactics_home` / `tactics_away` — tácticas del segundo tiempo

### Carry-over de amarillas
Los nombres en `booked_home/away` se guardan en un `set`. Durante la simulación del ST, si un jugador de ese set saca otra amarilla → **expulsión directa**.

### Carry-over de expulsiones
El frontend filtra al jugador expulsado del lineup antes de enviar el request. El motor detecta `len(lineup) < 11` y aplica el efecto de 10 hombres automáticamente (ver §8).

---

## 14. Bot rival

### Formación
Derivada automáticamente contando las posiciones del equipo rival y buscando la formación soportada más cercana por distancia mínima en DEF/MED/DEL.

### Mentalidad — Primer tiempo
Siempre `equilibrada`.

### Mentalidad — Segundo tiempo
| Situación del bot | Mentalidad ST |
|-------------------|---------------|
| Ganando por 2+ | `defensiva` |
| Ganando por 1 | `equilibrada` |
| Empatando | `equilibrada` |
| Perdiendo por 1 | `ofensiva` |
| Perdiendo por 2+ | `ultra_ofensiva` |

### Intensidad
Siempre `media` (ambos tiempos).

---

## 15. Capa de narración

`narrate.py` recibe el **partido representativo** y genera la crónica en español.

### Eventos reales (del simulador)
- Goles con goleador y asistente
- Tarjetas amarillas y rojas
- Autogoles

### Eventos sintéticos (solo narrativos, no afectan resultado)
- Atajadas del arquero (correlacionadas con goles recibidos)
- Ocasiones erradas
- Córners (1–3 por equipo)
- Fuera de juego
- Revisiones VAR

### Figura del partido (MOTM)
Jugador con mejor combinación de goles + asistencias. En caso de empate, gana el de mayor rating simulado.

---

## 16. Endpoints de la API

### `GET /health`
Ping de salud. Render lo usa para el health check.

### `POST /simulate`
```json
{
  "home": [{ "name": "...", "position": "DEF", "goals_per_90_shrunk": 0.05 }],
  "away": [...],
  "tactics_home": { "formation": "4-3-3", "mentality": "ofensiva", "intensity": "alta" },
  "tactics_away": { "formation": null, "mentality": "equilibrada", "intensity": "media" },
  "n_sims": 1,
  "seed": 12345
}
```

### `POST /simulate-second-half`
Extiende `MatchInput` con `score_home`, `score_away`, `booked_home`, `booked_away`.

---

## 17. Inconsistencias conocidas y oportunidades de mejora

### Crítico

**Formación declarada vs. lineup real desacoplados**
El multiplicador de formación aplica independientemente de cuántos DEF/MED/DEL haya realmente en el lineup. Un `4-3-3` declarado con 2 delanteros igual recibe el bonus ×1.05 de ataque. Habría que computar la formación efectiva del lineup (como hace el bot) en lugar de confiar en la declarada.

**Tarjeta roja no usa faltas del partido**
`p_red` es probabilidad fija por jugador basada en su historial. Si un jugador comete 5 faltas en este partido, tiene el mismo riesgo de roja directa que uno que no hizo ninguna. La probabilidad debería escalar con las faltas cometidas en la simulación actual.

**xG de delanteros sin shrinkage desde el frontend**
El frontend computa `goals_per_90_shrunk` sin shrinkage bayesiano: usa directamente `goles / minutos * 90`. Un delantero con 2 goles en 100 minutos da `1.8 goals/90` — irreal — y va a dominar la simulación. El shrinkage debería aplicarse en el motor cuando la confianza del dato es baja.

### Moderado

**`fouls_per_90` vs. inferencia del frontend**
El frontend infiere `fouls_per_90` de tarjetas amarillas dividiendo por `0.28`. El motor usa `yellow_per_foul = 0.14` para el camino inverso. La inconsistencia se atenúa por el cap en `0.45` de probabilidad de amarilla, pero la escala inferida es incorrecta.

**Bot sin variación de intensidad**
El bot siempre juega `media`. Podría usar `alta` si pierde de 2+ en el ST, `baja` si gana de 2+ cuidando el resultado.

**Córners sintéticos subestimados**
La narración genera 1–3 córners por equipo. El promedio real en la LPF es 4–8. Aumentar el rango haría la narración más creíble.

### Menor

**Sin penales en juego abierto**
Los penales no se modelan dentro del partido. Solo existe el modo penalty shootout separado. Esto omite ≈10–15% de los goles reales.

**Sin sustituciones**
Limitación conocida y asumida.

**Calidad defensiva individual sin impacto directo**
El `tackle_quality` es colectivo y reduce el xG rival globalmente, pero no hay una stat por jugador que diferencie un DEF de 90 de overall de uno de 60 en su capacidad de evitar que el delantero contrario reciba el balón.

**Puntos fantasy calculados pero no exhibidos**
El motor calcula `avg_points` por jugador en cada simulación. No hay evidencia de que el frontend los muestre actualmente. Si no se usan, es trabajo muerto en cada request.
