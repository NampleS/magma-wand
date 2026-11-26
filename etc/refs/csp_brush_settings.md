# CSP "Advanced Tool Settings" (Sub Tool Detail): reference spec and gap analysis

Sources: `etc/refs/1.png … 19.png` (CSP brush settings, sub tool **"Square1"**, one screenshot per category), and `src/wand.js` (Magma Extension advanced brush).
Legend: **[seen]** = read off the screenshots (pixel-sampled where a hex value is given). **[CSP knowledge]** = from general knowledge of Clip Studio Paint, not visible in the screenshots, and may be wrong in details.

> Font note [seen]: the UI font draws `.` with a tail, so it looks like `,`. "16,2" is **16.2**, "0,0" is **0.0**, and the sentence endings are periods.

---

## A. Window anatomy (common to all 19 screenshots)

### A.1 Overall geometry (screenshot ≈ 541×680 px, 1:1 scale)

| Region | Box (x0–x1, y0–y1) | Color | Notes |
|---|---|---|---|
| Window frame | full | `#383838` | 4 px outer frame |
| Title bar | 0–541, 0–17 | `#383838` | Centered title "Advanced Tool Settings" (~11 px, `#dadada`). Close "✕" at the far right (x≈529). No other buttons. |
| Separator lines | 1 px | `#313131` | Between preview, list, panes and button bar |
| **Stroke preview** | 5–536, 20–118 (≈531×99) | left half `#b4b4b4` (x 5–270), right half `#4e4e4e` | One S-curve sample stroke in the current color (pink `#f8e5de`) crosses both halves, so you see it on light and dark backgrounds. Sub tool name "Square1" sits in a small label box at the top-left (text `#dadada` on a dark chip). |
| **Category list** (left) | 5–139 (≈135 px wide), 120–652 | `#3f3f3f` | Text `#dadada` ~12 px. Row pitch **18 px**, first item at y≈122. Selected row: full-width bar `#606a80`, 16 px tall. Sub-items are indented about +8 px (text x≈17 vs 9). No icons. |
| "Show category" checkbox | x≈9, y≈641 | same | Bottom-left of the list |
| **Description banner** (right top) | 141–536, 120–169 (≈50 px) | `#4e4e4e` | 1–2 lines of `#dadada` text at x≈145, y≈137. The text changes per category. |
| **Parameter area** | 141–536, 170–~502 | `#3f3f3f` | Rows (see A.2) |
| **Help pane** | 141–536, ~503–651 | `#4e4e4e` | "i" icon (≈28×28, light-grey rounded square `#dadada` with a dark "i") + bold title, then 1–3 lines of description. Default: "About parameter help / Description of each item is shown if you move cursor over it." Hovering a row shows that row's help. On short pages (Erase) it starts right under the last row (y≈274). |
| Bottom button bar | 140–536, 652–672 | buttons `#676767`, border `#7e7e7e`, text `#dadada` | Left: "⟲ Reset all settings to default" (x 140–319, circular reset icon). Right: "Save all settings as default" (x 324–534). |

### A.2 Parameter row anatomy (left → right)

