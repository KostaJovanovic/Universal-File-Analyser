# KiCad board-level geometry - authoritative rules for our PCB renderer

Source audited: `kicad-source-mirror-master` (KiCad master). All paths below are
relative to that tree. This documents what the authoritative C++ does so our JS
`.kicad_pcb` renderer can follow it.

---

## 1. Units and coordinate system

**Internal units (IU) are nanometres.** PCB IU is defined as 1e6 IU per mm, i.e.
1 IU = 1 nm:

> `constexpr double PCB_IU_PER_MM = 1e6;  ///< Pcbnew IU is 1 nanometer.`
> -- `include/eda_units.h:68`
> `constexpr EDA_IU_SCALE pcbIUScale = EDA_IU_SCALE( PCB_IU_PER_MM );`
> -- `include/eda_units.h:121`

**The file unit is millimetres.** Every coordinate token in a `.kicad_pcb` is a
double in mm; the parser multiplies by `IU_PER_MM` to get internal nm and rounds
to an integer:

> `// the values in the file are in mm and get converted to nano-meters.`
> `auto retval = parseDouble() * pcbIUScale.IU_PER_MM;`
> ... `return KiROUND( std::clamp( retval, -INT_LIMIT, INT_LIMIT ) );`
> -- `pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr_parser.cpp:198-211`

So a renderer reading the file directly works in mm (no scaling needed beyond
its own view transform).

**Y-axis direction: Y increases downward** (screen / image convention), not
mathematical up. KiCad's internal board space is a Y-down plane: the file stores
coordinates the same way they are drawn, with no per-item Y flip. A renderer that
draws board coordinates directly into a canvas (which is also Y-down) gets the
correct orientation without flipping.

**Angles: degrees in the file**, parsed as `EDA_ANGLE( parseDouble(), DEGREES_T )`
everywhere (e.g. footprint orientation, arc angle, text angle):

> `footprint->SetOrientation( EDA_ANGLE( parseDouble(), DEGREES_T ) );`
> -- `pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr_parser.cpp:5518`
> `shape->SetArcAngleAndEnd( EDA_ANGLE( parseDouble( "arc angle" ), DEGREES_T ), true );`
> -- same file, line 3595

Because Y is inverted relative to mathematical space, a positive EDA_ANGLE that is
counter-clockwise in math space appears clockwise on screen. For board tracks and
vias this rarely matters because track `arc` geometry is stored as three explicit
points (see section 3), not as a signed sweep angle, so a renderer does not need
to resolve the angle-sign convention to draw tracks/arcs.

---

## 2. Layer set

Canonical layer name strings and the enum they map to are in
`common/lset.cpp` (`NameToLayer`, lines 113-162; `Name`, lines 184-240) and the
`PCB_LAYER_ID` enum in `include/layer_ids.h:55-168`.

Name -> id map (file string on the left):

> ```
> { "F.Cu", F_Cu }, { "B.Cu", B_Cu },
> { "F.Adhes", F_Adhes }, { "B.Adhes", B_Adhes },
> { "F.Paste", F_Paste }, { "B.Paste", B_Paste },
> { "F.SilkS", F_SilkS }, { "B.SilkS", B_SilkS },
> { "F.Mask", F_Mask }, { "B.Mask", B_Mask },
> { "Dwgs.User", Dwgs_User }, { "Cmts.User", Cmts_User },
> { "Eco1.User", Eco1_User }, { "Eco2.User", Eco2_User },
> { "Edge.Cuts", Edge_Cuts }, { "Margin", Margin },
> { "F.CrtYd", F_CrtYd }, { "B.CrtYd", B_CrtYd },
> { "F.Fab", F_Fab }, { "B.Fab", B_Fab },
> ```
> -- `common/lset.cpp:116-135`

Inner copper and user layers are matched by prefix, not by table:

> `if( aName.StartsWith( "In" ) ) { ... str_num.RemoveLast( 3 ); // Removes .Cu`
> `... return static_cast<int>( In1_Cu ) + ( offset - 1 ) * 2; }`
> -- `common/lset.cpp:151-159`
> `if( aName.StartsWith( "User." ) ) { ... return User_1 + (offset-1)*2; }`
> -- `common/lset.cpp:143-149`

So `In1.Cu` .. `In30.Cu` are inner copper, `User.1` .. `User.45` are extra user
layers.

**Copper classification is by parity of the enum id: even = copper.** The enum is
laid out so all copper layers get even ids and everything else odd:

