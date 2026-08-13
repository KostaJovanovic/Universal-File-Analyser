/* Analyser - pure table-statistics helpers
   DOM-free math/inference shared by csv.js and renderers/tablekit.js, so both
   read one implementation of column typing, numeric description and grouping. */

export const SAMPLE_CAP = 50000;

// The site's data conventions are European/British throughout, so every
// ambiguous D/M-vs-M/D format below is read DAY FIRST - parsed by hand rather
// than handed to Date.parse, whose non-ISO fallback assumes the opposite
// (US month-first) convention and would silently swap day and month.
const YYYY_DOT_MM = /^((?:19|20)\d{2})\.(0[1-9]|1[0-2])$/;              // 2011.06 - Stats NZ-style quarter/month, no day
const YYYY_SEP_MM_DD = /^((?:19|20)\d{2})[-/](\d{2})[-/](\d{2})/;       // 2024-12-31 / 2024/12/31 - unambiguous, year first
const DMY_SEP = /^(\d{1,2})[-/.](\d{1,2})[-/.]((?:19|20)\d{2})$/;       // 31-12-2024 / 31/12/2024 / 31.12.2024 - day first

// d is a valid day-of-month (1-31) and m a valid month (1-12). Used both ways
// round: validDay(a, b) tests the day-first reading of a field pair, and
// validDay(b, a) tests the month-first reading of the same pair.
function validDay(d: number, m: number) { return d >= 1 && d <= 31 && m >= 1 && m <= 12; }

// A D/M/Y-shaped value is date-like if EITHER reading checks out - so a
// genuinely American value like "8/25/2024" (invalid day-first: 25 is not a
// month) still gets recognised as a date, not dismissed as text before
// looksMonthFirst() below ever gets a chance to notice it proves month-first.
function looksLikeDate(val: string) {
  if (YYYY_DOT_MM.test(val) || YYYY_SEP_MM_DD.test(val)) return true;
  const m = DMY_SEP.exec(val);
  if (!m) return false;
  const a = +m[1], b = +m[2];
  return validDay(a, b) || validDay(b, a);
}

// Parse a cell already identified as 'date' into a UTC timestamp. Everything
// recognised by looksLikeDate() is matched and built by hand (never
// Date.parse) so every format resolves the same way regardless of separator
// or browser; anything else falls through to Date.parse as a last resort.
// monthFirst picks which reading of the DMY_SEP case (31/12/2024 etc, the
// genuinely ambiguous one) to prefer - off (day-first) by default to match
// the site's conventions, or seeded/toggled to month-first for a US file (see
// looksMonthFirst). If the preferred reading isn't actually valid for this
// particular value (e.g. toggled to month-first but this row only parses
// day-first), the other reading is used instead rather than losing the date.
export function parseDateValue(val, monthFirst?: boolean|undefined) {
  const s = (val == null ? '' : String(val)).trim();
  let m;
  if ((m = YYYY_DOT_MM.exec(s))) return Date.UTC(+m[1], +m[2] - 1, 1);
  if ((m = YYYY_SEP_MM_DD.exec(s))) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  if ((m = DMY_SEP.exec(s))) {
    const a = +m[1], b = +m[2], y = +m[3];
    const dayFirstOk = validDay(a, b), monthFirstOk = validDay(b, a);
    if (monthFirst ? monthFirstOk : dayFirstOk) {
      return monthFirst ? Date.UTC(y, a - 1, b) : Date.UTC(y, b - 1, a);
    }
    if (dayFirstOk) return Date.UTC(y, b - 1, a);
    if (monthFirstOk) return Date.UTC(y, a - 1, b);
  }
  const t = Date.parse(s);
  return isNaN(t) ? NaN : t;
}

// Proof, not a guess: a D/M/Y-shaped value that parses only as month-first
// (day-first is impossible) - e.g. "8/25/2024", where 25 can only be a day -
// means the whole column, and by extension the file, is written month-first
// (American). One such row anywhere in a column is enough to flip it, since a
// file is never written with mixed conventions. Used to seed the workbench's
// initial day-first/month-first default; columns where every row is
// ambiguous (both fields <= 12, e.g. "3/4/2024") keep the day-first default
// and rely on the "Dates: D/M/Y" toggle instead.
export function looksMonthFirst(rows, colCount: number, colTypes: string[]) {
  for (let c = 0; c < colCount; c++) {
    if (colTypes[c] !== 'date') continue;
    for (const r of rows) {
      const val = (r[c] || '').trim();
      if (!val) continue;
      const m = DMY_SEP.exec(val);
      if (!m) continue;
      const a = +m[1], b = +m[2];
      if (validDay(b, a) && !validDay(a, b)) return true;
    }
  }
  return false;
}