| Part | x range | Look |
|---|---|---|
| **Eye toggle** ("show in Tool Property palette" [CSP knowledge]) | 143–156 (14×24) | Off: `#585858` fill + `#6f6f6f` 1 px border, radius ≈2. On: fill `#606a80` with a `#b2b2b2` eye glyph. |
| **▶ button** | 160–169 (10×24) | `#585858` fill, `#6f6f6f` border, light-grey `#b2b2b2` right-pointing triangle. Function is not shown in the screenshots; it is present on every row (except page 11's first row). |
| **Tree bracket** | x≈177–179 | 1 px very dark `#222` vertical line with a 2×2 dot at the top and a short horizontal foot. It links a parent row to its dependent child rows, e.g. Brush Size → "Specify by size on screen" / "At least 1 pixel". |
| Label | from x≈186 (children x≈200–219) | `#dadada`. Disabled: `#797979`. ~12 px. |
| **Slider** | 207–460 (≈253 px) × 8 px, below the label | **Filled part** is a raised bar: top 1 px `#6f6f6f`, body 6 px `#585858`, bottom 1 px `#7b7b7b`. **Unfilled part** is just a 1 px groove line `#636363` on the bottom edge (no track fill). There is no thumb/knob. Disabled: a thin outline only. Size slider is non-linear (16.2 fills ≈ 50 %). |
| Numeric value | right-aligned, ends x≈500, y = label line + 6 | `#dadada`, e.g. `100`, `16.2`, `0.0`. **No unit text is shown** (no "px", "%"). |
| Spinner | 503–513 | Thin "⌃/⌄" chevrons stacked, `#b2b2b2` |
| **Dynamics button** | 518–533 (16×22) | `#585858` fill, `#6f6f6f` border. The icon shows the current dynamics: **⊘ (square with slash)** = no dynamics; **pen-on-surface (⤓)** = pen pressure; **squiggle ("ꞁn")** = probably Random [CSP knowledge, unverified]. Disabled: `#444` with a dim icon. Help text [seen, page 1]: "link the brush size to pen dynamics such as pen pressure by selecting the **Dynamics button** to the right". [CSP knowledge] It opens a popup with checkboxes Pen pressure / Tilt / Velocity / Random, a "Minimum value" slider, and a pressure (and velocity) curve graph editor. |
| **Dropdown** | label end → x≈532, 18–20 px tall | Enabled `#585858` (border `#6f6f6f`), disabled `#444444`. Value text centered, chevron "⌄" at the right. |
| **Checkbox** | 13×13 | `#585858` fill, `#6f6f6f` border, `#dadada` check mark. Disabled: a faint box with a `#989898` check. The label sits right of the box (x+18). |
| **Segmented / radio** | ~22 px tall | Base `#585858`. Selected segment `#798db9` (blue-grey) with `#dadada` text. Has an icon plus text (Circle/Material, Horizontal/Vertical, Fixed/Wide/Normal/Narrow). |
| **Icon group + ⌄** | right-aligned, ≈20 px icons | Same colors. Selected icon `#798db9`. Used for color-mixing type, AA level, repeat method, stabilization mode, scaling mode, vector eraser. |
| **5-step selector** | 5 cells ≈46×16 + "›" button | Dark cells with `#585858` outline. The selected cell(s) are filled `#606a80`. "›" at the right, used for Hardness, Particle density, Spray deviation, Post correction, Taper, Vector magnet, Watercolor-edge Opacity and Darkness. [CSP knowledge] Cells are quick presets; "›" opens a precise slider popup. |
| Group separator | x≈152–532, 1 px | `#727272`, between logical groups |
| Row heights | | Slider rows ≈29 px (label line + bar line). Checkbox, dropdown and segmented rows ≈25 px. Child rows ≈20 px. |
| Tip-shape preview strip | full width, ≈80–260 px tall | `#3f3f3f` with a centered small black tip glyph. It sits under the rows on Brush Size, Anti-aliasing, Brush tip and Spraying effect. |

### A.3 Color tokens summary

`--frame #383838` · `--panel #3f3f3f` · `--banner/help #4e4e4e` · `--line #313131` · `--sep #727272` · `--ctl #585858` · `--ctl-border #6f6f6f` · `--ctl-hi #7b7b7b` · `--groove #636363` · `--ctl-disabled #444444` · `--text #dadada` · `--text-dis #797979` · `--sel-list #606a80` · `--sel-seg #798db9` · `--btn #676767` / `--btn-border #7e7e7e` · `--preview-light #b4b4b4` · `--well (material list) #212121`

---

## B. Per-screenshot transcription

Columns: **Eye** = eye toggle on (●) or off (○). **Dyn** = dynamics-button icon (⊘ none, P pressure, R squiggle/probably random, – no button). **St** = enabled (E) or greyed (G). Indentation `↳` = child under a tree bracket.

### 1. Brush Size
Banner: "Settings for tool size (line width)."
| Row | Control | Value | Dyn | Eye | St |
|---|---|---|---|---|---|
| Brush Size | slider + spinner | 16.2 | P | ● | E |
| ↳ Specify by size on screen | checkbox | off | – | ○ | E |
| ↳ At least 1 pixel | checkbox | off | – | ○ | E |
Below: tip preview (small black rounded square). Help: "Brush Size — Set the size of the brush. You can also link the brush size to pen dynamics such as pen pressure by selecting the Dynamics button to the right."

### 2. Ink
Banner: "Settings for how the brush behaves on the layer."
| Row | Control | Value | Dyn | Eye | St |
|---|---|---|---|---|---|
| Opacity | slider | 100 | ⊘ (dim) | ● | E |
| Blending mode | dropdown | Normal | – | ● | G |
| Color mixing | checkbox + 3-icon group + ⌄ | on; 1st icon selected | – | ○ | E |
| Amount of paint | slider | 100 | ⊘ | ● | E |
| Density of paint | slider | 100 | ⊘ | ○ | E |
| Color stretch | slider (short fill) | 10 | – | ○ | E |
| Blending quality | radio: "Normal" / "High quality" | – | – | ○ | G |
| Intensity of blur | radio: "Automatic" / "Fixed value" + slider | – | ⊘ | ○ | G |
| Mixing mode | dropdown | Standard | – | ○ | E |
| ↳ Brightness correction | 5-icon group + ⌄ | – | – | ○ | G |
(separators after Opacity, Blending mode and Intensity of blur). Help: default text.
Color-mixing icons [seen]: 1 = blend-like comb (selected), 2 = gradient comb, 3 = leaf/oval. [CSP knowledge] 1 = "Blend", 2 = "Running color". 3 is unknown (newer mode).

### 3. Color Jitter
Banner: "Adjust settings to vary the drawing color. If using a brush tip image with a fixed color, these settings will not change the brush color."
| Row | Control | Value | Dyn | Eye | St |
|---|---|---|---|---|---|
| Change brush tip color | checkbox (parent) | off | – | ● | E |
| ↳ Hue | slider | (empty) | R | ○ | G |
| ↳ Saturation | slider | (empty) | R | ○ | G |
| ↳ Luminosity | slider | (empty) | R | ○ | G |
| ↳ Blend with sub color | slider | (empty) | ⊘ | ○ | G |
| Randomize per stroke | checkbox (parent) | off | – | ● | E |
| ↳ Hue / Saturation / Luminosity / Blend with sub color | 4 sliders | (empty) | – | ○ | G |
| Change: | dropdown | Main color | – | ○ | G |

### 4. Anti-aliasing
Banner: "Settings for anti-aliasing effect making outline of line and figure smooth."
| Row | Control | Value | St |
|---|---|---|---|
| Anti-aliasing | 4-icon group + ⌄ (None ✣ jagged / Weak / Medium / Strong) | **2nd icon (Weak) selected** | E |
| Speed and Quality | dropdown | High quality (default) | G |
Then the tip preview area.

### 5. Brush shape
Banner: "Select brush shape from preset."
- "Current brush shape" label + **[Add to presets]** button (full width, `#585858`)
- Current-shape preview: dark textured horizontal stroke on `#3f3f3f`
- Rail ▶ button (tall) + scrollable 2-column preset grid (each cell is a stroke sample with the name at the bottom-right): ◇スケッチ, Pen, Pencil, Air brush, Spray, Watercolor, Waved line, Rough edged, Bumpy, Dashed line, Dotted line, Heart, Star, Laced ribbon, … (more below, scroll bar at right)
- **[Apply brush shape]** (greyed) + 2 small icons (wrench/settings, trash)
Help: "Brush shape — Save the current brush shape as a preset. Once saved as a preset, you can use it for other tools."

### 6. Brush shape → Brush tip
Banner: "Settings for brush tip. Set how brush tip shapes change with pen tilt and direction."
| Row | Control | Value | Dyn | Eye | St |
|---|---|---|---|---|---|
| Tip shape | segmented: ● Circle / ⊠ Material | **Material** | – | – | E |
| (material well) | `#212121` list with 1 thumbnail (black rect, ≡ menu) + "add material" and trash icons | 1 tip | – | – | E |
| Hardness | 5-step + › | – | – | ● | G (greyed because tip = Material) |
| Thickness | slider | 100 | ⊘ | ○ | E |
| ↳ Direction | segmented: Horizontal / **Vertical** | Vertical | – | ○ | E |
| Angle | slider | 0.0 | ⊘ | ● | E |
| Flip horizontal | dropdown | None | – | ○ | E |
| Flip vertical | dropdown | None | – | ○ | E |
| Brush density | slider | 100 | P | ● | E |
| ↳ Adjust brush density by gap | checkbox | off | – | ○ | E |
Bottom: tip preview strip. Help: "Tip shape — Set shape of brush tip. You can use brush material registered to material palette by selecting [Material]."

### 7. Brush shape → Spraying effect
Banner: "Settings for spraying the brush tips. Turn on [Spraying effect] to use these settings."
| Row | Control | Value | Dyn | St |
|---|---|---|---|---|
| Spraying effect | checkbox | off | – | E |
| Particle size | slider | (empty) | ⊘ | G |
| ↳ Brush Size | checkbox (link particle size to brush size) | off | – | G |
| Particle density | 5-step + › | – | ⊘ | G |
| Spray deviation | 5-step + › | – | – | G |
| Direction of particle | slider | (empty) | ⊘ | G |
Help: "Spraying effect — When this option is turned on, brush tip shapes will scatter in a spray effect."

### 8. Brush shape → Stroke
Banner: "Settings for the brushstroke, such as the interval between each brush tip."
| Row | Control | Value | Dyn | Eye | St |
|---|---|---|---|---|---|
| Gap | segmented: • Fixed / •• Wide / ›•‹ Normal / ••• **Narrow** | Narrow | – | ○ | E |
| ↳ (gap amount) | slider | empty (not Fixed) | R (dim) | ○ | E |
| Continuous spraying | checkbox | off | – | ○ | E |
| Correct velocity input | checkbox | **on** | – | ○ | E |
| Ribbon | checkbox | off | – | ○ | E |
| Repeat method | 6-icon group + ⌄ (▶▶, ⋈, ▶, ◀▶, ▸, ◆) | 1st (▶▶) selected | – | ○ | E |
| Blend brush tips with Darken | checkbox | on | – | ● | G |

### 9. Brush shape → Texture
Banner: "You can apply image contrast to lines as a texture."
| Row | Control | Value | Dyn | Eye | St |
|---|---|---|---|---|---|
| Texture | material field + trash | 漆喰 (stucco) | – | ○ | E |
| Texture density | slider | 60 | P | ○ | E |
| ↳ Invert texture | checkbox | off | – | ○ | E |
| ↳ Emphasize density | checkbox | off | – | ○ | E |
| ↳ Scale ratio | slider | 44 | – | ○ | E |
| ↳ Rotation angle | slider | 0 | – | ○ | E |
| ↳ Brightness | slider (center-origin) | 0 | – | ○ | E |
| ↳ Contrast | slider (center-origin) | 0 | – | ○ | E |
| Texture mode | dropdown | **Subtract** | – | ● | E |
| ↳ Apply by each plot | checkbox | **on** | – | ○ | E |

### 10. 2 - Brush shape (Dual brush)
Banner: "Settings for combining two brushes for a dual brush."
| Row | Control | Value | St |
|---|---|---|---|
| Dual brush | checkbox (parent) | off | E |
| ↳ Mode | dropdown | Normal | G |
| ↳ Apply RGB value | checkbox | on | G |
| 2-Brush Size | slider (⊘) | empty | G |
| ↳ Link to main brush size | checkbox | off | G |
| 2-Anti-aliasing | 4-icon group + ⌄ | – | G |
| (preset grid) | same 2-column grid as page 5 (◇スケッチ, Pen, Pencil, Air brush, Spray, Watercolor, Waved line, Rough edged, Bumpy, Dashed line) + [Apply brush shape] + 2 icons | – | E |

### 11. 2 - Brush tip
Banner: "(Dual brush) Settings for brush tip. Set how brush tip shapes change with pen tilt and direction."
Everything is greyed: 2-Tip shape (Circle / Material, neither highlighted), empty material well, 2-Hardness (5-step + ›), 2-Thickness (slider ⊘), ↳ 2-Direction (Horizontal / Vertical), 2-Angle (slider ⊘), 2-Flip horizontal (None), 2-Flip vertical (None), 2-Brush density (slider ⊘), ↳ 2-Adjust brush density by gap (checked).

### 12. 2 - Spraying effect
Banner: "(Dual brush) Settings for spraying the brush tips. Turn on [Spraying effect] to use these settings."
All greyed: 2-Spraying effect (checkbox), 2-Particle size (slider ⊘), ↳ 2-Brush Size (checkbox), 2-Particle density (5-step ⊘), 2-Spray deviation (5-step), 2-Direction of particle (slider ⊘).

### 13. 2 - Stroke
Banner: "(Dual brush) Settings for the brushstroke, such as the interval between each brush tip."
All greyed: 2-Gap (Fixed / Wide / Normal / Narrow, none highlighted) + slider ⊘, 2-Continuous spraying, 2-Ribbon, 2-Repeat method (6 icons + ⌄), 2-Blend brush tips with Darken. (There is no "Correct velocity input" for brush 2.)

### 14. 2 - Texture
Banner: "(Dual brush) You can apply image contrast to lines as a texture."
All greyed: 2-Texture (None, trash), 2-Texture density (⊘), ↳ 2-Invert texture, ↳ 2-Emphasize density, 2-Scale ratio, 2-Rotation angle, 2-Brightness, 2-Contrast, 2-Texture mode (**Normal**), ↳ 2-Apply by each plot.

### 15. Watercolor edge
Banner: "Turn on [Watercolor edge] to add an edge to your brush strokes. Combine this with textures for a watercolor effect."
| Row | Control | Value | St |
|---|---|---|---|
| Watercolor edge | checkbox + slider beneath (edge range) | off / empty | E (checkbox), G (slider) |
| Opacity | 5-step + › | – | G |
| Darkness | 5-step + › | – | G |
| Process after brush stroke | checkbox | on | G |
| Blurring width | slider | empty | G |

### 16. Erase
Banner: "Settings for erasing images on drawing part."
| Row | Control | Value | St |
|---|---|---|---|
| Vector eraser | checkbox + 3-icon group + ⌄ | off | G |
| ↳ Refer all layers | checkbox | on | G |
| Erase on all layers | checkbox | off | G |

### 17. Correction
Banner: "Settings for correcting pen input"
| Row | Control | Value | St |
|---|---|---|---|
| Sharp angles | checkbox | off | E |
| Stabilization | slider | 0 | E |
| Adjust by speed | checkbox | off | E |
| ↳ Stabilization mode | 2-icon group + ⌄ | – | G |
| Post correction | checkbox + 5-step + › | off | E (cb) / G |
| ↳ Adjust by speed | checkbox | on | G |
| ↳ Adjust by scale | checkbox | on | G |
| ↳ Bezier curve | checkbox | off | G |
| Taper | 5-step + › (1st cell filled `#606a80`) | step 1 | E |
| Enable snapping | checkbox | **on** | E |
| Vector magnet | checkbox + 5-step + › | off | G |

### 18. Starting and ending
Banner: "Settings for starting and ending effects to brushstrokes."
| Row | Control | Value | St |
|---|---|---|---|
| Starting and ending | dropdown (target) | **Brush density** | E |
| ↳ How to specify | dropdown | **Specify length** | E |
| ↳ Starting | checkbox + slider | off / empty | E |
| ↳ Ending | checkbox + slider | off / empty | E |
| ↳ Starting and ending by speed | checkbox | off | E |
[CSP knowledge] The target dropdown is a multi-select checklist (Brush size, Thickness, Brush density, Opacity, Particle density, Hue…). "How to specify" = Specify length / Specify percentage / Fade.

### 19. Anti-overflow
Banner: 'You can set a line art layer as a "Reference layer," so that your brush strokes do not go outside the lines.'
| Row | Control | Value | St |
|---|---|---|---|
| Do not cross lines of reference layer | checkbox | off | E |
| Fill up to vector path | checkbox | off | G |
| Tolerance | slider | empty | G |
| Area scaling | checkbox + slider | off | G |
| ↳ Scaling mode | 3-icon group + ⌄ | – | G |

---

## C. Parameter comparison (CSP ↔ wand.js)

Our window: `openBrushSettings()` (wand.js ~3568), CSS `.mw-bset*` / `.mw-bs-*` (~11248). It is a 340 px floating panel with wrap-around tab buttons (`크기, 잉크, 수채 경계, 물감, 색 혼합, 끝 모양, 획, 스프레이, 텍스처, 2중 브러시, 색 흔들기, 이름·관리`), native `<input type=range>` + number + unit, and `effRow` toggles (필압 / 속도 / 무작위 + min %). .sut import: `sutBrush()` (~1984). Engine: `advAddPoint` / `advStamp` / `advFlush` + `ADV_FS` / `ADV_SHOW_FS`.

| CSP parameter (category) | Ours: property / UI | Status | CSP behavior (if missing) |
|---|---|---|---|
| Brush Size + dynamics (1) | `b.size`, `b.sizeEff`; 크기 page | ✅ | – |
| Specify by size on screen (1) | – | ❌ | [CSP knowledge] Size is in screen px, so the doc size = size / zoom. |
| At least 1 pixel (1) | `b.minPx` (parsed, used in `advStamp`) | ⚠ no UI | – |
| (pressure sensitivity) | `b.pressGamma` "필압 곡선" | ours only | CSP uses the curve in the dynamics popup plus a global pen-pressure setting |
| Opacity + dynamics (2) | `b.opacity` (stroke cap via `uOp`), `b.opacityEff` | ⚠ | Ours multiplies `opacityEff` into per-stamp flow (`advStamp` L2543), so overlapping light-pressure stamps build past the cap. [CSP knowledge] Opacity (incl. pressure) is a **ceiling** of the stroke; density accumulates up to it. |
| Blending mode (2) | `b.blend` normal / glaze / multiply / erase (seg) | ⚠ partial | CSP: a full dropdown (Normal, Multiply, Screen, Overlay, …, Erase, Behind, Compare…). `compositeRaw` is parsed, but only 2 and 27 are mapped. |
| Color mixing on + type (Blend / Running color / 3rd) (2) | `b.mix.mode` none / blend / paint; 색 혼합 page | ✅ (separate page) | – |
| Amount of paint / Density of paint / Color stretch (2) | `mix.amount`, `mix.density`, `mix.stretch` (+ `amountEff`, `densEff`) | ✅ | – |
| Blending quality, Intensity of blur (2) | – | ❌ (greyed in screenshot) | [CSP knowledge] Quality of the Blend mode sampling |
| Mixing mode "Standard", Brightness correction (2) | `blend:'glaze'` (Kubelka-Munk) is a blend mode, not a mixing mode | ⚠ | [CSP knowledge, uncertain] Newer CSP adds a pigment-like (subtractive) mixing mode |
| Color Jitter: Change brush tip color H/S/L (3) | `b.jitter {h,s,v}`; 색 흔들기 | ✅ (no per-param dynamics) | CSP rows have a dynamics button (default random) |
| Blend with sub color (3) | – | ❌ | Lerp per tip toward the sub color by a random/pressure amount |
| Randomize per stroke H/S/L/sub (3) | `b.strokeJitter` (parsed, used in `advStrokeStart`) | ⚠ no UI | – |
| Change: Main color / Sub color (3) | – | ❌ | Which color the jitter starts from |
| Anti-aliasing None/Weak/Medium/Strong (4) | `b.aa` (0–3 parsed), UI checkbox; shader `uAA` binary | ⚠ | 4 edge-softness levels |
| Speed and Quality (4) | – | ❌ (greyed) | – |
| Brush shape presets / Add / Apply (5) | Preset picker (`ADV_PRESETS`, `CSP_DEFAULTS`, `.mw-pp` dialog) | ✅ different UI | – |
| Tip shape Circle / Material + material list (6) | round = no `tips`; `b.tips[]`; "끝 모양·텍스처 바꾸기…" (`openAdvPngDialog`) | ✅ (different UI) | – |
| Hardness (6) | `b.hardness` slider 0–100 | ✅ (UI differs: CSP = 5-step + ›) | – |
| Thickness + Direction (6) | `b.thickness`, `b.thickEff`, `b.vertical` | ✅ | – |
| Angle + dynamics (6) | `b.rotation`, `b.rotMask` (0x10 pressure, 0x40 direction, 0x80 random), `b.rotRandom` | ✅ (as checkboxes) | CSP: one dynamics popup (pressure / tilt / direction / random) |
| Flip horizontal / vertical (6) | `b.flipH`, `b.flipV` 0/1/2 (engine also sees 3 from .sut) | ✅ | – |
| Brush density + dynamics (6) | `b.flow`, `b.flowEff` (shown on **잉크** page as "흐름(밀도)") | ✅ wrong page | Lives in Brush tip in CSP |
| Adjust brush density by gap (6) | – | ❌ | [CSP knowledge] Scales per-tip density with the gap so that changing the gap keeps the stroke darkness |
| Spraying effect, Particle size (+ link to Brush Size), Particle density, Spray deviation (7) | `b.spray {size,sync,density,bias,sizeEff,densEff}` | ✅ | – |
| Direction of particle (7) | `b.sprayRot` (parsed, used) | ⚠ no UI | – |
| Gap Fixed / Wide / Normal / Narrow + amount (8) | `b.interval`, `b.intervalEff` (fixed % only) | ⚠ | [CSP knowledge] Wide / Normal / Narrow = automatic gap from the size. Fixed = slider. |
| Continuous spraying (8) | – | ❌ | [CSP knowledge] Keeps stamping while the pen is held still (airbrush) |
| Correct velocity input (8) | – (speed EMA in `advAddPoint`) | ❌ | [CSP knowledge] Normalizes velocity dynamics to input-device sampling |
| Ribbon (8) | `b.ribbon` | ✅ | – |
| Repeat method (6 icons) (8) | `b.tipOrder` 0–5 in engine (`pickTip`); UI only exposes 0/1/2 | ⚠ | Repeat, Back-and-forth, Once, Random, per-stroke variants |
| Blend brush tips with Darken (8) | `b.tipMax` (parsed, MAX blending in `advFlush`) | ⚠ no UI | – |
| Texture select (9) | `b.texture.key` (dialog) | ✅ | – |
| Texture density + dynamics (9) | `b.texDensity` ✅. `b.texDensEff` **parsed but never used** | ❌ dynamics | Pressure lowers or raises how much paper grain shows. Many CSP default pencils and charcoals rely on it (see `CSP_DEFAULTS`). |
| Invert texture (9) | `b.texInvert` | ✅ | – |
| Emphasize density (9) | `b.texContrast` slider "농도 강조" | ⚠ semantics differ | [CSP knowledge] A checkbox that switches to a "density emphasised" texture application (stronger contrast at low density) |
| Scale ratio (9) | `b.texScale` | ✅ | – |
| Rotation angle (9) | `b.texRotate` **parsed but never used** | ❌ | Rotates the texture pattern |
| Brightness / Contrast (9) | – (not parsed) | ❌ | Level adjust of the texture before applying (−100…100) |
| Texture mode (9) | `b.texMode` mul / height (ours) | ⚠ | [CSP knowledge] Multiply, Subtract, Compare 1, Compare 2, Normal… (Subtract is common for dry media). The .sut field is not parsed. |
| Apply by each plot (9) | `b.texPerStamp` | ✅ | – |
| Dual brush on / Mode / Apply RGB / 2-size / link / 2-AA (10) | `b.dual {size, sizeEff, flow, hardness, interval, thickness, rotation…}`, `b.dualOff`; 2중 브러시 page (size, interval, flow, spray only) | ⚠ | CSP Mode = blending mode of brush 2 onto brush 1 (Normal, Multiply…). Ours is always "mask multiply". |
| 2-Brush tip / 2-Spraying / 2-Stroke / 2-Texture (11–14) | `dual.hardness`, `thickness`, `rotation`, `rotMask`, `flipH/V`, `spray`, `sprayP` parsed. No 2-texture. | ⚠ no UI for most | – |
| Watercolor edge on + range (15) | `b.wedge {on, radius}` | ✅ | – |
| Opacity / Darkness (15) | `wedge.alpha` / `wedge.value` | ✅ | – |
| Process after brush stroke (15) | – (ours always live) | ❌ | [CSP knowledge] The edge is computed once on pen-up (cheaper, and the look differs while drawing) |
| Blurring width (15) | – | ❌ | Blur of the edge profile |
| Erase: Vector eraser, Refer all layers, Erase on all layers (16) | `b.blend='erase'` only | ❌ (n/a for Magma raster) | – |
| Stabilization (17) | `b.smoothing` (on 획 page) | ✅ (simple EMA, k = s × 0.05) | CSP stabilization is a lagging average (stronger, time-based) |
| Sharp angles, Adjust by speed, Stabilization mode, Post correction, Taper, Enable snapping, Vector magnet (17) | – (ruler snapping exists elsewhere: `symTransforms`) | ❌ | – |
| Starting and ending: target / how to specify / Starting / Ending / by speed (18) | `b.taperIn`, `b.taperOut` (px), `b.inOut {size, flow, opacity, thick}` (parsed targets) | ⚠ | Ours: length only, targets not editable, no percentage, fade or by-speed |
| Anti-overflow (19) | – | ❌ | Clip to reference-layer line art |
| (ours only) 붓털, 두께감, 젖은 물감, 흩어짐, 물감 마름, 섞을 밑색 | `b.bristle`, `b.impasto`, `b.wet`, `b.scatter`, `b.dryOut`, `mix.ref` | extension | Keep them in an extra category at the end of the list |
| Reset all / Save as default (bottom) | – (duplicate button on 이름·관리) | ❌ | Reset to the imported or preset values |
| Stroke preview at top | – (but `smpRender()` ~4000 already renders sample strokes) | ❌ in window | – |
| Hover help pane | `.mw-bs-help` inline paragraphs | ⚠ | – |

---

## D. Top 15 changes (prioritized)

Ordering mixes **UI sameness (U)** and **stroke similarity (R)** by value for effort. All UI strings must use `L('한국어','English')` (project rule 4).

1. **(U) CSP window frame: left category list + description banner + help pane.** Change `openBrushSettings` and the `.mw-bset*` CSS. Replace `.mw-bset-tabs` with a left `<ul>` 135 px wide (18 px rows, selection `#606a80`, sub-items indented 8 px) in CSP order: Brush Size, Ink, Color Jitter, Anti-aliasing, Brush shape › (Brush tip, Spraying effect, Stroke, Texture), 2-Brush shape › (…), Watercolor edge, Correction, Starting and ending, then our extras ("Paint / 물감 효과", "Name & manage"). Grey out or skip Erase and Anti-overflow. Restructure the `pages` object into `{key, label, banner, rows}`. The right column is a 50 px `#4e4e4e` banner, then the `#3f3f3f` rows, then a `#4e4e4e` help pane whose text comes from a `help` string attached to each row (`mouseenter` → set the pane). Size it ≈540×680 (clamped to the viewport), using the A.3 tokens.

2. **(U) CSP slider control.** Replace `slider()` with a div widget. The label sits on its own line above. Below it: a 253 px bar where the filled part is a raised `#585858` block (1 px `#6f6f6f` top, `#7b7b7b` bottom) and the empty part is only a 1 px `#636363` groove. The number is right-aligned with ⌃⌄ spinner buttons and no unit text. Pointer-drag on the bar sets the value, and the wheel or spinner steps it. Add an optional `curve` mapping so Brush Size is non-linear (e.g. `v = min + (max-min)·t^2.2`), which reproduces the 16.2 ≈ 50 % fill.

3. **(U) Dynamics button + popup instead of `effRow`.** Add a 16×22 button at the right of every slider that has an effector (`sizeEff`, `opacityEff`, `flowEff`, `thickEff`, `intervalEff`, `texDensEff`, `mix.amountEff/densEff`, `spray.*Eff`). Its icon is ⊘ when null, a pressure glyph if `.pressure`, and a squiggle if only `.random`. Clicking opens a small popup: checkboxes Pen pressure / Velocity / Random (Tilt greyed), a "Minimum value" slider, and a 120×120 canvas curve editor that edits `eff.pressure.curve` and `eff.velocity.curve` (points already parsed by `parseEffector` and evaluated by `evalCurve`). Click adds a point, drag moves it, and dragging out deletes it. This also lets users fix curves flagged by `advHasBadCurve`.

4. **(R) Implement texture-density dynamics and texture rotation.** Both `texDensEff` and `texRotate` are parsed but unused, and CSP pencils, charcoal and crayon depend on them. In `advStamp`, compute `tden = b.texDensity * effectorValue(b.texDensEff, p, s.speed, rnd())` and pass it per instance. Options: add a 17th float to the instance layout (`INST`, VAO attrib), or reuse `aX.y` (bristle `load`) when bristles are off. In `ADV_FS`, replace `uTexDen` with the varying. For the stroke-level texture path (`ADV_SHOW_FS`, no per-stamp data), keep `uTexDen` × the average or end-of-stroke value. For rotation, add `uTexRot` and rotate `vDoc`/`p` before `/ uTexScale` in both shaders.

5. **(R) Make Opacity a stroke ceiling, CSP-style.** Today `opacityEff` multiplies flow (L2543), so CSP brushes with pressure-opacity come out too dark when stamps overlap. Fix: keep `flow·flowEff` in the color buffer `S`, and render `opacity·opacityEff` per stamp into a second R8/R16F "cap" texture with `gl.blendEquation(gl.MAX)` (shape = tip mask, same instances). In `ADV_SHOW_FS`, take final `alpha = min(S.a, cap)` (or `S.a * cap` if that matches better) and multiply by the global `uOp`. This also improves pressure-opacity markers and watercolors.

6. **(U) Live stroke preview at the top.** Add a 531×99 canvas strip, left half `#b4b4b4` and right half `#4e4e4e`, with the brush name chip at the top-left. Render with the existing `smpRender(brush, res, {W, H, color})` (the same S-curve generator), debounced about 120 ms after any `save()`. It is local only, so there is no Magma traffic.

7. **(R) CSP texture modes + Brightness/Contrast + Emphasize density.** Parse the .sut texture-mode and level fields: find the column names in a real .sut `Variant` table (likely `TextureComposite…`, `TextureBrightness`, `TextureContrast`; names unverified). Implement in `ADV_FS` (per-plot) and `ADV_SHOW_FS` (stroke). Multiply: `m *= mix(1, t, den)` (current). Subtract: `m = clamp(m - (1-t)*den, 0, 1)` (stronger grain at low coverage, the CSP dry-media look). Compare: `m = min(m, mix(1, t, den))`. Brightness/Contrast: `t = clamp((t-0.5)*(1+c)+0.5+b, 0, 1)`. Turn "Emphasize density" into a checkbox (e.g. apply `t = t*t` before the mode) and migrate `texContrast` to Contrast.

8. **(R/U) Four anti-aliasing levels.** `b.aa` already holds 0–3 from .sut, but the shader is binary (`uAA`). Pass `uAA` as a float level and widen the edge falloff. Round tip: `edge = fwidth(r) * [0, 0.7, 1.2, 2.0][aa]`. Bitmap tips: `m = smoothstep(0.5 - w, 0.5 + w, m)` with `w = [0, .12, .25, .5][aa]`, or a 1-texel blur. UI: a 4-icon segmented control (None, Weak, Medium, Strong) in its own "Anti-aliasing" category.

9. **(R/U) Gap modes + "Adjust brush density by gap".** UI: a segmented Fixed / Wide / Normal / Narrow control plus a slider that is enabled only for Fixed. Store `b.gapMode`, and parse the .sut auto-interval field (name unverified). In `advAddPoint`, auto modes set `interval` from the size (e.g. Narrow ≈ 0.05–0.1, Normal ≈ 0.15–0.25, Wide ≈ 0.4; tune against CSP strokes). Density by gap: `flow' = 1 - (1-flow)^(interval/0.1)`, so the darkness stays stable when the gap changes.

10. **(U) Move every existing property to its CSP category and label, with greyed child rows and tree brackets.** Brush density (`flow`) moves to Brush tip. Color mixing moves into Ink. Stabilization (`smoothing`) moves to Correction. Taper moves to Starting and ending. Expose the hidden-but-implemented fields: `minPx` (At least 1 pixel), `tipMax` (Blend brush tips with Darken), `sprayRot` (Direction of particle), `strokeJitter` (Randomize per stroke), `tipOrder` 0–5 (6-icon Repeat method), and the dual brush's tip, spray and stroke fields on the 2-pages. When a parent checkbox is off (Spraying effect, Dual brush, Watercolor edge, Change brush tip color), render the children disabled (`#797979` text, `#444` controls) instead of hiding them, and draw the `#222` bracket line.

11. **(R) Starting and ending: targets, Specify percentage / Fade, by speed.** `b.inOut` already holds the targets (size, flow, opacity, thick). Make the dropdown a checklist that edits it, and add `b.inOutMode` = length, percent or fade. Ending is easy because `advTaperOut` already holds back the last stamps. Percent-of-length ending can only resolve at pen-up, so keep holding all stamps for long strokes, or approximate with `max(taperOut px, pct × current dist)`. Starting by percent: use a running estimate, as CSP does. "By speed": scale the taper length by `s.speed`.

12. **(R) Continuous spraying.** When `b.contSpray` is on and the pointer is down but not moving, keep emitting stamps at `s.last` with an rAF timer in `advFrame` (about 60 stamps/s, scaled by flow). They go only into the local stroke buffer, and the commit is still one paste, so traffic rules are respected. This is essential for CSP airbrush and spray presets.

13. **(R/U) Color Jitter completion.** Add "Blend with sub color": lerp `col` toward the secondary color (read-only from the editor, like `advColor` reads `primaryColor`) by `rnd()·amount` per tip. Add a "Randomize per stroke" UI for `strokeJitter`, and a "Change: Main / Sub color" option for which color the stroke starts from. Give H/S/L a dynamics button (default random) so pressure-driven hue shifts work. Add these in `advStamp` (~L2561) and `advStrokeStart`.

14. **(U) Bottom buttons + CSP control vocabulary.** Add "Reset all settings to default" (restore `b.orig`, a deep copy stored when the brush is imported or created from a preset, in `advSaveBrush` callers) and "Save all settings as default" (overwrite `b.orig`) in a `#676767` button bar. Also add a reusable 5-step + "›" selector for Hardness, Particle density, Spray deviation and Watercolor-edge Opacity/Darkness. Make Flip H/V and Blending mode dropdowns (`#585858`, centered text, ⌄) instead of seg buttons, and use the A.3 tokens for checkboxes and segmented controls (`#798db9`).

15. **(R) Watercolor edge "Process after brush stroke" + "Blurring width", plus size-on-screen.** Add `wedge.after`: skip the edge loop in `ADV_SHOW_FS` while drawing and apply it only in the commit pass (`uMode 1`). This matches the CSP look and saves GPU time. Add `wedge.blur`: average the 12-tap ring at `r` and `r + blur` with weights, or pre-blur the alpha. Also add `b.screenSize` (Brush Size "Specify by size on screen"): in `advStamp`, `size /= s.zoom`.
