# KiCad renderer audit - handoff

Audit of `assets/js/renderers/kicad.js` against the authoritative KiCad C++ source
(`research/kicad-source-mirror-master`). Goal: make our browser renderer faithful
to how KiCad actually interprets `.kicad_pcb` / `.kicad_sch`.

Three deep-dive sections (with C++ file/line citations) live alongside this index:

- [`kicad-handoff/01-footprint-pads.md`](kicad-handoff/01-footprint-pads.md) - footprint placement, back-side flip, pads, drills, holes.
- [`kicad-handoff/02-board-layers.md`](kicad-handoff/02-board-layers.md) - units, layers, tracks, vias, zones, board outline.
- [`kicad-handoff/03-schematic.md`](kicad-handoff/03-schematic.md) - symbol coordinate convention, placement transform, pins.

## Authoritative-source map (where the rules live)

- Geometry maths: `libs/kimath/src/trigo.cpp` (`RotatePoint`), `libs/kimath/src/transform.cpp` (schematic `TRANSFORM`).
- Footprint flip: `pcbnew/footprint.cpp` (`FOOTPRINT::Flip`), pad flip `pcbnew/pad.cpp`.
- Hole render order: `pcbnew/pcb_painter.cpp`, `pcbnew/pcb_draw_panel_gal.cpp` (`GAL_LAYER_ORDER`).
- File format: PCB `pcbnew/.../pcb_io_kicad_sexpr_parser.cpp`; schematic `eeschema/sch_io/kicad_sexpr/...parser.cpp`.
- Layers: `include/layer_ids.h`, `common/lset.cpp`.

## Verdict per finding

Key fact: **KiCad `RotatePoint(+a)` = `(x*cos + y*sin, -x*sin + y*cos)`** - the opposite
handedness to our `rot()` matrix `[cos -sin; sin cos]`. So to match KiCad you call our
`rot()` with `-a`. The schematic path already did this; the PCB path did not.

| # | Finding | Status |
|---|---------|--------|
| Holes punch through all copper (stacked mounting-hole pads) | confirmed correct model | **Fixed** (holes drawn in a final pass after all copper) |
| Oval/slot drills `(drill oval x y)` | were parsed as 0 | **Fixed** (parsed; slot hole drawn) |
| NPTH / pure-hole pads drawn as solid copper | wrong | **Fixed** (copper only when on a Cu layer AND size > drill, else bare hole) |
| **PCB footprint rotation handedness** | **wrong** for non-symmetric parts at non-0/180 angles | **Fixed** (`place` now uses `-orot`; pad shape rotation sign flipped) |
| Roundrect corner ratio hardcoded 0.25 | wrong | **Fixed** (reads per-pad `roundrect_rratio`, default 0.25) |
| Back-side footprint mirror (X about origin + negate orientation) | correct approach | **Fixed earlier** (verify on a *rotated, asymmetric* bottom part now that rotation handedness is corrected) |
| Schematic rotation "wrong" (agent claim) | **false positive** - agent missed that we pass `-inst.rot`; our schematic matches KiCad | No change |
| Through-hole gold detection | our `padColor` keys off `F.Cu&B.Cu` or `*.Cu` | OK in practice (back-side TH pads use `*.Cu`, so they stay gold) |

## Pending (documented, not yet applied)

These are real but did not affect the test board (PEP008, a 2-layer through-hole/SMD
design). Apply when boards exercise them:

1. **Blind / buried / micro vias** - only *through* vias span the whole stack; `blind`/
   `buried`/`micro` span only their `(layers top bottom)` pair. We currently treat every
   via as full-stack. (`02-board-layers.md` D1)
2. **Inner copper + user/technical layer side classification** - `In*.Cu`, `Edge.Cuts`,
   `Margin`, `*.User`, `Eco*` are neither front nor back. Our `sideOfLayer` defaults
   "everything else" to top, so inner copper and drawing layers wrongly land on the top
   face. Copper detection should include `In1.Cu..In30.Cu`. (`02` D2/D3)
3. **Zone fill holes** - within one layer's filled polyset, the first outline is solid
   copper and later outlines are cut-outs; also each `filled_polygon` may carry its own
   `(layer ...)`. We fill every outline solid on the zone's first layer. (`02` D4)
4. **Schematic pin endpoints** - build both endpoints in library space then push both
   through the one placement matrix (we extend then transform; fragile for mirrored
   symbols, though currently working). (`03` #2)
5. **Edge.Cuts inside footprints** count toward board bounds, not just top-level `gr_*`.

## What changed in this pass (`assets/js/renderers/kicad.js`)

- `parseFootprint`: `place()` rotates by `-orot`; pad `rot` sign corrected; parse
  `roundrect_rratio` and oval `(drill oval x y)`.
- `paintBoard`: two-pass render - all copper first, then `drawHole()` for every pad/via,
  then pad-number labels. New `drawHole()` handles round + slot holes.
- `drawPad`: copper drawn only for real annular copper; per-pad roundrect ratio.

All flow through the 3D / Top / Bottom board modes via the shared painter.