// Infer a per-column type from a sample of string rows: 'number' | 'date' |
// 'text' | 'empty'. Matches csv.js's existing >80%-majority heuristic.
export function inferColumnTypes(rows: any[], colCount: number) {
  const types = [];
  for (let c = 0; c < colCount; c++) {
    let numCount = 0, dateCount = 0, textCount = 0;
    for (const r of rows) {
      const val = (r[c] || '').trim();
      if (val === '') continue;
      if (looksLikeDate(val)) dateCount++;
      else {
        const n = Number(val);
        if (!isNaN(n) && val !== '') numCount++;
        else textCount++;
      }
    }
    const total = numCount + dateCount + textCount;
    let type;
    if (total === 0) type = 'empty';
    else if (numCount / total > 0.8) type = 'number';
    else if (dateCount / total > 0.8) type = 'date';
    else type = 'text';
    types.push(type);
  }
  return types;
}

// '' / non-numeric -> NaN (same coercion csv.js uses today: Number(val.trim())).
export function toNumber(cell) {
  const s = (cell == null ? '' : String(cell)).trim();
  if (s === '') return NaN;
  return Number(s);
}

// Typed, non-empty values of column c across rows, per its inferred type.
export function columnValues(rows: any[], c: number, type: string) {
  const out = [];
  for (const r of rows) {
    const raw = (r[c] || '').trim();
    if (raw === '') continue;
    if (type === 'number') {
      const n = Number(raw);
      if (!isNaN(n)) out.push(n);
    } else if (type === 'date') {
      const t = parseDateValue(raw);
      if (!isNaN(t)) out.push(t);
    } else {
      out.push(raw);
    }
  }
  return out;
}

// Percentile from an ASCENDING-sorted numeric array (linear interpolation).
export function percentile(sorted: string|any[], p: number) {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// {count,sum,mean,min,max,median,stddev,distinct} over a numeric array.
export function describe(nums: any[]|Iterable<unknown>|null|undefined) {
  const n = nums.length;
  if (n === 0) return { count: 0, sum: 0, mean: NaN, min: NaN, max: NaN, median: NaN, stddev: NaN, distinct: 0 };
  const sorted = nums.slice().sort((a: number, b: number) => a - b);
  const sum = nums.reduce((s, v) => s + v, 0);
  const mean = sum / n;
  const variance = nums.reduce((s: number, v: number) => s + (v - mean) * (v - mean), 0) / n;
  return {
    count: n,
    sum,
    mean,
    min: sorted[0],
    max: sorted[n - 1],
    median: percentile(sorted, 0.5),
    stddev: Math.sqrt(variance),
    distinct: new Set(nums).size,
  };
}

// Pearson correlation coefficient, NaN-safe (returns NaN when either series has
// zero variance or the paired, finite-value count is under 2).
export function pearson(xs: string|any[], ys: string|any[]) {
  const n = Math.min(xs.length, ys.length);
  const px = [], py = [];
  for (let i = 0; i < n; i++) {
    const x = xs[i], y = ys[i];
    if (isFinite(x) && isFinite(y)) { px.push(x); py.push(y); }
  }
  const m = px.length;
  if (m < 2) return NaN;
  const mx = px.reduce((s, v) => s + v, 0) / m;
  const my = py.reduce((s, v) => s + v, 0) / m;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < m; i++) {
    const dx = px[i] - mx, dy = py[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return NaN;
  return sxy / Math.sqrt(sxx * syy);
}

// Group rows by keyCol (as a string key), aggregating valCol with `agg`
// (count|sum|avg|min|max|median). Returns [[key, value], ...] in first-seen order.
export function groupBy(rows, keyCol: number, valCol: number, agg: string) {
  const order = [];
  const buckets = new Map();
  for (const r of rows) {
    const key = (r[keyCol] == null ? '' : String(r[keyCol])).trim();
    if (key === '') continue;
    let bucket = buckets.get(key);
    if (!bucket) { bucket = []; buckets.set(key, bucket); order.push(key); }
    if (agg !== 'count') {
      const n = toNumber(r[valCol]);
      if (!isNaN(n)) bucket.push(n);
    } else {
      bucket.push(1);
    }
  }
  const out = [];
  for (const key of order) {
    const vals = buckets.get(key);
    let value;
    if (agg === 'count') value = vals.length;
    else if (vals.length === 0) value = NaN;
    else if (agg === 'sum') value = vals.reduce((s, v) => s + v, 0);
    else if (agg === 'avg') value = vals.reduce((s, v) => s + v, 0) / vals.length;
    else if (agg === 'min') value = Math.min(...vals);
    else if (agg === 'max') value = Math.max(...vals);
    else if (agg === 'median') value = percentile(vals.slice().sort((a: number, b: number) => a - b), 0.5);
    out.push([key, value]);
  }
  return out;
}
