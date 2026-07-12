/* Analyser - pure table-statistics helpers
   DOM-free math/inference shared by csv.js and renderers/tablekit.js, so both
   read one implementation of column typing, numeric description and grouping. */

export const SAMPLE_CAP = 50000;

// Infer a per-column type from a sample of string rows: 'number' | 'date' |
// 'text' | 'empty'. Matches csv.js's existing >80%-majority heuristic.
export function inferColumnTypes(rows, colCount) {
  const types = [];
  for (let c = 0; c < colCount; c++) {
    let numCount = 0, dateCount = 0, textCount = 0;
    for (const r of rows) {
      const val = (r[c] || '').trim();
      if (val === '') continue;
      const n = Number(val);
      if (!isNaN(n) && val !== '') numCount++;
      else if (/^\d{4}[-/]\d{2}[-/]\d{2}/.test(val) || /^\d{2}[-/]\d{2}[-/]\d{4}/.test(val)) dateCount++;
      else textCount++;
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
export function columnValues(rows, c, type) {
  const out = [];
  for (const r of rows) {
    const raw = (r[c] || '').trim();
    if (raw === '') continue;
    if (type === 'number') {
      const n = Number(raw);
      if (!isNaN(n)) out.push(n);
    } else if (type === 'date') {
      const t = Date.parse(raw);
      if (!isNaN(t)) out.push(t);
    } else {
      out.push(raw);
    }
  }
  return out;
}

// Percentile from an ASCENDING-sorted numeric array (linear interpolation).
export function percentile(sorted, p) {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// {count,sum,mean,min,max,median,stddev,distinct} over a numeric array.
export function describe(nums) {
  const n = nums.length;
  if (n === 0) return { count: 0, sum: 0, mean: NaN, min: NaN, max: NaN, median: NaN, stddev: NaN, distinct: 0 };
  const sorted = nums.slice().sort((a, b) => a - b);
  const sum = nums.reduce((s, v) => s + v, 0);
  const mean = sum / n;
  const variance = nums.reduce((s, v) => s + (v - mean) * (v - mean), 0) / n;
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
export function pearson(xs, ys) {
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
export function groupBy(rows, keyCol, valCol, agg) {
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
    else if (agg === 'median') value = percentile(vals.slice().sort((a, b) => a - b), 0.5);
    out.push([key, value]);
  }
  return out;
}