> `F_Cu = 0, B_Cu = 2, In1_Cu = 4, In2_Cu = 6, ... In30_Cu = 62,`
> `F_Mask = 1, B_Mask = 3, F_SilkS = 5, ... Edge_Cuts = 25, Margin = 27, ...`
> -- `include/layer_ids.h:60-115`
> `inline bool IsCopperLayer( int aLayerId ) { return !( aLayerId & 1 ) && ...; }`
> -- `include/layer_ids.h:675-678`
> `inline bool IsExternalCopperLayer( int aLayerId ) { return aLayerId == F_Cu || aLayerId == B_Cu; }`
> -- `include/layer_ids.h:686-688`
> `inline bool IsInnerCopperLayer(...) { return IsCopperLayer(...) && !IsExternalCopperLayer(...); }`
> -- `include/layer_ids.h:697-700`

For a renderer parsing names, the practical rule: `F.Cu`, `B.Cu`, `In<n>.Cu` are
the copper layers; everything else (`*.Mask`, `*.SilkS`, `*.Paste`, `*.Adhes`,
`*.CrtYd`, `*.Fab`, `Edge.Cuts`, `Margin`, `Dwgs.User`, `Cmts.User`, `Eco*.User`,
`User.*`) is non-copper / technical / user.

**Side classification.** Front/back is by explicit layer list, not by a `F.`/`B.`
string prefix:

> `inline bool IsFrontLayer( PCB_LAYER_ID ) { case F_Cu: case F_Adhes: case F_Paste:`
> `case F_SilkS: case F_Mask: case F_CrtYd: case F_Fab: return true; ... }`
> -- `include/layer_ids.h:778-795`
> `inline bool IsBackLayer( PCB_LAYER_ID ) { case B_Cu: case B_Adhes: case B_Paste:`
> `case B_SilkS: case B_Mask: case B_CrtYd: case B_Fab: return true; ... }`
> -- `include/layer_ids.h:801-816`

Note: inner copper (`In*.Cu`), `Edge.Cuts`, `Margin`, and all `*.User` / `Eco*`
layers are **neither** front nor back - they are not in either switch and return
false from both. The `F.`/`B.` string-prefix heuristic happens to agree for the
front/back technical layers but does NOT classify inner copper, Edge.Cuts, or
user layers as a side.

---

## 3. Tracks

Two record types, both copper-only (parser rejects non-copper tracks/arcs):

> `if( !IsCopperLayer( track->GetLayer() ) ) { ... return nullptr; }`
> -- `pcb_io_kicad_sexpr_parser.cpp:8060-8064` (same guard for arc at 7965-7969)

**`(segment ...)` -> straight track:** fields `start`, `end`, `width`, `layer`,
`net`:

> `case T_start: ... track->SetStart( pt );`
> `case T_end: ... track->SetEnd( pt );`
> `case T_width: track->SetWidth( parseBoardUnits( "width" ) );`
> `case T_layer: track->SetLayer( parseBoardItemLayer() );`
> `case T_net: parseNet( track.get() );`
> -- `pcb_io_kicad_sexpr_parser.cpp:8001-8036`

Geometrically a segment is a line of the given width drawn with round caps (KiCad
tracks are rendered as thick rounded-end segments).

**`(arc ...)` -> curved track, defined by THREE points** start / mid / end (the
mid point is a point the arc passes through, not a centre/angle):

> `case T_start: ... arc->SetStart( pt );`
> `case T_mid: ... arc->SetMid( pt );`
> `case T_end: ... arc->SetEnd( pt );`
> `case T_width: arc->SetWidth( ... );  case T_layer: arc->SetLayer( ... );`
> -- `pcb_io_kicad_sexpr_parser.cpp:7899-7928`

The same start/mid/end triple is what KiCad exports over its API:

> `arc.mutable_start()...; arc.mutable_mid()...; arc.mutable_end()...; arc.mutable_width()...`
> -- `pcbnew/pcb_track.cpp:444-450`

So to draw a track arc: compute the circle through (start, mid, end), then sweep
from start to end passing through mid, stroked at `width` with round caps. The
mid point disambiguates direction and major/minor arc, so no angle-sign decision
is needed.

---

## 4. Vias

`(via ...)` parsing - `pcb_io_kicad_sexpr_parser.cpp:8070-8175`:

**Type** is an optional leading keyword; absent = through. The parser only sets
BLIND / BURIED / MICROVIA when the token is present:

> `case T_blind: via->SetViaType( VIATYPE::BLIND );`
> `case T_buried: via->SetViaType( VIATYPE::BURIED );`
> `case T_micro: via->SetViaType( VIATYPE::MICROVIA );`
> -- `pcb_io_kicad_sexpr_parser.cpp:8109-8119`

A via with no type keyword is `VIATYPE::THROUGH` (the PCB_VIA default; through
vias span the whole stack and are the common case).

**Position** is a single `(at x y)` (start == end, vias are points):

> `case T_at: ... via->SetStart( pt ); via->SetEnd( pt );`
> -- `pcb_io_kicad_sexpr_parser.cpp:8121-8127`

**`(size)` is the pad diameter, `(drill)` is the hole diameter:**

> `case T_size: via->SetWidth( PADSTACK::ALL_LAYERS, parseBoardUnits( "via width" ) );`
> `case T_drill: via->SetDrill( parseBoardUnits( "drill diameter" ) );`
> -- `pcb_io_kicad_sexpr_parser.cpp:8129-8137`
> `@param aDrill is the new drill diameter` -- `pcbnew/pcb_track.h:661`

A via pad shape is a circle and `SetWidth` sets both x and y of the pad size, so
size is a diameter:

> `m_padStack.SetShape( PAD_SHAPE::CIRCLE, PADSTACK::ALL_LAYERS );` -- `pcbnew/pcb_track.cpp:119`
> `void PCB_VIA::SetWidth( int aWidth ) { m_padStack.SetSize( { aWidth, aWidth }, PADSTACK::ALL_LAYERS ); }`
> -- `pcbnew/pcb_track.cpp:374-377`

**Layer span** comes from `(layers <top> <bottom>)`:

> `case T_layers: ... layer1 = lookUpLayer(...); layer2 = lookUpLayer(...);`
> `via->SetLayerPair( layer1, layer2 );`
> -- `pcb_io_kicad_sexpr_parser.cpp:8139-8153`

**Rendering:** outer annular pad = filled circle of radius `size/2`, then the
drill hole = circle of radius `drill/2` (the copper annular ring is the area
between the two). A through via is present on every layer; blind/buried spans only
its `(layers ...)` pair; microvias span one layer step.

---

## 5. Zones (copper pours)

`(zone ...)` parsing - `pcb_io_kicad_sexpr_parser.cpp:8526` onward. The pour outline
the user drew is `(polygon (pts ...))`; the **computed filled copper** is one or
more `(filled_polygon ...)` blocks, keyed per layer.

**`filled_polygon`** optionally carries `(layer <name>)` then `(pts ...)`, and the
parser accumulates all filled polygons for a layer into a `SHAPE_POLY_SET`:

> `case T_filled_polygon: ... if( token == T_layer ) { filledLayer = parseBoardItemLayer(); ... }`
> `else { filledLayer = zone->GetFirstLayer(); }  // legacy single-layer`
> `SHAPE_POLY_SET& poly = pts.at( filledLayer );`
> `int idx = poly.NewOutline(); SHAPE_LINE_CHAIN& chain = poly.Outline( idx );`
> `... parseOutlinePoints( chain ); ... addedFilledPolygons |= !poly.IsEmpty();`
> -- `pcb_io_kicad_sexpr_parser.cpp:9077-9128`

So per layer there is a set of filled outlines; the **first outline of a polyset is
the solid copper and subsequent outlines can be holes** (the same convention the
drawn `polygon` outline uses):

> `// Remark: The first polygon is the main outline. Others are holes inside the main outline.`
> -- `pcb_io_kicad_sexpr_parser.cpp:9071-9072`

The user-drawn boundary (`T_polygon`, lines 9051-9074) is NOT the fill - it is the
zone outline. The actual rendered copper is the `filled_polygon` geometry. A zone
may be multi-layer (`(layers ...)`, line 8584) with a separate filled polygon set
for each copper layer.

**Rendering:** for each `filled_polygon`, draw the polygon as a fill on its
`(layer ...)` (the layer is the copper layer the pour is on); honour inner
outlines as holes (even-odd / non-zero) if the renderer wants accurate cut-outs.

---

## 6. Board outline

The board shape is the set of graphics on **Edge.Cuts**, and the board
size / bounding box is computed from exactly those:

