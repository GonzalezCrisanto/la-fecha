/**
 * Generates public/data/players.json from THEDATA/players_argentina_2026.csv
 *
 * Filters: position present + >= MIN_MINUTES played
 * Position mapping: GK→ARQ, DF→DEF, MF→MED, FW→DEL (multi-pos: take first)
 *
 * overall: percentile rank within position group of a composite score:
 *   Outfield — goals/90 45% + assists/90 30% + minutes_pct 25%
 *   ARQ      — clean_sheet_pct 65% + minutes_pct 35%
 *   (market value intentionally excluded so overall = in-season performance)
 *
 * value (price): 65% performance (overall) + 35% market reputation (log EUR value)
 *   Scaled to [5, 50]. No market data → 0% market component.
 *   Budget is 400, so 11 quality players (~overall 70) cost ~370–380.
 */

import fs from "fs";
import path from "path";

const CSV_PATH = path.join(process.cwd(), "THEDATA", "players_argentina_2026.csv");
const OUT_PATH = path.join(process.cwd(), "public", "data", "players.json");
const MIN_MINUTES = 360;

type GamePosition = "ARQ" | "DEF" | "MED" | "DEL";

interface PlayerRecord {
  id: string;
  name: string;
  team: string;
  position: GamePosition;
  overall: number;  // 1–99 percentile within position
  value: number;    // 1–100 price (market-based or composite-estimated)
  goals: number;
  assists: number;
  minutes: number;
  appearances: number;
  yellowCards: number;
  redCards: number;
  cleanSheets: number;
}

// ── CSV parsing ────────────────────────────────────────────────────────────

function parseCsv(raw: string): Record<string, string>[] {
  const lines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const headers = splitLine(lines[0]);
  return lines
    .slice(1)
    .filter((l) => l.trim())
    .map((l) => {
      const vals = splitLine(l);
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => (obj[h] = (vals[i] ?? "").trim()));
      return obj;
    });
}

