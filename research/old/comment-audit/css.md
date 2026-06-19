# CSS comment audit

## assets/css/analyser.css

- **Line 3979** — `/* Keep the 2:1 ratio in the sidebar too - width drives the height there. */` → Stale/orphaned and factually wrong. The comment is followed by a blank line and then `.section-meta-preview` — there is no rule enforcing any aspect ratio (no `aspect-ratio`/height rule) after it, so the comment no longer describes any following rule. It is also factually off: the only canvas it could refer to is the histogram, which per the comment at lines 1291-1293 has "No fixed aspect ratio" and renders its intrinsic `1024x200` pixels (≈5.1:1, not 2:1). → **Fix:** Remove the comment (the aspect-ratio rule it described is gone), or if a ratio rule is intended re-add it; do not assert a "2:1 ratio" that no rule sets and that the histogram's 1024x200 source does not have.

## assets/css/fonts.css — no issues
