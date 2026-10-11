# FORM art style

The reference for every illustration in `src/components/art`. Follow the values below; they are
enforced by tests where marked (T).

## 1. Purpose and non-goals

Purpose: one consistent, warm, hand-made look across Pip, scenes, meals, exercise figures, rank
emblems, the body map and state art, crisp from 38px thumbnails to hero size, in light and dark.

Non-goals:
- No new features, data or domain changes. Art restyles existing screens only.
- No photos, no copied ideas from other apps, no realistic faces. Meals are illustrations of a
  kind of meal, never the user's food.
- No new dependencies. Everything is `react-native-svg` plus `Animated`.
- Keep the Evening palette, Nunito, and Pip: a round peach with a leaf sprout.

## 2. Light and shadow

- Light comes from the **top-left**, always. Gradients use `LIGHT_DIR` (`x1 .15, y1 0, x2 .85, y2 1`):
  lit at the top-left, shaded at the bottom-right.
- **Cast shadow:** one ellipse on the floor under the object, `art.shadow` at `art.shadowOpacity`
  (light `#7A4A26` at 0.14, dark `#000000` at 0.35). Never grey, never a blur.
- **Highlight:** one soft shape on the lit upper-left, `art.highlight` at `art.highlightOpacity`
  (0.28 light, 0.20 dark; allowed range 0.2 to 0.35) (T).
- **Rim light:** a thin `art.rim` edge at `art.rimOpacity` on the shaded lower-right edge. It stays
  subtle in light mode and carries the shape against espresso in dark mode.
- Things stand on a floor line of `art.floorLine` (tokens `borderStrong`) over a `art.surface`
  (tokens `cardRaised`) ground when they need one.

## 3. Shading recipe

Every solid object is built from the same four layers, in this order:

1. Cast shadow ellipse (section 2).
2. Body: one fill with a **two-stop** linear gradient along `LIGHT_DIR` (top colour to bottom colour,
   e.g. `art.peach.top` to `art.peach.bottom`). Flat fills for objects under 12 units.
3. One highlight on the body (section 2).
4. Outline and features: the 2-unit `art.ink` outline (where the family has one), then eyes, mouth
   and details in `art.featureInk`, then the rim light.

Metals use `METALS[name]`: gradient `hi` to `mid` to `lo` along `LIGHT_DIR`, `rim` as the edge stroke.
Do not add a fourth stop or a second highlight; if it needs more, it needs a bigger budget, not
more layers.

## 4. Outlines and strokes

Stroke widths come from `STROKE` and nothing else (T):

| Name | Width | Use |
|---|---|---|
| `hair` | 1 | veins, seeds, fine detail, rim lines |
| `line` | 2 | the standard outline (Pip, figures), mouths, floor lines |
| `bold` | 3 | eyes-closed arcs, stems, small limbs, equipment bars |
| `heavy` | 6 | Pip's arms, thick handles |

Rules:
- Use `strokeLinecap="round"` and `strokeLinejoin="round"` for every stroke.
- Outlines are `art.ink`; features on a light body are `art.featureInk`.
- Meals and scenes have no outline; they separate by shading only.
- Do not put a `scale` transform on a group that contains strokes (the width would leave the table);
  draw the shape at its size, or size the host `View` and let the viewBox scale everything evenly.

## 5. ViewBoxes

Use the `VIEWBOX` table. A viewBox never changes after a family ships; size the host `View`, not
the viewBox.

| Family | viewBox | Notes |
|---|---|---|
| Pip (`pip`) | 120 x 120 | Pip centred, feet at y 106 |
| Meal (`meal`) | 120 x 90 | `View` width is `size * 120 / 90` |
| Exercise figure (`figure`) | 200 x 140 | floor at y 130, faces right |
| Rank emblem (`emblem`) | 100 x 108 | shield tip at y 104 |
| State art (`state`) | 120 x 120 | prop with Pip placed over it |
| Body map | 220 x 205 | unchanged, local to BodyMap |
| Scenes | per scene | each keeps its current viewBox and `preserveAspectRatio` |

Always render `<Svg width="100%" height="100%" viewBox=...>` inside a sized `View`.

## 6. Colour sources

An art file contains **no hex and no `rgba(`** (T, `src/test-utils/artRules.test.ts`). Colours come
from, in this order of preference:

1. **Tokens** (`colors`, `palettes[tone]` from `src/theme/tokens.ts`) for anything the UI already
   names: primary, accent, text, card, border.
2. **`artPalettes[tone]` / `art`** (`src/theme/artPalette.ts`): ink, shadow, highlight, rim, surface,
   `peach`, `leaf`, `figure`, `scene`, `state`, `locked`.
3. **`METALS`**: `oak bronze silver steel gold platinum sapphire chrome iron rubber wood brass`, each
   `{ hi, mid, lo, rim }`. Rank metals are the first seven; equipment uses the rest (`iron` is the old
   equipment colour and edge). `METAL_SYMBOL` and `METAL_TEXT` hold rank symbol ink, laurels and rank
   text colours.
4. **`FOODS`**: natural food colours, identical in both tones (food does not recolour at night).
5. **`ACCENTS[tone]`**: sparkles, sleepy Zs, trophy, kettlebell, figure edge and body-map colours.

If a colour has no home, add it to `artPalette.ts` with a descriptive key, in both tones, in the same
change. `tokens.ts` never imports `artPalette.ts`.

