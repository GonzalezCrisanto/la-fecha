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

# Corner outcomes: (tipo_narration, template)
# tipo drives the icon on the frontend: corner=🚩 cleared, ocasion_errada=💨 off-target, atajada=🧤 saved
CORNER_OUTCOMES = [
    # Cleared by defense
    ("corner",         "Córner ejecutado por {player}, centro al segundo palo, cabecea {header}… ¡DESPEJADO en la línea! Casi."),
    ("corner",         "Córner de {player}, pelota que baja al área chica, forcejeo, y la defensa la saca como puede. Qué lío en el área."),
    ("corner",         "Córner de {player}, centro largo al segundo palo, {header} la baja de pecho y remata… ¡Bloqueado por la defensa!"),
    ("corner",         "Córner de {player}, pelota al área chica, {header} cabecea… despejado por la defensa sobre la misma línea. ¡De milagro!"),
    ("corner",         "{player} ejecuta el córner con rosca, la pelota baja al área chica… {header} no llega y la defensa la saca."),
    # Off target / hit woodwork
    ("ocasion_errada", "Tiro de esquina de {player}, pelota envenenada al primer palo, {header} la toca… ¡AFUERA por poco! Estuvo cerquísima."),
    ("ocasion_errada", "{player} ejecuta el córner, centro preciso, sube {header}… ¡Cabezazo al travesaño! El palo vibró."),
    ("ocasion_errada", "{player} opta por el córner corto, combina con el compañero, tira desde afuera del área… ¡Se va afuera!"),
    ("ocasion_errada", "Córner de {player}, bola al segundo palo, {header} cabecea con fuerza… ¡Al palo! El estadio se paraliza."),
    ("ocasion_errada", "{player} ejecuta el córner con rosca, {header} sube y la pica de cabeza… ¡Afuera por centímetros!"),
    # Saved by goalkeeper
    ("atajada",        "Tiro de esquina de {player}, pelota que se mete directo al arco… ¡El arquero la atrapa en el último momento!"),
    ("atajada",        "{player} ejecuta el córner con rosca, la pelota se curva… {header} cabecea pero el arquero la ataja firme."),
    ("atajada",        "Tiro de esquina de {player}, bola envenenada al área, {header} la toca de cabeza… ¡El arquero la saca de un puñetazo en el aire!"),
    ("atajada",        "Córner de {player}, centro al primer palo, {header} cabecea a quemarropa… ¡ATAJADA increíble del arquero!"),
    ("atajada",        "{player} coloca el córner perfecto, {header} cabecea sin marca… pero el arquero se lanza y la desvía al córner."),
]

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

        "Combinación de lujo a los {min}': {assister} la filtró entre líneas y {scorer} la empujó al fondo. "
        "{home_team} {sh} – {sa} {away_team}.",

        "¡{scorer} apareció en el momento justo a los {min}'! El centro de {assister} fue preciso. "
        "Marcador: {home_team} {sh} – {sa} {away_team}.",

        "A los {min}' {assister} desbordó y centró; {scorer} no tuvo piedad. "
        "{home_team} {sh} – {sa} {away_team}.",

        "¡Qué jugada colectiva a los {min}'! {assister} la puso en bandeja y {scorer} definió solo. "
        "{home_team} {sh} – {sa} {away_team}.",

        "Golazo a los {min}'. {assister} abrió la cancha y encontró a {scorer} que la clavó sin parar la pelota. "
        "Parcial: {home_team} {sh} – {sa} {away_team}.",
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

        "¡{scorer} encaró solo y la puso abajo a los {min}'! No había nada que hacer. "
        "{home_team} {sh} – {sa} {away_team}.",

        "A los {min}' {scorer} agarró la pelota de media vuelta y la mandó al ángulo. Golazo. "
        "{home_team} {sh} – {sa} {away_team}.",

        "¡Gol de {scorer} a los {min}'! Tiro libre impecable, el arquero no llegó ni a verla. "
        "{home_team} {sh} – {sa} {away_team}.",

        "{scorer} gambeteó a dos y la colocó al segundo palo a los {min}'. De lujo. "
        "{home_team} {sh} – {sa} {away_team}.",

        "¡{min}' — {scorer} reventó el travesaño… y entró! El público enloquece. "
        "{home_team} {sh} – {sa} {away_team}.",
    ],

    "amarilla": [
        "Tarjeta amarilla para {player} de {team} a los {min}' por una falta sobre el rival.",
        "{player} ({team}) vio la amarilla a los {min}'. El árbitro no le perdonó la entrada.",
        "El árbitro le mostró la cartulina amarilla a {player} ({team}) a los {min}'.",
        "Amarilla para {player} de {team} a los {min}'. Tiene que cuidarse de ahora en más.",
        "{min}' — Amonestado {player} ({team}). La presión del partido se hace sentir.",
        "Cartulina amarilla para {player} ({team}) a los {min}'. Demasiada dureza en esa entrada.",
        "{player} de {team} se gana la amarilla a los {min}'. Una falta innecesaria.",
        "{min}' — El árbitro para el juego y saca la amarilla para {player} ({team}).",
        "Amarilla polémica para {player} ({team}) a los {min}'. El banco protestó la decisión.",
        "{player} ({team}) llega a la amonestación a los {min}'. Tendrá que bajar los decibeles.",
    ],

    "doble_amarilla": [
        "¡SEGUNDA AMARILLA para {player} de {team} a los {min}'! Doble amonestación y a las duchas.",
        "{player} ({team}) vio la segunda amarilla a los {min}'. Dos en uno: se va expulsado.",
        "El árbitro le mostró la segunda tarjeta amarilla a {player} ({team}) a los {min}'. Que se vaya.",
        "¡Doble amarilla para {player} de {team} a los {min}'! El equipo deberá seguir con diez.",
        "{min}' — Segunda amarilla para {player} ({team}). Dos advertencias, una expulsión.",
        "¡Se fue {player} ({team}) a los {min}'! Primera amarilla, segunda amarilla, y chau. Con diez.",
        "El árbitro no tuvo dudas: segunda tarjeta para {player} ({team}) a los {min}'. A bañarse.",
        "{min}' — {player} ({team}) no aprendió la lección. Doble amarilla y roja. {team} en inferioridad.",
        "Adiós {player} de {team} a los {min}'. La segunda tarjeta lo deja afuera; el equipo sufre.",
        "¡Increíble! {player} ({team}) repite la falta a los {min}' y el árbitro no tiene piedad. Con diez.",
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

        "¡Roja para {player} ({team}) a los {min}'! Entrada criminal; el árbitro no tardó ni un segundo.",
        "{min}' — Expulsión directa de {player} ({team}). Falta gravísima. {team} tendrá que sufrir.",
        "¡Se fue {player} de {team} a los {min}'! Roja directa, sin escalas. El banco explota de bronca.",
        "Brutal la entrada de {player} ({team}) a los {min}'. Ni lo dudó el árbitro: roja y a la ducha.",
        "{min}' — {player} ({team}) pierde la cabeza y se va expulsado. {team} deberá remar cuesta arriba.",
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

    "own_goal": [
        "¡Gol en contra de {player} ({team}) a los {min}'! La pelota entró en su propio arco. "
        "{home_team} {sh} – {sa} {away_team}.",
        "Tragedia para {team} a los {min}': {player} la mandó adentro sin querer. "
        "{home_team} {sh} – {sa} {away_team}.",
        "¡Autogol de {player} ({team}) a los {min}'! Nadie lo podía creer en el estadio. "
        "{home_team} {sh} – {sa} {away_team}.",
        "Error fatal de {player} ({team}) a los {min}'. La pelota tomó un desvío y entró. "
        "{home_team} {sh} – {sa} {away_team}.",
        "{min}' — Gol en contra de {player} ({team}). Intento de despejar y terminó adentro. "
        "{home_team} {sh} – {sa} {away_team}.",
    ],

    "offside": [
        "¡Offside! El asistente levanta el banderín y frena el ataque de {team}.",
        "{player} ({team}) queda en posición adelantada a los {min}'. El árbitro cobra el fuera de juego.",
        "La jugada prometedora de {team} se corta por offside de {player}.",
        "{min}' — {player} ({team}) habilitado… no, el asistente marca offside.",
        "Posición adelantada de {player} ({team}) a los {min}'. El VAR no tuvo que intervenir.",
        "Fuera de juego de {player} ({team}) a los {min}'. Lo encontró el asistente.",
    ],

    "var_gol": [
        "El VAR entra en escena para revisar el gol. Tras unos minutos de análisis… "
        "¡El gol es válido! Sigue el marcador.",
        "Revisión del VAR. El árbitro consulta el monitor… la imagen es clara: gol válido.",
        "VAR — Posible offside en la jugada del gol. El sistema lo confirma: sin infracción. ¡Gol!",
        "El VAR revisó una posible mano. La decisión: todo en regla. El gol se mantiene.",
        "Dos minutos de espera y el árbitro da el visto bueno. El gol queda en pie.",
    ],

    "var_tarjeta": [
        "El VAR revisó la acción que derivó en la tarjeta. Decisión confirmada.",
        "Intervención del VAR. El árbitro fue al monitor y mantuvo su decisión original.",
        "VAR — Revisión de la infracción. La tarjeta se mantiene sin cambios.",
        "El VAR analizó la jugada y el árbitro de campo no rectificó su decisión.",
        "Minutos de revisión y el árbitro ratificó lo que ya había sancionado en campo.",
    ],

    "save_sequence": [
        "Combinación de pases por el sector derecho, avanza en velocidad, se la da al compañero, queda solo frente al arco… ¡ATAJADA INCREÍBLE de {player}! El arco se salvó de milagro.",
        "Centro al área, cabecea el delantero… ¡{player} VUELA y la saca con una mano! Intervención de otro mundo.",
        "Remate cruzado de afuera, bajo y al ángulo… {player} SE ESTIRA y la manda al córner. ¡Qué arquero!",
        "Contraataque rapidísimo, definición casi cantada… pero {player} anticipó todo y tapó con el pie. ¡Increíble!",
        "Pelotazo en profundidad, el delantero amaga y remata… ¡ATAJADÓN de {player}! El equipo le debe un punto.",
        "Centro rasante, el nueve la pica al primer palo… {player} se tira y la saca con la punta de los dedos. Espectacular.",
        "Tiro libre desde la entrada del área, bien colocado… {player} se lanza y la toca sobre la línea. ¡No entró!",
        "Córner ejecutado, cabecea al segundo palo… {player} se eleva y la atrapa en el aire. Seguridad total.",
        "Pelota filtrada, mano a mano inevitable… {player} achica, achica y le tapa el remate. ¡Héroe del arco!",
        "Volea desde adentro del área, parecía gol… {player} reaccionó en el último instante y la sacó. Magistral.",
    ],

    "ocasion_sequence": [
        "{player} avanza por el medio, amaga, tira de afuera… ¡SE VA AFUERA por muy poco! El palo la espera.",
        "{player} quedó solo, definió cruzado… ¡CONTRA EL PALO! Se salvó el arco rival.",
        "Centro al área, {player} cabecea sin marca… ¡AFUERA! Se lamentó todo el estadio.",
        "{player} gambeteó a dos defensores, la acomodó y tiró… ¡Por arriba del travesaño! Estaba hecho ese gol.",
        "Contraataque, {player} a mano a mano, definió con el pie derecho… ¡AFUERA! Increíble el fallo.",
        "{player} recibió de espaldas, giró y la pateó al ángulo… el arquero no llegó pero el poste la salvó.",
        "Remate de volea de {player} desde el borde del área… ¡Altísima! Se fue por las nubes.",
        "Centro al primer palo, {player} remató de cabeza… ¡El arquero la sacó sobre la línea! Mano a mano con el gol.",
        "{player} se plantó ante el arco, amago al arquero y definió… ¡Afuera por centímetros! No podía errarla.",
        "Tiro libre de {player}, bien colocado al ángulo… ¡La madera! El travesaño vibró.",
    ],

    "corner_base": [
        "Córner para {team} a los {min}'. {player} va a ejecutar desde la bandera.",
        "{team} gana un córner a los {min}'. {player} se acerca al banderín de esquina.",
        "Tiro de esquina para {team} a los {min}'. {player} coloca la pelota en el arco de esquina.",
        "Córner a favor de {team} a los {min}'. {player} buscará a los suyos en el área.",
        "{min}' — Córner. {team} genera otro balón parado peligroso. Lo ejecuta {player}.",
        "Pelota al córner, saque de esquina para {team} a los {min}'. Ejecuta {player}.",
    ],

    "gol_de_corner": [
        "Córner de {corner_taker}, centro preciso al primer palo… cabecea {scorer} y la manda adentro. ¡GOOOOOL! {home_team} {sh} – {sa} {away_team}.",
        "Tiro de esquina de {corner_taker}, pelota al segundo palo… {scorer} sube más alto que todos y la clava en el ángulo. ¡GOL DE CABEZA! {home_team} {sh} – {sa} {away_team}.",
        "{corner_taker} ejecuta el córner con rosca, la pelota baja picada al área chica… y {scorer} la empuja adentro. ¡GOOOOL! Qué golazo de pelota parada. {home_team} {sh} – {sa} {away_team}.",
        "Córner de {corner_taker}, centro envenenado, forcejeo en el área… {scorer} la toca de cabeza y la pelota se mete al ángulo. ¡GOOOOOL! {home_team} {sh} – {sa} {away_team}.",
        "Saque de esquina ejecutado por {corner_taker}, pelota que envenena el área… ¡{scorer} apareció en el segundo palo y no perdonó! GOL. {home_team} {sh} – {sa} {away_team}.",
        "{corner_taker} coloca el córner perfecto, la pelota cae en el área chica… {scorer} de cabeza, sin marca, ¡ADENTRO! El estadio explota. {home_team} {sh} – {sa} {away_team}.",
        "Córner rasante de {corner_taker}, {scorer} se anticipa al arquero… ¡GOL! De cabeza, al primer palo. Exquisito. {home_team} {sh} – {sa} {away_team}.",
        "Centro al área de {corner_taker} desde el córner, cabecea {scorer}… ¡LA PELOTA ENTRA! ¡GOL DE PELOTA DETENIDA! {home_team} {sh} – {sa} {away_team}.",
    ],

    "gol_de_tiro_libre": [
        "Tiro libre para {team} en zona peligrosa a los {min}'. {scorer} pone la pelota… amaga… ¡LA CLAVÓ EN EL ÁNGULO! Arquero sin chances. {home_team} {sh} – {sa} {away_team}.",
        "Falta en zona de peligro. {scorer} se prepara para ejecutar el tiro libre a los {min}'… ¡GOOOOL! La pelota pasó por encima de la barrera y entró sin tocar el palo. {home_team} {sh} – {sa} {away_team}.",
        "{scorer} al tiro libre a los {min}'… la curva, la potencia… ¡GOOOOOL! El arquero ni la vio. Que tiro impresionante. {home_team} {sh} – {sa} {away_team}.",
        "¡GOLAZO DE TIRO LIBRE de {scorer} a los {min}'! La barrera saltó de un lado, la pelota fue al otro. El arquero se quedó clavado. {home_team} {sh} – {sa} {away_team}.",
        "Silencio en el estadio. {scorer} coloca la pelota, toma distancia… corre… ¡BOOM! En el ángulo superior. Golazo de tiro libre a los {min}'. {home_team} {sh} – {sa} {away_team}.",
        "Tiro libre a los {min}' para {team}. {scorer} amaga con un compañero, pide silencio al estadio… ¡LA MANDA AL FONDO! Magistral. {home_team} {sh} – {sa} {away_team}.",
        "{scorer} enfrenta el tiro libre a los {min}', la barrera levanta… él la pica por abajo. ¡El arquero no llegó! ¡GOL! {home_team} {sh} – {sa} {away_team}.",
        "Falta cobrada por {scorer} a los {min}'. La pelota pasó rasante por encima de la barrera… ¡GOOOOOL! No hay palabras para describir esa pelota. {home_team} {sh} – {sa} {away_team}.",
    ],

    "tiro_libre_peligroso": [
        "Tiro libre de {scorer} a los {min}'… la barrera salta y bloquea el disparo. ¡La defensa la salvó!",
        "{scorer} ejecuta el tiro libre a los {min}', busca el ángulo… ¡ATAJADA INCREÍBLE del arquero! Se lució el guardameta.",
        "Libre directo de {scorer} a los {min}'… ¡AL TRAVESAÑO! La madera lo salvó. ¡Qué cerca estuvo!",
        "{scorer} a los {min}', apunta al ángulo… ¡SE FUE AFUERA por centímetros! El equipo se lamenta.",
        "Tiro libre de {scorer} a los {min}', la pelota pega en la barrera y sale al córner. Saque de esquina.",
        "{scorer} ejecuta el libre directo a los {min}'… el arquero vuela y la manda al palo. ¡Qué tapada!",
        "Libre desde zona peligrosa, {scorer} a los {min}'… la barrera despeja de cabeza. Buen trabajo defensivo.",
        "{scorer} apunta al ángulo superior a los {min}'… ¡AL PALO! La pelota salió despejada. Estuvo.",
    ],

    "falta_normal": [
        "Falta de {player} ({team}) a los {min}'. El árbitro la cobra y el juego se detiene brevemente.",
        "{player} ({team}) comete una infracción a los {min}'. Tiro libre indirecto para los rivales.",
        "A los {min}' el árbitro frena el juego. Falta de {player} ({team}). El juego se reanuda rápido.",
        "Infracción de {player} ({team}) a los {min}'. El árbitro cobra la falta y el partido sigue.",
        "{min}' — Falta de {player} ({team}). Sencilla, sin mayores consecuencias. El partido continúa.",
        "El árbitro para el juego a los {min}'. Falta de {player} ({team}), el equipo rival coloca la pelota.",
    ],

    "falta_peligrosa_anuncio": [
        "¡Falta en zona de peligro a los {min}'! {team} tiene un tiro libre en posición ideal.",
        "El árbitro cobra falta a los {min}'. ¡Zona peligrosa para {team}! Se viene un disparo al arco.",
        "{min}' — Infracción dentro de los 25 metros. {team} tiene un tiro libre peligroso.",
        "Falta cobrada a los {min}' en zona caliente. {team} tiene una chance de oro con pelota detenida.",
    ],

    "penal_a_favor": [
        "¡PENAL para {team}! El árbitro no dudó: mano en el área a los {min}'. {player} va a patear.",
        "¡PENAL! Falta sobre el delantero dentro del área a los {min}'. {player} toma la pelota.",
        "El árbitro señala el punto del penal a los {min}' en favor de {team}. Va {player}.",
        "¡Penal para {team} a los {min}'! La entrada fue adentro del área, no había dudas. Patea {player}.",
        "¡Cobran penal! {team} tiene la chance de abrir el marcador a los {min}'. {player} al punto.",
        "El VAR revisó y confirmó: penal para {team} a los {min}'. {player} enfrenta al arquero.",
    ],

    "penal_convertido": [
        "¡GOOOOOL de penal! {player} la pateó al ángulo y el arquero no llegó. Frialdad total.",
        "¡Gol de {player} desde los doce pasos! Esquina baja, imparable. ¡Se lo merecía el equipo!",
        "Penal convertido por {player} a los {min}'. Tiro cruzado, arquero volando al lado.",
        "¡{player} no perdonó desde el punto del penal! La pelota fue al ángulo y entró limpia.",
        "¡Golazo de penal de {player}! Pausa, amague y la puso donde el arquero no llegó. Maestro.",
        "{player} tomó carrera, definió al centro mientras el arquero se tiraba… ¡Adentro! Calidad.",
    ],

    "penal_fallado": [
        "¡ATAJÓ EL ARQUERO! {player} pateó al centro, el guardameta se quedó y la sacó. ¡Qué tapada!",
        "¡AFUERA el penal de {player}! El tiro se fue rozando el poste. Una pesadilla.",
        "¡El palo! {player} pateó a un lado, el arco se cerró y la madera la salvó. Increíble.",
        "Penal fallado por {player} a los {min}'. El arquero adivinó la esquina y voló a sacarla.",
        "¡Que se lamente {player}! La pelota pegó en el travesaño y salió. El estadio en silencio.",
        "{player} se paró ante el penal, pateó… ¡el arquero la sacó con la pierna! ¡Qué locura!",
    ],

    "var_anulado": [
        "¡GOOOOOL de {player}! El estadio explota… pero el VAR frena todo. Revisión en curso.",
        "¡Gol de {player}! Festejo en el área… pero el árbitro espera el VAR. Hay algo irregular.",
        "¡La pelota entró! {player} la empujó y festejó… pero el central va al monitor. Cuidado.",
    ],

    "var_anulado_razon_offside": [
        "¡Offside! El VAR detectó posición adelantada en el arranque de la jugada. El gol no vale. Silencio en el estadio.",
        "La línea del VAR es implacable: {player} estaba habilitado por centímetros… pero no, estaba adelantado. Gol anulado.",
        "Revisión milimétrica y el VAR dice offside. El festejo quedó en la nada. Así es el fútbol moderno.",
    ],

    "var_anulado_razon_mano": [
        "¡Mano en el área! El VAR detectó contacto involuntario en el desarrollo de la jugada. Gol anulado.",
        "El VAR encontró la mano: en la jugada previa al gol, hubo contacto con el brazo. Se anula.",
        "Mano de jugador en la construcción del gol. El árbitro fue al monitor y no tuvo dudas: no es gol.",
    ],

    "var_anulado_razon_falta": [
        "Falta en el origen de la jugada: hubo empujón antes del gol. El VAR lo vio todo. Gol anulado.",
        "El VAR detectó una falta en el inicio de la jugada. El árbitro anuló el gol tras revisar el monitor.",
        "Contacto irregular previo: el VAR encontró la infracción que el árbitro no había visto. No es gol.",
    ],

    "var_anulado_reaccion": [
        "El estadio que festejaba ahora protesta. Los jugadores increédulos. Así es el VAR.",
        "La tribuna enloquece de bronca. El fútbol de hoy en día tiene estas cosas.",
        "Los jugadores del equipo se miran sin entender. Los del otro festejan con mesura. Raro todo.",
        "El banco técnico eleva el reclamo pero el árbitro es claro: la decisión está tomada.",
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
    "doble_amarilla": "DBL AMR  ",
    "gol_en_contra":  "GOL(C)   ",
    "atajada":        " ATAJADA ",
    "ocasion_errada": "OCASION  ",
    "corner":         " CORNER  ",
    "offside":        "OFFSIDE  ",
    "var":            "  VAR    ",
    "entretiempo":    "DESCANSO ",
    "pitazo_final":   "  FINAL  ",
    "figura":         "  FIGURA ",
    "resumen":        " RESUMEN ",
    "falta":          "  FALTA  ",
    "var_anulado":    "VAR(ANUL)",
}


# ── Eventos sintéticos ────────────────────────────────────────────────────────

def synthesize_extra_events(rep_match, rng, start_minute=1, end_minute=90):
    """
    Genera eventos de atajadas y ocasiones erradas a partir de las stats del partido.
    No modifica el partido base; retorna lista de eventos adicionales.
    """
    events      = []
    score_home  = rep_match["score_home"]
    score_away  = rep_match["score_away"]
    used_mins   = {ev["minute"] for ev in rep_match.get("events", [])}

    def free_minute(lo=None, hi=None):
        """Minuto libre dentro del rango del período simulado."""
        lo = max(start_minute, lo) if lo is not None else start_minute
        hi = min(end_minute - 2, hi) if hi is not None else end_minute - 2
        lo = min(lo, hi)
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

    # Córners (3-8 por equipo, ejecutados por mediocampistas o delanteros)
    # Corner goals (source == "corner") get their own dedicated corner event at the same minute
    # so the narration can handle them with gol_de_corner template.
    for side in ("home", "away"):
        executors = [p for p in rep_match[side]
                     if p["position"] in ("MED", "DEL") and p.get("name")]
        headers = [p for p in rep_match[side]
                   if p["position"] in ("DEF", "MED", "DEL") and p.get("name")]
        if not executors:
            continue

        # Collect corner goals for this side
        corner_goals = [
            ev for ev in rep_match.get("events", [])
            if ev.get("type") == "goal" and ev.get("side") == side
            and ev.get("source") == "corner"
        ]

        # Generate a dedicated corner event for each corner goal at the SAME minute
        # (goal event sorts before corner event, updates sh/sa first)
        for cg in corner_goals:
            taker = cg.get("corner_taker") or (rng.choice(executors)["name"] if executors else "")
            events.append({
                "side":         side,
                "type":         "corner",
                "player":       taker,
                "header":       cg["player"],
                "minute":       cg["minute"],  # same minute as goal so score is already updated
                "outcome_type": "goal",
                "is_goal":      True,
                "scorer":       cg["player"],
                "corner_taker": taker,
            })

        # Synthetic (non-goal) corners: 3-8 per team
        n_corners = rng.randint(3, 8)
        outcomes = ["header_saved", "header_wide", "cleared", "deflection", "scramble"]
        for _ in range(n_corners):
            events.append({
                "side":         side,
                "type":         "corner",
                "player":       rng.choice(executors)["name"],
                "header":       rng.choice(headers)["name"] if headers else "",
                "minute":       free_minute(),
                "outcome_type": rng.choice(outcomes),
                "is_goal":      False,
            })

    # Offsides (1-3 por equipo, solo delanteros)
    for side in ("home", "away"):
        forwards = [p for p in rep_match[side]
                    if p["position"] == "DEL" and p.get("name")]
        if not forwards:
            forwards = [p for p in rep_match[side]
                        if p["position"] == "MED" and p.get("name")]
        n_offsides = rng.randint(1, 3)
        for _ in range(n_offsides):
            if forwards:
                events.append({
                    "side":   side,
                    "type":   "offside",
                    "player": rng.choice(forwards)["name"],
                    "minute": free_minute(),
                })

    # Faltas (2-5 por equipo, con zona tagging)
    for side in ("home", "away"):
        foulers = [p for p in rep_match[side]
                   if p.get("fouls", 0) > 0 and p.get("name")]
        if not foulers:
            foulers = [p for p in rep_match[side]
                       if p["position"] in ("DEF", "MED") and p.get("name")]
        if not foulers:
            continue

        # Free kick goals for this side's opponents (the team that benefits from fouls against this side)
        opp_side = "away" if side == "home" else "home"
        fk_goals = [
            ev for ev in rep_match.get("events", [])
            if ev.get("type") == "goal" and ev.get("side") == opp_side
            and ev.get("source") == "free_kick"
        ]

        n_fouls = rng.randint(2, 5)
        fk_goals_used = set()  # track which fk goals already got a foul event

        for _ in range(n_fouls):
            fouler = rng.choice(foulers)
            is_danger = rng.random() < 0.35

            if is_danger:
                # Check if any unused free_kick goal exists
                linked_goal = None
                for fkg in fk_goals:
                    if id(fkg) not in fk_goals_used:
                        linked_goal = fkg
                        fk_goals_used.add(id(fkg))
                        break

                if linked_goal:
                    # Foul at the goal's minute (goal sorts after, updates sh/sa)
                    events.append({
                        "side":           side,
                        "type":           "falta",
                        "player":         fouler["name"],
                        "minute":         linked_goal["minute"],
                        "zone":           "danger",
                        "free_kick_type": "to_goal",
                        "fk_scorer":      linked_goal["player"],
                        "fk_minute":      linked_goal["minute"],
                    })
                else:
                    events.append({
                        "side":           side,
                        "type":           "falta",
                        "player":         fouler["name"],
                        "minute":         free_minute(),
                        "zone":           "danger",
                        "free_kick_type": "no_goal",
                    })
            else:
                events.append({
                    "side":   side,
                    "type":   "falta",
                    "player": fouler["name"],
                    "minute": free_minute(),
                    "zone":   "normal",
                })

        # Guarantee a falta event for every free kick goal that wasn't linked above.
        # Without this, goals whose source is "free_kick" silently update the score
        # but produce no narration event, causing the frontend goal counter to desync.
        for fkg in fk_goals:
            if id(fkg) not in fk_goals_used:
                fk_goals_used.add(id(fkg))
                fouler = rng.choice(foulers)
                events.append({
                    "side":           side,
                    "type":           "falta",
                    "player":         fouler["name"],
                    "minute":         fkg["minute"],
                    "zone":           "danger",
                    "free_kick_type": "to_goal",
                    "fk_scorer":      fkg["player"],
                    "fk_minute":      fkg["minute"],
                })

    return events


def synthesize_var_cancelled(rep_match, rng, start_minute=1, end_minute=90):
    """
    Genera 0-2 goles fantasmas anulados por VAR (puramente narrativos, no afectan el marcador).
    """
    events = []
    n = rng.randint(0, 2)
    used_mins = {ev.get("minute", 0) for ev in rep_match.get("events", [])}

    def free_minute(lo, hi):
        for _ in range(20):
            m = rng.randint(lo, hi)
            if m not in used_mins:
                used_mins.add(m)
                return m
        m = rng.randint(lo, hi)
        used_mins.add(m)
        return m

    reasons = ["offside", "mano", "falta"]
    for _ in range(n):
        side = rng.choice(["home", "away"])
        players = [p for p in rep_match[side]
                   if p["position"] in ("DEL", "MED") and p.get("name")]
        if not players:
            players = [p for p in rep_match[side] if p.get("name")]
        if not players:
            continue
        player = rng.choice(players)
        minute = free_minute(start_minute + 5, end_minute - 5)
        events.append({
            "side":   side,
            "type":   "var_anulado",
            "player": player["name"],
            "reason": rng.choice(reasons),
            "minute": minute,
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
            if p.get("own_goals", 0) > 0:
                parts.append(f"{p['name'] or p['position']} (GEC)")
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

def generate_narration(rep_match, home_team, away_team, seed=42,
                       start_score_home=0, start_score_away=0,
                       start_minute=1, end_minute=90):
    """
    Genera la lista de eventos narrados [{minuto, tipo, texto}].
    start_score_home/away: score del primer tiempo si narramos solo el segundo.
    start_minute/end_minute: ventana del período simulado (46-90 para segundo tiempo).
    """
    rng = random.Random(seed)

    # Eventos del motor + sintéticos (respetan la ventana de tiempo)
    events = list(rep_match.get("events", []))
    events += synthesize_extra_events(rep_match, rng, start_minute, end_minute)
    events += synthesize_var_cancelled(rep_match, rng, start_minute, end_minute)
    events.sort(key=lambda e: e.get("minute", 0))

    # Resolve minute collisions: nudge forward, but cap at end_minute and
    # never push a first-half event (≤45) past minute 44 into the second half.
    seen_minutes: set[int] = set()
    seen_minutes.add(45)   # reserve for halftime marker
    for ev in events:
        m = ev.get("minute", 0)
        original_m = m
        while m in seen_minutes:
            m += 1
        if m > end_minute:
            # fell off the end — push backward from original instead
            m = original_m
            while m in seen_minutes:
                m -= 1
            m = max(start_minute, m)
        seen_minutes.add(m)
        ev["minute"] = m

    sh, sa           = start_score_home, start_score_away
    is_second_half   = start_minute > 1
    half_inserted    = is_second_half  # el descanso ya ocurrió si arrancamos en el ST
    red_teams        = set()          # equipos con expulsados
    narration        = []

    def pick(template_key, **kwargs):
        return rng.choice(TEMPLATES[template_key]).format(**kwargs)

    # ── Arranque (solo primer tiempo) ─────────────────────────────────────────
    if not is_second_half:
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
            if side == "home":
                sh += 1
            else:
                sa += 1

            # Penalty goals are narrated by the "penal" event; skip duplicate narration
            if ev.get("_penalty"):
                continue

            # Corner and free kick goals: score updated above, narration handled by
            # the corner/falta event that comes right after (same minute, stable sort)
            goal_source = ev.get("source", "open_play")
            if goal_source == "corner":
                continue
            if goal_source == "free_kick":
                continue

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

            narration.append({"minuto": minute, "tipo": "gol", "texto": texto, "side": side, "player": scorer})

            # VAR review post-gol (20% de probabilidad)
            if rng.random() < 0.20:
                narration.append({
                    "minuto": minute + 1, "tipo": "var", "side": side,
                    "texto":  pick("var_gol"),
                })

        elif ev_type == "own_goal":
            # Gol en contra: el beneficiado es el equipo contrario
            if side == "home":
                sa += 1
            else:
                sh += 1
            player = ev.get("player", "")
            narration.append({
                "minuto": minute, "tipo": "gol_en_contra", "side": side, "player": player,
                "texto":  pick("own_goal", player=player, team=team, min=minute,
                               home_team=home_team, away_team=away_team, sh=sh, sa=sa),
            })

        elif ev_type == "yellow_card":
            player = ev.get("player", "")
            narration.append({
                "minuto": minute, "tipo": "amarilla", "side": side, "player": player,
                "texto":  pick("amarilla", player=player, team=team, min=minute),
            })

        elif ev_type == "doble_amarilla":
            player = ev.get("player", "")
            red_teams.add(side)
            narration.append({
                "minuto": minute, "tipo": "doble_amarilla", "side": side, "player": player,
                "texto":  pick("doble_amarilla", player=player, team=team, min=minute),
            })
            if rng.random() < 0.15:
                narration.append({
                    "minuto": minute + 1, "tipo": "var", "side": side,
                    "texto":  pick("var_tarjeta"),
                })

        elif ev_type == "red_card":
            player = ev.get("player", "")
            red_teams.add(side)
            narration.append({
                "minuto": minute, "tipo": "roja", "side": side, "player": player,
                "texto":  pick("roja", player=player, team=team, min=minute),
            })
            if rng.random() < 0.15:
                narration.append({
                    "minuto": minute + 1, "tipo": "var", "side": side,
                    "texto":  pick("var_tarjeta"),
                })

        elif ev_type == "save":
            player = ev.get("player", "")
            narration.append({
                "minuto": minute, "tipo": "atajada", "side": side, "player": player,
                "texto":  pick("save_sequence", player=player, min=minute),
            })

        elif ev_type == "bigChanceMissed":
            player = ev.get("player", "")
            narration.append({
                "minuto": minute, "tipo": "ocasion_errada", "side": side, "player": player,
                "texto":  pick("ocasion_sequence", player=player, min=minute),
            })

        elif ev_type == "corner":
            player = ev.get("player", "")
            header = ev.get("header", player)
            if ev.get("is_goal"):
                scorer = ev.get("scorer", header)
                corner_taker = ev.get("corner_taker", player)
                texto = pick("gol_de_corner",
                             scorer=scorer, corner_taker=corner_taker, min=minute,
                             home_team=home_team, away_team=away_team, sh=sh, sa=sa)
                narration.append({
                    "minuto": minute, "tipo": "gol", "side": side, "player": scorer,
                    "texto":  texto,
                })
                # VAR review post-gol (20% de probabilidad)
                if rng.random() < 0.20:
                    narration.append({
                        "minuto": minute + 1, "tipo": "var", "side": side,
                        "texto":  pick("var_gol"),
                    })
            else:
                # Two separate items: announcement → typed outcome
                base_text = pick("corner_base", player=player, team=team, min=minute)
                outcome_tipo, outcome_tpl = rng.choice(CORNER_OUTCOMES)
                outcome_text = outcome_tpl.format(player=player, header=header)
                narration.append({
                    "minuto": minute, "tipo": "corner", "side": side, "player": player,
                    "texto":  base_text,
                })
                narration.append({
                    "minuto": minute, "tipo": outcome_tipo, "side": side, "player": player,
                    "texto":  outcome_text,
                })

        elif ev_type == "offside":
            player = ev.get("player", "")
            narration.append({
                "minuto": minute, "tipo": "offside", "side": side, "player": player,
                "texto":  pick("offside", player=player, team=team, min=minute),
            })

        elif ev_type == "penal":
            player = ev.get("playerName", ev.get("player", ""))
            converted = ev.get("converted", False)
            ann_text = pick("penal_a_favor", player=player, team=team, min=minute)
            if converted:
                result_text = pick("penal_convertido", player=player, min=minute)
                # tipo "gol" so the frontend live-score counter picks it up
                narration_tipo = "gol"
            else:
                result_text = pick("penal_fallado", player=player, min=minute)
                # tipo "atajada" so the save icon renders (most failed penalties
                # involve the keeper; semantically close enough for misses too)
                narration_tipo = "atajada"
            full_text = ann_text + " " + result_text
            narration.append({
                "minuto": minute, "tipo": narration_tipo, "side": side, "player": player,
                "texto":  full_text,
            })

        elif ev_type == "var_anulado":
            player = ev.get("player", "")
            reason = ev.get("reason", "offside")
            ann_text = pick("var_anulado", player=player)
            reason_key = f"var_anulado_razon_{reason}"
            reason_text = pick(reason_key, player=player)
            reaction_text = pick("var_anulado_reaccion")
            full_text = ann_text + " " + reason_text + " " + reaction_text
            narration.append({
                "minuto": minute, "tipo": "var_anulado", "side": side, "player": player,
                "texto":  full_text,
            })

        elif ev_type == "falta":
            player   = ev.get("player", "")
            zone     = ev.get("zone", "normal")
            opp_side = "away" if side == "home" else "home"
            opp_team = away_team if side == "home" else home_team
            if zone == "danger":
                # team commits the foul; opp_team benefits from the free kick
                ann_text = pick("falta_peligrosa_anuncio", team=opp_team, min=minute)
                fk_type = ev.get("free_kick_type", "no_goal")
                if fk_type == "to_goal":
                    scorer = ev.get("fk_scorer", player)
                    fk_min = ev.get("fk_minute", minute)
                    result_text = pick("gol_de_tiro_libre",
                                       scorer=scorer, team=opp_team, min=fk_min,
                                       home_team=home_team, away_team=away_team, sh=sh, sa=sa)
                    narration.append({
                        "minuto": minute, "tipo": "gol", "side": opp_side,
                        "player": scorer, "texto": ann_text + " " + result_text,
                    })
                else:
                    # no-goal: use a forward/mid from the benefiting team as FK taker
                    fk_candidates = [p for p in rep_match[opp_side]
                                     if p["position"] in ("DEL", "MED") and p.get("name")]
                    fk_taker = rng.choice(fk_candidates)["name"] if fk_candidates else opp_team
                    result_text = pick("tiro_libre_peligroso", scorer=fk_taker, min=minute)
                    narration.append({
                        "minuto": minute, "tipo": "falta", "side": side, "player": player,
                        "texto":  ann_text + " " + result_text,
                    })
            else:
                narration.append({
                    "minuto": minute, "tipo": "falta", "side": side, "player": player,
                    "texto":  pick("falta_normal", player=player, team=team, min=minute),
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
            "side":   fig_side,
            "player": figura["name"],
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
    # Penales convertidos ahora emiten tipo "gol", mismos que el resto.
    goles_narrados = sum(1 for ev in narration if ev["tipo"] in ("gol", "gol_en_contra"))
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
