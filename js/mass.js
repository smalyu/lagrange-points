// Mass-ratio slider mapping, named presets and friendly formatting.

import { ROUTH_MU, ratioFromMu } from "./physics.js";
import { t } from "./strings.js";
import { fmtNumber, pct } from "./i18n.js";

export const REAL_EARTH_Q = 3.003e-6;
export const Q_MIN = 1e-6; // 0.0001 % of the Sun
export const Q_MAX = 1; // equal masses
export const ROUTH_Q = ratioFromMu(ROUTH_MU); // 4.006 %

const LOG_MIN = -4; // log10 of 0.0001 %
const LOG_SPAN = 6; // up to 100 %
const CURVE = 0.6;

/** Slider position t in [0, 1] -> mass ratio q = m_earth / m_sun. */
export function qFromT(t) {
  const c = Math.min(1, Math.max(0, t));
  return 10 ** (LOG_MIN + LOG_SPAN * c ** CURVE) / 100;
}

export function tFromQ(q) {
  const pct = Math.min(Q_MAX, Math.max(Q_MIN, q)) * 100;
  const u = (Math.log10(pct) - LOG_MIN) / LOG_SPAN;
  return Math.min(1, Math.max(0, u)) ** (1 / CURVE);
}

export const PRESETS = [
  { id: "earth", label: t("preset.earth"), short: t("preset.earthShort"), q: REAL_EARTH_Q, system: t("system.earth") },
  { id: "jupiter", label: t("preset.jupiter"), short: t("preset.jupiterShort"), q: 9.546e-4, system: t("system.jupiter") },
  { id: "moon", label: t("preset.moon"), short: t("preset.moonShort"), q: 0.0123, system: t("system.moon") },
  { id: "charon", label: t("preset.charon"), short: t("preset.charonShort"), q: 0.1218, system: t("system.charon") },
  { id: "default", label: pct("25"), short: pct("25"), q: 0.25, system: t("system.default") },
  { id: "equal", label: "1:1", short: "1:1", q: 1, system: t("system.equal") },
];

export function presetAt(q, tol = 0.004) {
  return PRESETS.find((p) => Math.abs(Math.log(q / p.q)) < tol) ?? null;
}

/** "25%", "0.0003%", "1.23%" — mass as percent of the Sun (localized). */
export function formatPercent(q) {
  const value = q * 100;
  let digits;
  if (value >= 10) digits = value >= 99.95 ? 0 : 1;
  else if (value >= 1) digits = 2;
  else digits = Math.min(8, Math.max(1, Math.ceil(-Math.log10(value)) + 1));
  return pct(fmtNumber(value, { maximumFractionDigits: digits }));
}

/** Compact "83,000" style numbers with two significant digits. */
export function roughNumber(x) {
  if (!Number.isFinite(x)) return "–";
  if (x >= 1e6) return t("num.million", { n: fmtNumber(Number((x / 1e6).toPrecision(2))) });
  return fmtNumber(Number(x.toPrecision(2)));
}

/** Tag next to the mass value: how much heavier than the real Earth. */
export function exaggerationTag(q) {
  const preset = presetAt(q);
  if (preset?.id === "equal") return t("tag.equal");
  if (preset && preset.id !== "default") return t("tag.system", { system: preset.system });
  const x = q / REAL_EARTH_Q;
  if (x < 0.5) return t("tag.lighter", { x: roughNumber(1 / x) });
  if (x < 1.5) return t("tag.real");
  return t("tag.heavier", { x: roughNumber(x) });
}
