# KiCad footprint and pad rules (handoff for the JS PCB renderer)

Authoritative reference: the KiCad C++ source mirror at
`research/kicad-source-mirror-master`. All file paths and line numbers below are
relative to that tree. This documents exactly how `.kicad_pcb` footprints and
pads must be interpreted so our renderer matches KiCad.

A key structural note up front: modern KiCad (this mirror) stores a footprint
affine transform (`TRANSFORM_TRS`: translate, rotate, per-axis scale) and stores
each child pad's position in the footprint's **library frame** (`m_libPos`). The
interactive `Flip()` operation mutates that stored library geometry. But that is
the in-memory editing model, not the file model. What the **file** stores, and
therefore what our renderer must reproduce, is established by the parser, which
is what this doc keys on.

---

## 1. Footprint placement and flip

### What the file stores

The parser reads a footprint's `(at x y angle)` and `(layer ...)` and nothing
else about side. It never calls `Flip()` on load.

`pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr_parser.cpp:5481` (layer):

```cpp
case T_layer:
{
    PCB_LAYER_ID layer = parseBoardItemLayer();
    footprint->SetLayer( layer == B_Cu ? B_Cu : F_Cu );   // F or B only
```

`...parser.cpp:5510` (position + angle):

```cpp
case T_at:
    pt.x = parseBoardUnits( "X coordinate" );
    pt.y = parseBoardUnits( "Y coordinate" );
    footprint->SetPosition( pt );
    ...
    footprint->SetOrientation( EDA_ANGLE( parseDouble(), DEGREES_T ) );
```

Pad `(at)` is read into the footprint **library frame**, un-mirrored, with an
absolute board-frame angle:

`...parser.cpp:6537`:

```cpp
case T_at:
    pt.x = parseBoardUnits( "X coordinate" );
    pt.y = parseBoardUnits( "Y coordinate" );
    pad->SetFPRelativePosition( pt );      // stored in library frame, NOT pre-mirrored
    ...
    pad->SetOrientation( EDA_ANGLE( parseDouble(), DEGREES_T ) );  // board-frame absolute
```