> `const BOX2I GetBoardEdgesBoundingBox() const { return ComputeBoundingBox( true, true ); }`
> -- `pcbnew/board.h:1100-1103`
> `BOX2I BOARD::ComputeBoundingBox( bool aBoardEdgesOnly, ... ) { ... if( aBoardEdgesOnly )`
> `visible.set( Edge_Cuts ); ... if( aBoardEdgesOnly && ( item->GetLayer() != Edge_Cuts`
> `|| item->Type() != PCB_SHAPE_T ) ) continue; ... bbox.Merge( item->GetBoundingBox() ); }`
> -- `pcbnew/board.cpp:2362-2403`

So: iterate `gr_line` / `gr_arc` / `gr_circle` / `gr_rect` / `gr_poly`
(`PCB_SHAPE`) items whose layer is `Edge.Cuts` (plus Edge.Cuts shapes inside
footprints), union their bounding boxes; that box is the board extent. The outline
itself is whatever those Edge.Cuts shapes draw (it does not have to be a single
closed rectangle). Our deriving board size from the Edge.Cuts bounding box matches
KiCad.

---

## Divergences from our renderer

Our current assumptions checked against the above:

- **Units mm / draw board coords directly, Y-down, no flip - CORRECT.** File is mm
  (section 1), internal space is Y-down, so drawing file coordinates straight into
  a Y-down canvas is right. No Y flip needed.
- **`segment` round-capped line; `arc` via 3-point start/mid/end - CORRECT.**
  Matches sections 3. Good that we use the mid point as a pass-through point, not a
  centre.
- **Via gold circle radius size/2 + black hole radius drill/2 - CORRECT geometry**
  (size and drill are both diameters, section 4).
- **Via "present on both sides" - INCOMPLETE / partially WRONG.** Only through vias
  (the default, no type keyword) span the full stack. `blind`, `buried`, and
  `micro` vias span only their `(layers top bottom)` pair (section 4). If we draw
  every via as if it reaches both outer copper layers we will mis-render
  blind/buried/microvias. At minimum: read the `blind`/`buried`/`micro` keyword and
  the `(layers ...)` span; a blind/buried via that does not touch F.Cu or B.Cu
  should not be drawn as a pad on that outer side.
- **Zone: each `filled_polygon` as a translucent fill on its layer - CORRECT, with
  one caveat.** The fill geometry is `filled_polygon`, not the `polygon` outline
  (make sure we read `filled_polygon`, section 5). Caveat: secondary outlines
  within a layer's polyset are holes (the "first outline is main, others are holes"
  rule) - if we fill every outline solid we will paint over intended cut-outs (e.g.
  keep-outs around pads). Also each `filled_polygon` may carry its own `(layer ...)`
  for multi-layer zones; route the fill to that layer, not to the zone's first
  layer.
- **Layer colours (F.Cu red, B.Cu blue, inner gold, Edge.Cuts outline) - fine as a
  display choice** (KiCad's own colours are themeable and not authoritative).
- **Side mapping `B.` => bottom, `F.` => top, `Edge.Cuts` => both, else top -
  PARTIALLY WRONG.** KiCad classifies side by an explicit layer list, and inner
  copper (`In*.Cu`), `Edge.Cuts`, `Margin`, `Dwgs.User`, `Cmts.User`, `Eco*.User`,
  and `User.*` are **neither front nor back** (section 2). Defaulting "everything
  else to top" wrongly assigns inner copper and user/drawing layers to the top
  side. If side matters for our draw order or front/back toggle, inner copper
  should be its own stack position (ordered `F.Cu`, `In1.Cu` .. `InN.Cu`, `B.Cu`),
  and non-copper user/technical layers should not be forced onto a side. The `F.`/
  `B.` prefix test is OK for the silk/mask/paste/courtyard/fab/adhesive technical
  pairs but must not be the catch-all.
- **Copper detection by name - confirm we treat `In<n>.Cu` as copper.** KiCad's
  copper set is `F.Cu`, `B.Cu`, and `In1.Cu..In30.Cu` (even enum ids). If our
  renderer only special-cases `F.Cu`/`B.Cu` and lumps `In*.Cu` into "other/top",
  inner-layer tracks and zones will be mislayered.
- **Board size from Edge.Cuts bounding box - CORRECT** (section 6). One refinement:
  KiCad also includes Edge.Cuts shapes that live inside footprints, not just
  top-level `gr_*` items - include footprint Edge.Cuts graphics if we want an exact
  match, though top-level Edge.Cuts covers the overwhelming majority of boards.
