# core (rest) comment audit

## assets/js/core/binutil.js

- **Line 51-52** — `// Number from a 64-bit unsigned, clamped to a safe JS integer (good enough for // file sizes / sample counts where exactness beyond 2^53 doesn't matter).` → The comment claims the value is clamped to a safe JS integer, but the code does no clamping: `u64num() { const v = this.u64(); return v <= 9007199254740991n ? Number(v) : Number(v); }` returns `Number(v)` in **both** ternary branches, so a value above 2^53 is converted with the same precision loss, never clamped to `Number.MAX_SAFE_INTEGER`. The "clamped" claim is factually wrong (both branches are identical). → **Fix:** `// Number from a 64-bit unsigned. Converted to a JS Number, which loses // exactness above 2^53 - fine for file sizes / sample counts where that // doesn't matter.`

## assets/js/core/effects.js — no issues

## assets/js/core/export-data.js — no issues

## assets/js/core/formats.js — no issues

## assets/js/core/navigate.js — no issues

## assets/js/core/popups.js — no issues

## assets/js/core/search.js — no issues

## assets/js/core/util.js — no issues

## assets/js/core/video-sync.js — no issues
