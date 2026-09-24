// Colours and type used on the canvas. Mirrors the tokens in css/app.css.

import { t } from "./strings.js";

export const COLORS = {
  bg: "#0B1120",
  surface: "#121A2B",
  border: "#223049",
  guide: "#33425C",
  text: "#E8EDF5",
  text2: "#9AA8BF",
  text3: "#7385A0",
  sun: "#FFC24A",
  earth: "#4DA8FF",
  spin: "#FF5E8A",
  leftover: "#FFFFFF",
  coriolis: "#2DD4BF",
};

export const FONT_STACK =
  'Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';

export function font(size, weight = 500) {
  return `${weight} ${size}px ${FONT_STACK}`;
}

/** "#RRGGBB" + alpha -> rgba() string. */
export function alpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export const LEG_STYLE = {
  sun: { color: COLORS.sun, label: t("leg.sun"), dash: null },
  earth: { color: COLORS.earth, label: t("leg.earth"), dash: null },
  cf: { color: COLORS.spin, label: t("leg.cf"), dash: [8, 4] },
  net: { color: COLORS.leftover, label: t("leg.net"), dash: null },
};
