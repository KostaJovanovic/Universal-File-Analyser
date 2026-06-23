# KiCad schematic + symbol geometry - authoritative rules

Audited against the KiCad C++ source mirror under
`research/kicad-source-mirror-master`. All file paths below are relative to that
root. This documents the rules our JS schematic renderer must follow for
`.kicad_sch` files and `.kicad_sym` symbol libraries.

The single most important class is `TRANSFORM` (a 2x2 integer matrix
`{x1, y1, x2, y2}`). Its `TransformCoordinate` is the canonical mapping from a
symbol-local point to sheet coordinates.

```
libs/kimath/src/transform.cpp:40
VECTOR2I TRANSFORM::TransformCoordinate( const VECTOR2I& aPoint ) const
{
    return VECTOR2I( ( x1 * aPoint.x ) + ( y1 * aPoint.y ),
                     ( x2 * aPoint.x ) + ( y2 * aPoint.y ) );
}
```

So the matrix is row-major `[[x1, y1], [x2, y2]]` and
`out = ( x1*px + y1*py , x2*px + y2*py )`. The default (identity) is
`{x1:1, y1:0, x2:0, y2:1}` (`libs/kimath/include/transform.h:52`).

---

## 1. Symbol library coordinate convention (Y-UP library, Y-DOWN sheet)

Confirmed: library symbol body geometry is stored **Y-up** (mathematical), while
the schematic sheet and KiCad internal coordinates are **Y-down** (screen). The
flip happens at the S-expression boundary.

The reader negates Y for every symbol-body item via `parseXY( true )`:

```
eeschema/sch_io/kicad_sexpr/sch_io_kicad_sexpr_parser.h:197
VECTOR2I parseXY( bool aInvertY = false )
{
    VECTOR2I xy;
    xy.x = parseInternalUnits( "X coordinate" );
    xy.y = aInvertY ? -parseInternalUnits( "Y coordinate" )
                    :  parseInternalUnits( "Y coordinate" );
    return xy;
}
```

`parseXY( true )` (invert Y) is used for pins, graphic shapes, fields and text
**inside the symbol body**:
- pin `at`: `sch_io_kicad_sexpr_parser.cpp:1735` - `pin->SetPosition( parseXY( true ) )`
- field: `:1149`, polyline/arc points: `:1308`, `:1313`, `:1319`, `:1334`,
  bezier: `:1506`-`:1509`, circle centre: `:1574`.

The writer mirrors this, emitting `-y` back out for library items:
- `sch_io_kicad_sexpr_lib_cache.cpp:707` `-aField->GetPosition().y`
- `:734` `-aPin->GetPosition().y`
- `:786` `-aText->GetPosition().y`
- `:807` `-pos.y`

By contrast, **sheet-level** items use plain `parseXY()` (no invert) - they are
already in Y-down sheet space (see section 4). The placed symbol's own `(at ...)`
also uses non-inverted `parseXY()` (`:3273`).

Net rule for our renderer: when reading a `.kicad_sym` library, **negate Y** of
every body coordinate to bring it into internal/sheet (Y-down) space before
applying the placement transform. When reading a `.kicad_sch`, sheet coordinates
are already Y-down - do **not** negate.

---

## 2. Placed symbol transform (exact order and signs)

A placed `(symbol (at x y angle) (mirror x|y) ...)`. The parser builds the
transform in two steps, in this order:

### Step A - rotation from the `(at ... angle)` token

```
eeschema/sch_io/kicad_sexpr/sch_io_kicad_sexpr_parser.cpp:3272
case T_at:
    symbol->SetPosition( parseXY() );
    switch( static_cast<int>( parseDouble( "symbol orientation" ) ) )
    {
    case 0:    transform = TRANSFORM();                 break;   // {1,0,0,1}
    case 90:   transform = TRANSFORM( 0, 1, -1, 0 );    break;
    case 180:  transform = TRANSFORM( -1, 0, 0, -1 );   break;
    case 270:  transform = TRANSFORM( 0, -1, 1, 0 );    break;
    }
    symbol->SetTransform( transform );
```

### Step B - mirror from the `(mirror x|y)` token (post-multiplied)

```
eeschema/sch_io/kicad_sexpr/sch_io_kicad_sexpr_parser.cpp:3288
case T_mirror:
    token = NextTok();
    if( token == T_x )      symbol->SetOrientation( SYM_MIRROR_X );
    else if( token == T_y ) symbol->SetOrientation( SYM_MIRROR_Y );
```