Ids for gradients come from `useArtId('prefix')`, never a hard-coded id or a raw `useId()` (colons
break `url(#...)`).

## 7. Light and dark

- Every art component takes an optional `tone?: ArtTone` and reads `artPalettes[tone ?? scheme]`.
  `art` is the launch scheme's palette. The gallery uses `tone` to show both at once.
- Dark colours come from `palettes.dark` where a token exists; the rest are warm evening colours
  that sit on espresso surfaces (`#17110E` to `#30251F`). Outlines go darker (`#2A1A12`), shadows
  go to black at 0.35, the rim light is the strongest dark-mode cue.
- **Night scenes are redrawn, not recoloured.** A dark scene replaces the sun with a moon and
  craters, clouds with stars, and uses the dark `hill*` colours; it is a different composition on
  the same viewBox and budget, not the day scene with a filter.
- Do not branch on `scheme` at module level (`const night = scheme === 'dark'`). Branch on `tone`
  inside the component so both tones can render together.

## 8. Budgets

Budgets count SVG elements with `countSvg()` (`src/test-utils/svgNodes.ts`): every drawn element
and gradient, not the svg root, `Defs` or react-native-svg's wrapper group. A `<Text>` counts as 2.

| Art | Limit |
|---|---|
| Pip | 60 per mood |
| Scene | 60 |
| Meal | 60, or 30 below 48px |
| Exercise figure | 50, or 25 as a thumb; placeholder thumb 12 |
| RankEmblem | 40 |
| BodyMap | 200 |
| MuscleThumb | 40, one muscle group only |
| StateArt prop | 40, plus Buddy |

Each component test asserts its own budget (T). No `Filter`, `Mask` or `ClipPath` anywhere in art
(T, `countSvg().forbidden` must be empty): draw the shape instead of clipping to it.

## 9. Performance and motion

- Decorative loops run only through `useActiveLoop(enabled?)` (`src/lib/useActiveLoop.ts`): it is true
  only when enabled, reduced motion is off, and the app is in the foreground.
  `useEffect(() => { if (!run) return; const loop = Animated.loop(...); loop.start(); return () => loop.stop(); }, [run])`
- Use the native driver (`transform`, `opacity`) for loops.
- Budget per screen: **at most 3 loops** and **at most 1 animation driven by `setState`** (Pip's blink).
- **Exception to the `setState` budget:** a one-shot `CountUp` (at most 600 ms, once per value change,
  one per screen) is allowed alongside one floating Pip's blink. It is not a loop. Nothing else
  animates through `setState`.
- Pip moves only when `float` is set: a bob with a breath (`scaleY`) on the same native value, and a
  blink about every 4 s that stays closed for 120 ms. The blink only runs for open eyes (the sleepy and
  rest moods have closed eyes and schedule no timer), the eyes always reopen when the loop stops, and
  the bob returns to its neutral pose when the loop stops.
- Memoise static layers (floor, gear behind a figure, ghost pose) as separate `memo` components so a
  frame update redraws only the moving figure.
- ExerciseArt keeps its own tested frame loop and AppState handling; it is not migrated to
  `useActiveLoop`.
- Gradients and ids are created once per instance; never create elements in a loop above the budget.

## 10. Accessibility

- **Decorative art** (almost all of it) is hidden: `accessible={false}`,
  `importantForAccessibility="no-hide-descendants"` and `aria-hidden`. This covers Pip, scenes, meals,
  state art and thumbnails next to a text label.
- **Meaningful art** keeps a label: an exercise illustration is `"${name} illustration"`, an unknown
  exercise's placeholder is `"${name ?? 'Exercise'} illustration coming soon"`, a rank emblem names its
  rank, the FORM mark says "FORM".
- Art never carries information by colour alone; pair it with text.
- State colours (`art.state.*`) have at least 3:1 contrast on the card in both tones (T).
- Motion respects reduced motion through `useActiveLoop`; with reduced motion on, art is static.
- Text drawn in SVG (BodyMap labels) is at least 12px.
- `test/afterEach.ts` audits every rendered tree; art must not break it.

## 11. Gallery and test checklist

The gallery is `src/app/art-gallery.tsx`: a section registry, with `?section=`,
`?tone=light|dark|both` and `?page=1..4`. Every new or changed piece appears there in both tones, at
the smallest size it is used at (38px emblem, 48px meal, thumb figure) and at hero size.

Before handing art over:

- [ ] No hex or `rgba(`, and the file is removed from the `ALLOWLIST` in `artRules.test.ts`.
- [ ] Colours come from tokens, `art`, `METALS`, `FOODS` or `ACCENTS`; new colours exist in both tones.
- [ ] Strokes are 1, 2, 3 or 6 only.
- [ ] Element count is within the budget table, asserted in the component test.
- [ ] `countSvg().forbidden` is empty.
- [ ] Ids come from `useArtId`.
- [ ] Takes an optional `tone`; renders correctly in light and dark (checked in the gallery).
- [ ] Decorative art is hidden from accessibility; meaningful art has its label.
- [ ] Loops go through `useActiveLoop`; reduced motion shows a still frame.
- [ ] Existing exports and props are unchanged; new props are optional.
- [ ] `npx jest --runInBand src/components/art src/theme src/test-utils`, `npx tsc --noEmit` and
      `npx eslint src` pass.