function splitLine(line: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQ = false;
  for (const c of line) {
    if (c === '"') inQ = !inQ;
    else if (c === "," && !inQ) { result.push(cur); cur = ""; }
    else cur += c;
  }
  result.push(cur);
  return result;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function toGamePosition(fbrefPos: string): GamePosition | null {
  const primary = fbrefPos.split(",")[0].trim();
  const map: Record<string, GamePosition> = { GK: "ARQ", DF: "DEF", MF: "MED", FW: "DEL" };
  return map[primary] ?? null;
}

function slug(name: string, team: string): string {
  return `${name}-${team}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function num(val: string | undefined): number {
  const n = parseFloat(val ?? "");
  return isNaN(n) ? 0 : n;
}

/** Min-max scale val into [outMin, outMax]; returns outMin if all equal */
function minMax(val: number, min: number, max: number, outMin = 0, outMax = 1): number {
  if (max === min) return outMin;
  return outMin + ((val - min) / (max - min)) * (outMax - outMin);
}

/** Log10 min-max scale — better for power-law distributions like market values */
function logMinMax(val: number, min: number, max: number, outMin = 1, outMax = 100): number {
  if (max === min) return outMin;
  const logVal = Math.log10(val);
  const logMin = Math.log10(min);
  const logMax = Math.log10(max);
  return Math.round(outMin + ((logVal - logMin) / (logMax - logMin)) * (outMax - outMin));
}

/** Percentile rank 1–99 of val within a sorted (ascending) array */
function percentileRank(sorted: number[], val: number): number {
  const below = sorted.filter((v) => v < val).length;
  const equal = sorted.filter((v) => v === val).length;
  const pct = (below + equal * 0.5) / sorted.length;
  return Math.max(1, Math.min(99, Math.round(pct * 99)));
}

// ── Parse + filter ─────────────────────────────────────────────────────────

const raw = fs.readFileSync(CSV_PATH, "utf-8").replace(/^﻿/, "");
const rows = parseCsv(raw);

const candidates = rows
  .filter((r) => {
    const minutes = num(r["standard_Playing Time_Min"]);
    const pos = toGamePosition(r["standard_pos"] ?? "");
    return minutes >= MIN_MINUTES && pos !== null;
  })
  .map((r) => {
    const minutes = num(r["standard_Playing Time_Min"]);
    const appearances = num(r["standard_Playing Time_MP"]);
    const goals = num(r["standard_Performance_Gls"]);
    const assists = num(r["standard_Performance_Ast"]);
    const cleanSheets = num(r["keeper_Performance_CS"]);
    const nineties = minutes / 90;
    return {
      name: r["player"],
      team: r["team"],
      pos: toGamePosition(r["standard_pos"])!,
      marketValue: num(r["market_value_eur"]),
      goals,
      assists,
      minutes,
      appearances,
      yellowCards: num(r["standard_Performance_CrdY"]),
      redCards: num(r["standard_Performance_CrdR"]),
      cleanSheets,
      goalsP90: nineties > 0 ? goals / nineties : 0,
      assistsP90: nineties > 0 ? assists / nineties : 0,
      cleanSheetPct: appearances > 0 ? cleanSheets / appearances : 0,
    };
  });

// Deduplicate by name+team — keep highest-minutes row
const deduped = new Map<string, (typeof candidates)[0]>();
for (const p of candidates) {
  const key = slug(p.name, p.team);
  const existing = deduped.get(key);
  if (!existing || p.minutes > existing.minutes) deduped.set(key, p);
}
const players = Array.from(deduped.values());

// ── Normalization bounds ───────────────────────────────────────────────────

// Global market value bounds (only players with data) — used for log scaling
const marketValues = players.map((p) => p.marketValue).filter((v) => v > 0);
const mvMin = Math.min(...marketValues);
const mvMax = Math.max(...marketValues);

// Per-position bounds for per-90 stats and minutes
const byPos = new Map<GamePosition, (typeof players)[0][]>();
for (const p of players) {
  const arr = byPos.get(p.pos) ?? [];
  arr.push(p);
  byPos.set(p.pos, arr);
}

function posMax(pos: GamePosition, fn: (p: (typeof players)[0]) => number): number {
  const group = byPos.get(pos) ?? [];
  return Math.max(...group.map(fn), 0.001); // avoid divide by zero
}

// ── Composite score (0–1) ──────────────────────────────────────────────────
// Market value deliberately excluded: overall must reflect in-season performance,
// not transfer reputation. This decouples price from quality, enabling bargain picks.

function compositeScore(p: (typeof players)[0]): number {
  const minPct = p.minutes / posMax(p.pos, (x) => x.minutes);

  if (p.pos === "ARQ") {
    return p.cleanSheetPct * 0.65 + minPct * 0.35;
  }

  const gNorm = p.goalsP90 / posMax(p.pos, (x) => x.goalsP90);
  const aNorm = p.assistsP90 / posMax(p.pos, (x) => x.assistsP90);
  return gNorm * 0.45 + aNorm * 0.30 + minPct * 0.25;
}

// ── Overall: percentile within position ───────────────────────────────────

const scoreMap = new Map<string, number>();
for (const p of players) scoreMap.set(slug(p.name, p.team), compositeScore(p));

const overallMap = new Map<string, number>();
for (const [, group] of byPos) {
  const sorted = group.map((p) => scoreMap.get(slug(p.name, p.team))!).sort((a, b) => a - b);
  for (const p of group) {
    const id = slug(p.name, p.team);
    overallMap.set(id, percentileRank(sorted, scoreMap.get(id)!));
  }
}

// ── Value (price) ──────────────────────────────────────────────────────────
// 65% in-season performance (overall percentile) + 35% market reputation (log EUR).
// Players without market data get 0% market component — pure performance price.
// Output range [5, 50]; budget 400 → 11 quality (~overall 70) players cost ~370–380.

function playerValue(p: (typeof players)[0]): number {
  const id = slug(p.name, p.team);
  const overall = overallMap.get(id) ?? 1;
  const perfScore = overall / 99; // 0–1

  const mvPremium =
    p.marketValue > 0 && mvMax > mvMin
      ? (Math.log10(p.marketValue) - Math.log10(mvMin)) /
        (Math.log10(mvMax) - Math.log10(mvMin))
      : 0;

  const mixed = 0.65 * perfScore + 0.35 * mvPremium;
  return Math.max(5, Math.min(50, Math.round(5 + mixed * 45)));
}

// ── Build output ───────────────────────────────────────────────────────────

const output: PlayerRecord[] = players.map((p) => {
  const id = slug(p.name, p.team);
  return {
    id,
    name: p.name,
    team: p.team,
    position: p.pos,
    overall: overallMap.get(id) ?? 50,
    value: playerValue(p),
    goals: p.goals,
    assists: p.assists,
    minutes: p.minutes,
    appearances: p.appearances,
    yellowCards: p.yellowCards,
    redCards: p.redCards,
    cleanSheets: p.pos === "ARQ" ? p.cleanSheets : 0,
  };
});

output.sort((a, b) => b.overall - a.overall);

// ── Write ──────────────────────────────────────────────────────────────────

const outDir = path.dirname(OUT_PATH);
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2), "utf-8");

// ── Summary ────────────────────────────────────────────────────────────────

const byPosCount = output.reduce<Record<string, number>>((acc, p) => {
  acc[p.position] = (acc[p.position] ?? 0) + 1;
  return acc;
}, {});

const noMarket = output.filter((p) => p.value <= 20).length;

console.log(`✓ Generated ${output.length} players → ${OUT_PATH}`);
console.log(`  Min minutes filter: ${MIN_MINUTES}`);
console.log(`  Distribution:  ${JSON.stringify(byPosCount)}`);
console.log(`  Overall range: ${Math.min(...output.map((p) => p.overall))}–${Math.max(...output.map((p) => p.overall))}`);
console.log(`  Value range:   ${Math.min(...output.map((p) => p.value))}–${Math.max(...output.map((p) => p.value))}`);
console.log(`  Budget players (value ≤20): ${noMarket} players`);
console.log(`\n  Top 5 per position:`);

for (const pos of ["ARQ", "DEF", "MED", "DEL"] as GamePosition[]) {
  const top = output.filter((p) => p.position === pos).slice(0, 3);
  console.log(`  [${pos}]`, top.map((p) => `${p.name} (${p.team}) ov:${p.overall} val:${p.value}`).join(" | "));
}