So: **child (pad/graphic) coordinates in the file are NOT pre-mirrored.** A
back-side footprint stores its pads in exactly the same library coordinates it
would use on the front; the side comes only from `(layer "B.Cu")`. The mirror is
applied when going from library frame to board space. (Comment at
`...parser.cpp:6543`: "The pad angle in the file is a board frame absolute
value.")

### The flip transform

`FOOTPRINT::Flip` (`pcbnew/footprint.cpp:2977`) documents the rule in its own
comment (lines 2987-2989):

```cpp
// When flipped around the X axis (Y coordinates changed) orientation is negated
// When flipped around the Y axis (X coordinates changed) orientation is 180 - old orient.
// Because it is specific to a footprint, we flip around the X axis, and after rotate 180 deg
```

The implementation mirrors the position's Y about the centre, flips the layer,
recursively flips children in the library frame, and **negates the stored
orientation**:

```cpp
MIRROR( finalPos.y, aCentre.y );     // Mirror the Y position (around the X axis)
...
BOARD_ITEM::SetLayer( GetBoard()->FlipLayer( GetLayer() ) );
...
EDA_ANGLE newOrientation = -m_transform.GetRotate();
newOrientation.Normalize180();
m_transform.SetRotate( newOrientation );
...
if( aFlipDirection == FLIP_DIRECTION::LEFT_RIGHT )
    Rotate( aCentre, ANGLE_180 );
```

KiCad's canonical user-facing flip is a Y-axis (left-right) mirror about the
footprint origin: it does the X-axis mirror plus orientation negation, then
rotates 180 degrees, which composes to "mirror X, keep Y, orientation ->
180 - orient" - i.e. a mirror about the **vertical axis** through the origin.
The net visible effect of placing a footprint on the back is therefore: **its X
coordinates are mirrored (mirror about a vertical line through the footprint
origin)**, and copper layers are swapped F<->B.

`PAD::Flip` (`pcbnew/pad.cpp:1738`) confirms the per-pad consequences. It mirrors
the pad position in the library frame, negates the pad's footprint-relative
orientation, and flips the pad's copper layer set:

```cpp
MIRROR( m_libPos, libCentre, aFlipDirection );      // mirror pad pos in lib frame
...
SetFPRelativeOrientation( -GetFPRelativeOrientation() );   // negate pad rotation
...
m_padStack.FlipLayers( GetBoard() );
for( PCB_LAYER_ID layer : m_padStack.LayerSet() )
    flipped.set( GetBoard()->FlipLayer( layer ) );
SetLayerSet( flipped );                              // F.Cu <-> B.Cu, F.Mask <-> B.Mask
```

`IsFlipped()` is just the side test (`pcbnew/footprint.h:614`):

```cpp
bool IsFlipped() const { return GetLayer() == B_Cu; }
```

### Library-frame to board-space transform

The general transform (`libs/kimath/src/geometry/transform_trs.cpp:24`):

```cpp
VECTOR2D TRANSFORM_TRS::Apply( const VECTOR2D& aPoint ) const
{
    VECTOR2D scaled( aPoint.x * m_scaleX, aPoint.y * m_scaleY );
    RotatePoint( scaled, m_rotate );
    return scaled + VECTOR2D( m_translate );
}
```

and `PAD::GetPosition` (`pcbnew/pad.cpp:245`) maps the stored library pad
position to board space via that transform:

```cpp
VECTOR2I PAD::GetPosition() const
{
    if( const FOOTPRINT* fp = GetParentFootprint() )
        return fp->GetTransform().Apply( m_libPos );
    return m_libPos;
}
```

Because the file never bakes the back-side mirror into `m_libPos` (the parser
does not flip), our renderer must apply the mirror itself. For a back-side
footprint the **exact local -> board transform of a child point `(lx, ly)`** in
library coordinates, footprint at `(Fx, Fy)`, footprint angle `rot` (degrees,
file value), is:

```
mirror about vertical axis:   mx = -lx ,  my = ly
rotate by -rot (mirror negates the effective rotation):
   bx = Fx + ( mx*cos(rot) + my*sin(rot) )
   by = Fy + ( -mx*sin(rot) + my*cos(rot) )      // KiCad Y-down rotation, see Q2
```

Equivalently: front-side is rotate-then-translate of `(lx, ly)`; back-side is
the same but with `lx` negated and the rotation sign flipped. Pad orientation on
the back is likewise negated (`-padRot`). This matches what our renderer already
does (negate board-space X, negate pad rotation), with the important caveat
about rotation sign in Q2.

**Summary answers:**
- Flip mirrors **X** about the vertical axis through the footprint origin
  (KiCad's left-right flip; internally an X-mirror + 180 deg rotate).
- The stored footprint `angle` is **negated** on flip
  (`newOrientation = -m_transform.GetRotate()`), and each pad's relative
  orientation is negated too.
- Child coordinates are **NOT** stored already-mirrored in the file; they live
  in the un-mirrored library frame and are mirrored at render/transform time.

---

## 2. Coordinate system and units

- **Internal unit**: 1 nanometre. `include/base_units.h:68`:
  ```cpp
  constexpr double PCB_IU_PER_MM = 1e6;  ///< Pcbnew IU is 1 nanometer.
  ```
  `.kicad_pcb` files express coordinates in **millimetres** (the parser converts
  mm text to nm internal units via `parseBoardUnits`).
- **Y axis points DOWN** (screen / image convention), same as our renderer.
- **Angles are in degrees** in the file (`EDA_ANGLE( parseDouble(), DEGREES_T )`
  at `...parser.cpp:5518` and `:6548`).
- **Angle sign / direction**: KiCad's `RotatePoint`
  (`libs/kimath/src/trigo.cpp:249`) is:
  ```cpp
  pt.x = KiROUND( ( *pY * sinus ) + ( *pX * cosinus ) );
  pt.y = KiROUND( ( *pY * cosinus ) - ( *pX * sinus ) );
  ```
  i.e. `x' = x*cos + y*sin`, `y' = -x*sin + y*cos`. In standard math axes that is
  a **clockwise** rotation; but because the internal Y axis points down, a
  positive file angle renders **counter-clockwise on screen**. This is the
  KiCad convention: positive degrees = CCW as seen on the board.

  Note the sign relative to the textbook CCW matrix `[x*cos - y*sin,
  x*sin + y*cos]`: KiCad's matrix is the **transpose** of that (it negates the
  `sin` terms). See Q5 divergence note.

---

## 3. Pads

### Types (attributes)

Parsed at `...parser.cpp:6444`:

```cpp
case T_thru_hole:    pad->SetAttribute( PAD_ATTRIB::PTH );   // drilled, plated, all copper
case T_smd:          pad->SetAttribute( PAD_ATTRIB::SMD );   // no hole, single side
case T_connect:      pad->SetAttribute( PAD_ATTRIB::CONN );  // no hole, like SMD (edge connector)
case T_np_thru_hole: pad->SetAttribute( PAD_ATTRIB::NPTH );  // drilled, unplated
```

- `thru_hole` (PTH): has a plated hole; copper on its declared layers (normally
  all copper layers `*.Cu`). Default drill emulated to 1 nm if `(drill ...)` is
  missing (`...parser.cpp:6452`).
- `smd`: no hole; drill forced to `(0,0)` (`:6460`).
- `connect` (CONN): no hole; drill forced to `(0,0)` (`:6468`). Behaves like SMD
  copper but is an edge/connector pad (typically gets no solder paste). The
  difference from SMD is semantic (connector role), not geometric.
- `np_thru_hole` (NPTH): has a hole but is **unplated**. The hole still gets
  drilled. Whether it carries copper at all depends on annular ring (see Q5/Q6
  and `PAD::IsOnCopperLayer`, `pad.cpp:1863`): an NPTH whose copper size does not
  exceed the drill has **no annular ring** and is effectively a bare hole.

So `connect` differs from `np_thru_hole` thus: CONN = copper pad, no hole; NPTH
= hole, usually no (or only incidental) copper.

### Shapes

Parsed at `...parser.cpp:6481`:

```cpp
case T_circle:    PAD_SHAPE::CIRCLE
case T_rect:      PAD_SHAPE::RECTANGLE
case T_oval:      PAD_SHAPE::OVAL
case T_trapezoid: PAD_SHAPE::TRAPEZOID
case T_roundrect: PAD_SHAPE::ROUNDRECT   // becomes CHAMFERED_RECT if chamfer params follow
case T_custom:    PAD_SHAPE::CUSTOM
```

How geometry is applied (`PAD::TransformShapeToPolygon`, `pcbnew/pad.cpp:2919`):

- **circle**: radius = `size.x/2` (`size.x == size.y`); a true circle, rotation
  irrelevant. `TransformCircleToPolygon` at `pad.cpp:2943`.
- **oval**: a stadium/obround of `size.x` by `size.y`; the long axis is rotated
  by the pad orientation. `pad.cpp:2946-2956` builds it from two end circles of
  radius `min(dx,dy)` separated by the rotated delta. (Effective corner radius is
  `0.5 * min(w,h)` - a full semicircle on the short ends.)
- **rect / trapezoid**: `TransformTrapezoidToPolygon` with `GetOrientation()`
  and the `rect_delta` trapezoid deltas (`pad.cpp:2960-2971`). Rectangle is the
  trapezoid with zero delta.
- **roundrect / chamfered_rect**: `TransformRoundChamferedRectToPolygon` with
  `GetOrientation()` and `GetRoundRectCornerRadius(layer)` (`pad.cpp:2974-2985`).
- **custom**: merged primitive polygons, `Rotate(GetOrientation())` then
  `Move(shapePos)` (`pad.cpp:2988-2993`).

In every case **rotation is `GetOrientation()`**, the board-absolute pad angle
(= footprint orientation + the pad's relative angle, `pad.cpp:1723`), applied
about the pad shape position.

### Roundrect corner radius ratio

The corner radius is **`min(w,h) * ratio`**, where the ratio is read from the
file's `(roundrect_rratio R)` token, default **0.25** (IPC-7351C).

`pcbnew/padstack.cpp:956`:

```cpp
int PADSTACK::RoundRectRadius( PCB_LAYER_ID aLayer ) const
{
    const VECTOR2I& size = Size( aLayer );
    return KiROUND( std::min( size.x, size.y ) * RoundRectRadiusRatio( aLayer ) );
}
```

Default ratio `pad.cpp:94` (`SetRoundRectRadiusRatio( 0.25, F_Cu )`), parsed
per-pad at `...parser.cpp:6890` / `:7414` (`T_roundrect_rratio`), clamped to
`[0, 0.5]`. **The ratio is NOT a constant 0.25 - it is a per-pad value from the
file.**

---

## 4. Drill

Parsed in the `(drill ...)` handler, `...parser.cpp:6572`:

```cpp
case T_oval: pad->SetDrillShape( PAD_DRILL_SHAPE::OBLONG ); break;
case T_NUMBER:
    if( !haveWidth ) { drillSize.x = parseBoardUnits(); drillSize.y = drillSize.x; ... }
    else            { drillSize.y = parseBoardUnits(); }
case T_offset:
    pt.x = parseBoardUnits( "drill offset x" );
    pt.y = parseBoardUnits( "drill offset y" );
    pad->SetLibOffset( PADSTACK::ALL_LAYERS, pt );
```

- **Round drill** `(drill D)`: a single number; `drillSize.x = drillSize.y = D`.
  A circular hole of diameter D.
- **Slot drill** `(drill oval X Y)`: token `oval` sets `OBLONG` drill shape, then
  the two numbers are width X and height Y. The hole is a stadium/slot of X by Y.
  The slot's long axis follows the pad geometry.
- **Drill offset** `(drill ... (offset dx dy))`: shifts the **hole** relative to
  the pad copper centre (`SetLibOffset`). The copper shape stays at the pad
  position; the hole (and `ShapePos`) move by the rotated offset. `ShapePos`
  rotates the offset by `GetOrientation()` (`pad.cpp:1831-1841`). If offset is
  `(0,0)` the hole is concentric with the pad.

For SMD/CONN pads the drill is forced to `(0,0)` regardless
(`...parser.cpp:6620-6623`), so they never have a hole.

The effective hole geometry used for rendering is a `SHAPE_SEGMENT`
(`getPadHoleShape` -> `GetEffectiveHoleShape`): if the segment endpoints are
equal it is a circle of `width/2` radius; otherwise a slot.

---

## 5. Holes vs copper (critical)

**Holes are rendered as their own GAL layer, drawn over the copper.** They are
NOT subtracted from each individual pad polygon; instead a single hole disc/slot
is painted in the hole colour on top, so it visually punches through every
overlapping copper pad at that spot.

`PAD::ViewGetLayers` (`pcbnew/pad.cpp:2631`) assigns hole layers separately from
copper layers:

```cpp
if( m_attribute == PAD_ATTRIB::PTH )
{
    layers.push_back( LAYER_PAD_PLATEDHOLES );
    layers.push_back( LAYER_PAD_HOLEWALLS );
}
if( m_attribute == PAD_ATTRIB::NPTH )
    layers.push_back( LAYER_NON_PLATEDHOLES );
```

The hole layer is drawn as a filled disc/segment in the hole colour
(`pcb_painter.cpp:1730`):

```cpp
if( aLayer == LAYER_PAD_PLATEDHOLES || aLayer == LAYER_NON_PLATEDHOLES )
{
    SHAPE_SEGMENT slot = getPadHoleShape( aPad );
    if( slot.GetSeg().A == slot.GetSeg().B )      // circular
        m_gal->DrawCircle( center, slot.GetWidth() / 2.0 );
    else
        m_gal->DrawSegment( slot.GetSeg().A, slot.GetSeg().B, slot.GetWidth() );
}
```

And the global layer order (`pcbnew/pcb_draw_panel_gal.cpp:62`,
`GAL_LAYER_ORDER`) places the hole layers
(`LAYER_PAD_PLATEDHOLES, LAYER_PAD_HOLEWALLS, LAYER_NON_PLATEDHOLES`, line 111)
**after / above the copper pad layers** in the draw stack.

So for the plated-mounting-hole case (a drilled `thru_hole` pad stacked with
larger hole-less `connect` pads): every pad there draws its copper, and then the
single drill hole is painted over **all** of that copper. **Our renderer's
"holes punched in a final pass after all copper" model is correct.** Confirmed:
holes are effectively drawn after/over copper, cutting through every overlapping
pad.

---

## 6. Pad layers

Parsed at `...parser.cpp:6708` (`(layers ...)` -> `LSET`), with the magic mask
`"*.Cu"` etc. expanded; `"F&B.Cu"` maps to `{F_Cu, B_Cu}` (`...parser.cpp:120`).

- `*.Cu` -> all copper layers (through-hole annular ring on every layer).
- `F.Cu` -> front copper only.
- `B.Cu` -> back copper only.
- `*.Mask` -> all solder-mask layers (F.Mask and B.Mask); `F.Mask` / `B.Mask`
  for a single side.

**Through-hole vs single-side is determined by the copper layer count**, not the
attribute alone. `PAD::ViewGetLayers` (`pad.cpp:2650`):

```cpp
LSET cuLayers = ( m_padStack.LayerSet() & LSET::AllCuMask() );
...
if( cuLayers.count() > 1 )       // multi-layer (through-hole) pad
{
    for( PCB_LAYER_ID layer : cuLayers.Seq() ) { ...copper on each... }
}
else if( IsOnLayer( F_Cu ) )     // front only
    ...
else if( IsOnLayer( B_Cu ) )     // back only
    ...
```

So a pad with `>1` copper layer (typically `*.Cu`) is treated as through-hole
copper; a pad with exactly one copper layer is single-sided (front if F_Cu, back
if B_Cu). NPTH pads may have no copper layer at all (bare hole) - see
`IsOnCopperLayer` (`pad.cpp:1863`), which returns false for an NPTH whose pad
size does not exceed the drill (no annular ring).

---

## Divergences from our renderer

Listed worst-first. Each gives the wrong assumption, the correct KiCad rule, and
the fix.

### D1. Pad rotation sign is likely inverted (matrix is the wrong handedness)

- **Our assumption**: local point rotated by `rot` via
  `[dx*cosθ - dy*sinθ, dx*sinθ + dy*cosθ]` in Y-down screen space, "top side
  known-good".
- **KiCad rule** (`trigo.cpp:249`): `x' = x*cos + y*sin`,
  `y' = -x*sin + y*cos`. That is the **transpose** of our matrix: KiCad negates
  the `sin` terms relative to the textbook CCW matrix we use. With KiCad's Y-down
  axis this yields CCW-on-screen for positive angles.
- **Impact / fix**: our matrix applies the opposite rotation direction to KiCad
  for any non-axis-aligned, non-180 pad/footprint angle. If "top side is
  known-good" today, that strongly implies our `rot` is being fed negated
  somewhere (or only square angles have been tested, which hide the sign).
  Action: render a board with a pad at e.g. 30 and 45 degrees and a rotated
  footprint, and compare against KiCad. Align to KiCad's convention - simplest is
  to use `x' = x*cosθ + y*sinθ`, `y' = -x*sinθ + y*cosθ` (equivalently feed
  `-rot` into our current matrix). Get this right before trusting the flip math,
  since the back-side path composes with it.

### D2. Roundrect corner radius hardcoded to 0.25 - must read `roundrect_rratio`

- **Our assumption**: corner radius = `0.25 * min(w,h)` for roundrect.
- **KiCad rule** (`padstack.cpp:956`, parser `:6890`/`:7414`): radius =
  `min(w,h) * ratio`, where `ratio` is the per-pad `(roundrect_rratio R)` value
  (default 0.25, clamped 0..0.5). Many pads use 0.1, 0.15, etc.
- **Fix**: parse `roundrect_rratio` from each pad and use it; fall back to 0.25
  only when the token is absent. Our `oval` radius (`0.5 * min`) is correct.

### D3. Pad copper-layer set is not always pre-stored as B.* on the back

- **Our assumption**: "pad copper layers are already stored as B.* in the file"
  for back-side footprints.
- **KiCad rule**: pad copper layers in the file are stored relative to the
  footprint's own (un-flipped) frame. A back-side through-hole pad is usually
  `*.Cu` (all layers) - it is not stored as `B.Cu`. The F<->B swap is applied by
  the flip transform (`PAD::Flip` `pad.cpp:1796-1804`), not pre-baked. Only when
  a footprint is actually flipped in-editor and re-saved do single-side pads end
  up labelled on the opposite side; the geometry is still library-frame relative.
- **Impact**: for the common mounting-hole / through-hole case the pad layer is
  `*.Cu`, so "B.Cu only -> blue" mis-colours through-hole pads on back
  footprints. Treat copper-layer count, not just literal `B.Cu`, as the
  through-hole signal (see D6). For single-side SMD pads on a back footprint the
  file may legitimately carry `B.Cu`; do not assume it always does.

### D4. Back-side X mirror axis - confirm it is the footprint origin, not pad

- **Our assumption**: mirror by negating rotated board-space X about a vertical
  axis through the **footprint origin**, and negate pad rotation.
- **KiCad rule**: correct in spirit. `PAD::Flip` mirrors `m_libPos` about the
  footprint library origin (`pad.cpp:1743-1744`) and negates relative
  orientation (`:1760`); `FOOTPRINT::Flip` negates footprint orientation
  (`footprint.cpp:3019`). The exact composed transform is in Q1.
- **Fix / watch-out**: mirror the **library-frame** X about the footprint origin
  *before* applying rotation, OR negate board-space X about the footprint origin
  *and* flip the rotation sign - these are equivalent only if D1 is fixed.
  Verify against a back-side footprint that is also rotated (e.g. B.Cu at 90
  degrees) - that case exposes any axis/sign mistake.

### D5. NPTH / no-copper pads as bare holes - mostly right, refine the test

- **Our assumption**: `np_thru_hole` and pads with no copper layer are drawn as a
  bare hole (no copper fill).
- **KiCad rule**: NPTH pads route only to `LAYER_NON_PLATEDHOLES`
  (`pad.cpp:2643`) and `IsOnCopperLayer` (`pad.cpp:1863`) returns false when the
  copper size does not exceed the drill (no annular ring). But an NPTH *can*
  still have an annular copper ring if its pad size exceeds the drill - then it
  does draw copper. So "NPTH = always bare hole" is slightly too strong.
- **Fix**: draw NPTH copper only when pad copper size > drill size (annular ring
  present); otherwise bare hole. For the common mounting hole (size <= drill)
  bare-hole is correct.

### D6. Pad colour heuristic - drive it off copper-layer count

- **Our assumption**: both F.Cu and B.Cu or `*.Cu` -> gold (through-hole);
  B.Cu only -> blue; else red.
- **KiCad rule**: the through-hole vs single-side decision is "more than one
  copper layer" (`pad.cpp:2656`, `cuLayers.count() > 1`), and the attribute
  (PTH/NPTH) is what actually creates a hole, not the colour. KiCad does not
  colour pads by side; it colours by F/B copper layer and hole layers. Our gold
  for `count>1` copper matches the through-hole intent. The risk is purely D3:
  back-side through-hole pads are `*.Cu` (count>1) and must stay gold, not be
  forced blue by a literal-`B.Cu` check.
- **Fix**: gold when `(copperLayers & allCu).count() > 1` OR attribute is
  PTH/NPTH-with-ring; blue when exactly one copper layer and it is B.Cu; red/front
  when exactly F.Cu. Keep the hole render independent of the copper colour.

### Confirmed correct (no change needed)

- Footprint `(at x y rot)` rotate-then-translate model, Y-down - correct apart
  from the rotation sign in D1.
- Internal model: file in mm, angles in degrees, Y down.
- Holes punched in a final pass after all copper so a hole cuts through every
  overlapping pad - **correct** (Q5; separate hole layer drawn above copper).
- Round `(drill D)` vs slot `(drill oval x y)` - correct.
- `oval` pad corner radius `0.5 * min(w,h)` - correct.
