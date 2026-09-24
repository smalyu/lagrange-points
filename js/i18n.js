// Languages: English and Russian.
//
// The language is fixed for the lifetime of the page (switching saves the
// choice and reloads), so modules may build their strings once at import.
// Order of preference: ?lang= in the URL, the saved choice, the browser.
//
// Each module keeps its own string table:
//   const t = defineStrings({ en: { hi: "Hello, {name}" }, ru: { hi: "Привет, {name}" } });
//   t("hi", { name: "Ada" })
// A value can also be a function (params) => string, e.g. for plurals.

export const LANGS = ["en", "ru"];
const STORAGE_KEY = "lagrange-points.lang";

function detect() {
  try {
    const q = new URLSearchParams(window.location.search).get("lang");
    if (q && LANGS.includes(q)) return q;
  } catch {
    // no window (tests) or odd URL
  }
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved && LANGS.includes(saved)) return saved;
  } catch {
    // storage blocked
  }
  try {
    const prefs = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const p of prefs) {
      const base = String(p || "").toLowerCase().split("-")[0];
      if (LANGS.includes(base)) return base;
    }
  } catch {
    // no navigator (tests)
  }
  return "en";
}

let lang = typeof window === "undefined" ? "en" : detect();

export function getLang() {
  return lang;
}

export function isRu() {
  return lang === "ru";
}

export function locale() {
  return lang === "ru" ? "ru-RU" : "en-US";
}

/** For tests: force a language without touching the page. */
export function _setLangForTests(next) {
  lang = LANGS.includes(next) ? next : "en";
}

/** Save the choice and reload the page in that language, keeping the hash. */
export function switchLang(next) {
  if (!LANGS.includes(next) || next === lang) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // ignore: the query parameter below still carries the choice
  }
  const url = new URL(window.location.href);
  if (url.searchParams.has("lang")) {
    // The query wins over the saved choice, so rewrite it.
    url.searchParams.set("lang", next);
    window.location.replace(url.toString());
  } else {
    window.location.reload();
  }
}

function interpolate(text, params) {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined ? String(params[k]) : m));
}

/** Build a translator for one module's table { en: {...}, ru: {...} }. */
export function defineStrings(table) {
  const t = (key, params) => {
    const dict = table[lang] ?? table.en;
    let value = dict?.[key];
    if (value === undefined) value = table.en?.[key];
    if (value === undefined) {
      console.warn(`i18n: missing string "${key}"`);
      return key;
    }
    if (typeof value === "function") return value(params ?? {});
    return interpolate(value, params);
  };
  t.table = table;
  return t;
}

// ---- plurals and numbers --------------------------------------------------------

const pluralRules = {};
/**
 * Pick a plural form. forms: { one, few, many, other } (Russian uses all four;
 * English only one/other). The chosen form may contain {n}.
 */
export function plural(n, forms) {
  const loc = locale();
  pluralRules[loc] = pluralRules[loc] ?? new Intl.PluralRules(loc);
  const cat = pluralRules[loc].select(n);
  const form = forms[cat] ?? forms.other ?? forms.many ?? forms.one;
  return interpolate(form, { n: fmtNumber(n) });
}

const numberFormats = new Map();
/** Locale-aware number: "1,234.5" in English, "1 234,5" in Russian. */
export function fmtNumber(x, opts = {}) {
  if (!Number.isFinite(x)) return "–";
  const key = `${locale()}|${JSON.stringify(opts)}`;
  let f = numberFormats.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale(), { useGrouping: true, ...opts });
    numberFormats.set(key, f);
  }
  return f.format(x);
}

/** Fixed decimals: fmtFixed(0.66, 2) -> "0.66" / "0,66". */
export function fmtFixed(x, digits) {
  return fmtNumber(x, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Percent sign in the local style: "25%" / "25 %" (no-break space). */
export function pct(numberText) {
  return lang === "ru" ? `${numberText} %` : `${numberText}%`;
}

/** Decimal separator of the current language. */
export function decimalSep() {
  return lang === "ru" ? "," : ".";
}

// ---- static DOM -------------------------------------------------------------------

/**
 * Translate the static page. Elements opt in with:
 *   data-i18n="key"              textContent
 *   data-i18n-html="key"         innerHTML (trusted strings from our tables only)
 *   data-i18n-attr="attr:key;attr2:key2"
 */
export function applyDom(t, root = document) {
  document.documentElement.lang = lang;
  for (const el of root.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll("[data-i18n-html]")) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of root.querySelectorAll("[data-i18n-attr]")) {
    for (const pair of el.dataset.i18nAttr.split(";")) {
      const [attr, key] = pair.split(":").map((x) => x.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    }
  }
}