The mirror matrices (incremental `temp`):

```
eeschema/sch_symbol.cpp:2705
case SYM_MIRROR_Y:  temp = { x1:-1, y1:0, x2:0, y2: 1 };  // negates X
case SYM_MIRROR_X:  temp = { x1: 1, y1:0, x2:0, y2:-1 };  // negates Y
```

The combine (how `temp` folds into the existing matrix):

```
eeschema/sch_symbol.cpp:2819
TRANSFORM newTransform;
newTransform.x1 = m_transform.x1 * temp.x1 + m_transform.x2 * temp.y1;
newTransform.y1 = m_transform.y1 * temp.x1 + m_transform.y2 * temp.y1;
newTransform.x2 = m_transform.x1 * temp.x2 + m_transform.x2 * temp.y2;
newTransform.y2 = m_transform.y1 * temp.x2 + m_transform.y2 * temp.y2;
m_transform = newTransform;
```

This is the matrix product `M_new = M_rotation * M_mirror` (rotation on the left,
mirror on the right). Applied to a point:

```
out = M_new * p = M_rotation * ( M_mirror * p )
```

So, executing on a **symbol-local point in internal Y-down space**, the order is:

1. **Mirror first** (in the symbol's own frame): `(mirror x)` negates **Y**;
   `(mirror y)` negates **X**. (These are the internal Y-down signs above.)
2. **Then rotate** by the `angle` matrix from step A.
3. **Then translate** by the instance position `m_pos` (the `(at x y)`).

### Rotation direction / sign

The `angle` matrices act on internal Y-down coordinates. `angle = 90` is
`{0,1,-1,0}`, i.e. `out = ( py, -px )`. A local +X unit `(1,0)` maps to `(0,-1)`,
which is **up on screen** in Y-down space. The S-expression `angle` is therefore
applied as a standard rotation **of the matrix as written** - do not negate it.
Mapping a local point to the sheet is:

```
sheet = M( angle ) * ( M( mirror ) * local_internal ) + m_pos
```

where `local_internal` is the library point already flipped to Y-down (section 1).

This is exactly `SCH_PIN::GetPosition()`:

```
eeschema/sch_pin.cpp:345
VECTOR2I SCH_PIN::GetPosition() const
{
    if( const SCH_SYMBOL* symbol = ... )
        return symbol->GetTransform().TransformCoordinate( m_position )
               + symbol->GetPosition();
    ...
}
```

and `GetPinPhysicalPosition` / general point mapping:

```
eeschema/sch_symbol.cpp:3249
VECTOR2I SCH_SYMBOL::GetPinPhysicalPosition( const SCH_PIN* aPin ) const
{
    ...
    return m_transform.TransformCoordinate( aPin->GetPosition() ) + m_pos;
}
```

Inverse mapping (sheet -> local) confirms the same composition:
`eeschema/sch_symbol.cpp:3545` -
`m_transform.InverseTransform().TransformCoordinate( aPosition - m_pos )`.

Note: the matrix already folds rotation and mirror together, so there is no
separate "Y-up to Y-down" flip baked into `m_transform`. The flip is done once at
parse time (section 1), and `m_position` is stored in internal Y-down space.

---

## 3. Pins (position, orientation, length, endpoint)

A pin's **connection point** (the outer tip that touches wires) is its stored
`m_position`, mapped through the symbol transform (`GetPosition()`, section 2).

Pin orientation enum from the `(at x y angle)` orientation field, library space:

```
eeschema/sch_io/kicad_sexpr/sch_io_kicad_sexpr_parser.cpp:1737
case 0:   PIN_RIGHT   // pin body extends to the right (+X) from its root
case 90:  PIN_UP
case 180: PIN_LEFT
case 270: PIN_DOWN
```

`length` is parsed at `:1749` (`case T_length`), default inherited from lib pin
(`eeschema/sch_pin.cpp:388 GetLength()`).

The pin's **root** (the inner end where the body line meets the symbol outline)
is computed in **library space** as origin plus length along the orientation
direction. Crucially these signs are in internal Y-down space (so `PIN_UP`
subtracts from Y):

```
eeschema/sch_pin.cpp:800
VECTOR2I SCH_PIN::GetPinRoot() const
{
    if( const SCH_SYMBOL* symbol = ... )    // placed: transform the lib root
    {
        const TRANSFORM& t = symbol->GetTransform();
        return t.TransformCoordinate( m_libPin->GetPinRoot() )
               + symbol->GetPosition();
    }
    switch( GetOrientation() )              // library space
    {
    case PIN_RIGHT: return m_position + VECTOR2I(  GetLength(), 0 );
    case PIN_LEFT:  return m_position + VECTOR2I( -GetLength(), 0 );
    case PIN_UP:    return m_position + VECTOR2I( 0, -GetLength() );
    case PIN_DOWN:  return m_position + VECTOR2I( 0,  GetLength() );
    }
}
```

So the correct pipeline for the pin line segment is:

1. In library space (already flipped to internal Y-down), the pin runs from
   `m_position` (connection tip) to `root = m_position + dir*length`, where
   `dir` is `+X / -X / -Y / +Y` for `R / L / U / D`.
2. Transform **both endpoints** through the placed symbol transform
   `t.TransformCoordinate(...) + symbol.pos` (section 2). The endpoint is **not**
   recomputed from the rotated orientation - both the tip and the root are mapped
   by the same matrix, which automatically rotates/mirrors the pin direction.

A subtle but important consequence: KiCad does **not** re-derive the pin's screen
direction from `angle`/`mirror` separately - it transforms the two library
endpoints. Our renderer must do the same so mirrored pins keep correct length and
side.

---

## 4. Other sheet items (no library flip - plain Y-down)

All of these use `parseXY()` **without** Y inversion, so their coordinates are
read verbatim as Y-down sheet coordinates. No symbol transform applies.

- **Wires / buses**: `(wire (pts (xy ..) (xy ..)))` -> `parseSchPolyLine()`,
  points via `parseXY()` (`sch_io_kicad_sexpr_parser.cpp:4322`); layer chosen by
  token (`T_wire` -> `LAYER_WIRE`, `:4377`). Bus entries: `:4244`.
- **Junctions**: `parseJunction()` -> `junction->SetPosition( parseXY() )`
  (`:4140`).
- **No-connect**: `parseNoConnect()` -> `SetPosition( parseXY() )` (`:4201`).
- **Labels / global_label / hierarchical_label**: `parseSchText()`
  (`:4923`, dispatch `:4932`-`:4933`), position `text->SetPosition( parseXY() )`
  (`:4962`). The label's `(at x y angle)` angle is the text rotation, not a matrix
  transform.
- **Sheet pins**: `sheetPin->SetPosition( parseXY() )` (`:2554`); sheet position
  `:3832`; bitmap `:3738`.
- **Text boxes / tables**: `parseSchTextBox()` (`:5094`).

Rule: render sheet items directly in the file's coordinates (Y-down). Only symbol
**body** geometry needs the Y flip + placement transform.

---

## 5. Units

- **Length / position**: millimetres in the file, scaled to internal units by
  `schIUScale.IU_PER_MM`:

  ```
  eeschema/sch_io/kicad_sexpr/sch_io_kicad_sexpr_parser.cpp:697
  auto retval = parseDouble() * schIUScale.IU_PER_MM;
  ```

  (`parseInternalUnits`, used by `parseXY`, multiplies the mm value by
  `IU_PER_MM`.) For our renderer we can treat the raw numbers as **millimetres**.
- **Angles**: degrees. Symbol orientation is restricted to `0 / 90 / 180 / 270`
  (`:3275`-`:3282`); pin orientation likewise `0/90/180/270` (`:1737`). Text/label
  `angle` is a free degree value but typically 0/90/180/270.

---

## Divergences from our renderer

Our renderer's stated assumptions, checked against the source:

> Library graphics are Y-up; a symbol-local point `(lx,ly)` maps to sheet via:
> `x=lx, y=-ly`; then if `mirror=='x'` do `y=-y`; if `mirror=='y'` do `x=-x`;
> then rotate by `-angle` using `[dx*cosθ - dy*sinθ, dx*sinθ + dy*cosθ]` (CCW).
> Translate by the instance position. Order applied: mirror first, then rotate.

### Correct vs wrong, item by item

1. **Library Y-up -> `y=-ly`: CORRECT.** Confirmed by `parseXY(true)` negating Y
   for all symbol-body items (`parser.h:202`) and the writer emitting `-y`
   (`lib_cache.cpp:707/734/786/807`). Keep this flip.

2. **Mirror signs `mirror x -> y=-y`, `mirror y -> x=-x`: CORRECT, but only
   because they are applied in internal Y-down space.** KiCad's `SYM_MIRROR_X`
   matrix `{1,0,0,-1}` negates Y; `SYM_MIRROR_Y` `{-1,0,0,1}` negates X
   (`sch_symbol.cpp:2705`-`2719`). **Watch the ordering relative to the Y-flip:**
   KiCad does the library Y-flip **once at parse** and then applies mirror in
   Y-down space. Our renderer flips Y first (`y=-ly`) and then mirrors in that
   same flipped (Y-down) space, so the signs line up. This is fine **as long as
   the mirror is applied to the already-Y-flipped point**, which our pipeline
   does.

3. **Rotation direction / `-angle` and the rotation matrix: WRONG (sign).**
   KiCad does **not** negate the angle. The rotation matrices act directly on
   Y-down coordinates: `angle=90` is `{x1:0,y1:1,x2:-1,y2:0}`, i.e.
   `out=(py, -px)` (`parser.cpp:3278`). Our matrix
   `[dx*cosθ - dy*sinθ, dx*sinθ + dy*cosθ]` is the standard CCW matrix
   `out=(px*cosθ - py*sinθ, px*sinθ + py*cosθ)`. At `θ=90` that gives
   `out=(-py, px)` - the **opposite** of KiCad's `(py, -px)`. To match KiCad,
   use **CW** in our coordinates: `out=(px*cosθ + py*sinθ, -px*sinθ + py*cosθ)`,
   equivalently rotate by `+angle` with KiCad's matrix
   `[[cos, sin], [-sin, cos]]`, **not** `-angle` with the CCW matrix.
   *Fix:* replace the rotation with KiCad's exact matrices per angle:
   `0:(1,0,0,1)`, `90:(0,1,-1,0)`, `180:(-1,0,0,-1)`, `270:(0,-1,1,0)`, applied
   as `out=(x1*px + y1*py, x2*px + y2*py)`. (Since KiCad only allows
   0/90/180/270, hardcoding the four matrices is safest and avoids any CW/CCW
   ambiguity.)

4. **Order "mirror first, then rotate": CORRECT.** The combine `M = R * Mirror`
   (`sch_symbol.cpp:2819`-`2825`) means, on a point, `R*(Mirror*p)` - mirror is
   applied to the local point first, then rotation, then translation
   (`TransformCoordinate(p) + m_pos`). Keep this order. **But** note the mirror in
   KiCad is applied in the symbol's own (pre-rotation) frame; because our order is
   the same (mirror in local space, then rotate), this matches - provided the
   rotation sign in point 3 is fixed.

5. **Pin endpoint "extends by length along its own rotation, then transformed":
   PARTIALLY WRONG / fragile.** KiCad computes the pin **root** in library space
   as `m_position + dir*length` with library-space directions
   (`R:+X, L:-X, U:-Y, D:+Y` in Y-down, `sch_pin.cpp:815`-`818`) and then
   transforms **both** the tip (`m_position`) and the root through the **same**
   symbol matrix (`sch_pin.cpp:809`). It does **not** re-orient the pin from the
   placed/rotated angle. *Fix:* compute the two library-space endpoints first
   (after the Y-flip), then push both through the identical placement transform
   from point 3. Do not separately rotate the pin's own orientation - let the
   matrix carry it. Also note the library-space sign for `U` is **-Y** and `D` is
   **+Y** (internal Y-down after the flip); if our renderer keeps pins in pre-flip
   Y-up space it must use `U:+Y, D:-Y` there instead - be consistent about which
   space the length is added in.

### Summary of required fixes

- Keep the library Y-flip (`y=-ly`) and the mirror signs (mirror x -> negate Y,
  mirror y -> negate X) and the mirror-before-rotate order.
- **Change the rotation:** stop negating the angle and stop using the CCW matrix.
  Use KiCad's four fixed matrices (`90:(0,1,-1,0)` etc.) applied as
  `(x1*px+y1*py, x2*px+y2*py)`. Our current CCW/`-angle` is the wrong handedness
  and will flip 90/270 placements.
- **Pin geometry:** build both pin endpoints in library space, then run both
  through the one placement transform, rather than re-deriving direction from the
  placed angle.
- Units are millimetres; angles are degrees restricted to 0/90/180/270 for
  symbols and pins.
