import type { ReactElement } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg';
import type { FoodCategory } from '@form/domain';
import { art, artPalettes, FOODS, FOOD_EXTRA, STROKE, type ArtPalette, type ArtTone } from '@/theme/artPalette';

/**
 * Food illustrations: one friendly line-and-fill sketch per food category (apple, carrot, pea pod, wheat, loaf,
 * steak, drumstick, fish, fried egg, cheese, tofu, walnut, oil bottle, chips, cake, cup, burger, bowl, plate).
 * They show a kind of food, never the user's own food, and are chosen from the category alone (`foodCategory`
 * in the domain). Soft outline in the art ink, flat fills from FOODS plus the few food colours listed here
 * (food does not recolour at night; only the outline follows the tone). Budget: 24 SVG elements. Decorative:
 * hidden from screen readers, the food's name carries the meaning.
 */

const X = FOOD_EXTRA;

const c = (key: string): string => FOODS[key]!;

interface P {
  a: ArtPalette;
}

const line = (a: ArtPalette) => ({ stroke: a.ink, strokeWidth: STROKE.line, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const });

function Apple({ a }: P) {
  return (
    <>
      <Path d="M50 30 C40 21 19 27 19 52 C19 74 34 90 44 90 C47 90 48 88 50 88 C52 88 53 90 56 90 C66 90 81 74 81 52 C81 27 60 21 50 30 Z" fill={c('appleLight')} {...line(a)} />
      <Path d="M50 30 C50 22 52 15 57 10" fill="none" stroke={c('appleStem')} strokeWidth={STROKE.bold} strokeLinecap="round" />
      <Path d="M55 21 C60 11 72 10 77 14 C73 25 61 27 55 21 Z" fill={c('leafMid')} {...line(a)} />
      <Path d="M29 48 C29 40 33 35 38 34" fill="none" stroke={X.shine} strokeOpacity={0.6} strokeWidth={STROKE.bold} strokeLinecap="round" />
    </>
  );
}

function Carrot({ a }: P) {
  return (
    <>
      <Path d="M50 30 C42 22 36 12 40 5 C47 9 51 19 50 30 Z" fill={c('leafMid')} {...line(a)} />
      <Path d="M50 30 C50 19 54 9 61 6 C64 14 59 24 50 30 Z" fill={c('leafLight')} {...line(a)} />
      <Path d="M50 30 C58 25 68 23 75 27 C71 35 59 36 50 30 Z" fill={c('leafMid')} {...line(a)} />
      <Path d="M31 33 C31 26 69 26 69 33 C69 52 57 78 50 94 C43 78 31 52 31 33 Z" fill={X.carrot} {...line(a)} />
      <Path d="M36 42 L45 44 M55 52 L64 50 M41 62 L48 64" fill="none" stroke={X.carrotDark} strokeWidth={STROKE.line} strokeLinecap="round" />
    </>
  );
}

function PeaPod({ a }: P) {
  return (
    <>
      <Path d="M90 40 C95 34 97 29 97 22" fill="none" stroke={c('leafMid')} strokeWidth={STROKE.bold} strokeLinecap="round" />
      <Path d="M8 62 C16 28 68 24 90 40 C80 72 34 86 8 62 Z" fill={X.pod} {...line(a)} />
      <Path d="M17 61 C26 40 64 38 82 45 C71 65 40 73 17 61 Z" fill={c('leafPale')} />
      <Circle cx={30} cy={58} r={8} fill={c('leafLight')} {...line(a)} />
      <Circle cx={48} cy={56} r={8.5} fill={c('leafLight')} {...line(a)} />
      <Circle cx={66} cy={52} r={8} fill={c('leafLight')} {...line(a)} />
      <Circle cx={28} cy={55} r={2} fill={X.shine} opacity={0.6} />
      <Circle cx={46} cy={53} r={2} fill={X.shine} opacity={0.6} />
    </>
  );
}

/** A wheat ear: a stem with grains on both sides and one on top. */
function Wheat({ a }: P) {
  const grains: [number, number, number][] = [
    [38, 66, -28],
    [62, 66, 28],
    [38, 48, -28],
    [62, 48, 28],
    [39, 30, -28],
    [61, 30, 28],
  ];
  return (
    <>
      <Path d="M50 96 L50 40" fill="none" stroke={c('appleStem')} strokeWidth={STROKE.bold} strokeLinecap="round" />
      {grains.map(([x, y, r]) => (
        <Ellipse key={`${x}${y}`} cx={x} cy={y} rx={7} ry={12} rotation={r} origin={`${x}, ${y}`} fill={X.wheat} {...line(a)} />
      ))}
      <Ellipse cx={50} cy={20} rx={7} ry={12} fill={X.wheat} {...line(a)} />
    </>
  );
}

function Loaf({ a }: P) {
  return (
    <>
      <Path d="M13 54 C8 30 28 18 50 18 C72 18 92 30 87 54 L85 80 C85 85 81 87 77 87 L23 87 C19 87 15 85 15 80 Z" fill={X.loaf} {...line(a)} />
      <Path d="M24 76 L24 86 M76 76 L76 86" fill="none" stroke={X.loafDark} strokeWidth={STROKE.hair} />
      <Path d="M31 33 L40 50 M45 29 L54 46 M59 31 L68 48" fill="none" stroke={X.loafDark} strokeWidth={STROKE.bold} strokeLinecap="round" />
      <Path d="M24 40 C26 32 32 27 40 25" fill="none" stroke={X.shine} strokeOpacity={0.45} strokeWidth={STROKE.bold} strokeLinecap="round" />
    </>
  );
}

function Steak({ a }: P) {
  return (
    <>
      <Path d="M15 50 C13 30 33 17 56 19 C79 21 91 38 85 58 C81 77 58 85 38 81 C24 79 17 66 15 50 Z" fill={X.steak} {...line(a)} />
      <Path d="M56 19 C79 21 91 38 85 58" fill="none" stroke={X.fat} strokeWidth={STROKE.heavy} strokeLinecap="round" />
      <Circle cx={39} cy={52} r={10} fill={X.bone} {...line(a)} />
      <Circle cx={39} cy={52} r={4} fill={X.steakDark} />
      <Path d="M55 40 C62 38 68 42 72 48 M52 66 C60 68 68 64 72 60" fill="none" stroke={X.steakDark} strokeWidth={STROKE.line} strokeLinecap="round" />
    </>
  );
}

function Drumstick({ a }: P) {
  return (
    <>
      <Path d="M44 54 L22 78" fill="none" stroke={a.ink} strokeWidth={13} strokeLinecap="round" />
      <Path d="M44 54 L22 78" fill="none" stroke={X.bone} strokeWidth={8} strokeLinecap="round" />
      <Circle cx={15} cy={80} r={7} fill={X.bone} {...line(a)} />
      <Circle cx={24} cy={88} r={7} fill={X.bone} {...line(a)} />
      <Ellipse cx={60} cy={38} rx={28} ry={23} rotation={-25} origin="60, 38" fill={X.roast} {...line(a)} />
      <Path d="M44 30 C50 22 60 19 68 21" fill="none" stroke={X.shine} strokeOpacity={0.45} strokeWidth={STROKE.bold} strokeLinecap="round" />
      <Path d="M62 46 C68 44 74 40 76 34" fill="none" stroke={X.roastDark} strokeWidth={STROKE.line} strokeLinecap="round" />
    </>
  );
}

function Fish({ a }: P) {
  return (
    <>
      <Path d="M70 50 L93 31 C95 43 95 57 93 69 Z" fill={X.fishDark} {...line(a)} />
      <Path d="M40 31 C46 18 58 19 62 32 Z" fill={X.fishDark} {...line(a)} />
      <Ellipse cx={46} cy={50} rx={33} ry={21} fill={X.fish} {...line(a)} />
      <Path d="M20 56 C32 66 56 68 70 58 C60 70 34 72 20 56 Z" fill={X.fishBelly} />
      <Path d="M36 36 C31 45 31 55 36 64" fill="none" stroke={a.ink} strokeWidth={STROKE.line} strokeLinecap="round" />
      <Circle cx={26} cy={45} r={3.5} fill={a.ink} />
      <Path d="M50 42 q4 -3 8 0 M58 52 q4 -3 8 0 M46 54 q4 -3 8 0" fill="none" stroke={X.fishDark} strokeWidth={STROKE.line} strokeLinecap="round" />
    </>
  );
}

function FriedEgg({ a }: P) {
  return (
    <>
      <Path d="M18 52 C14 31 33 15 54 19 C75 22 90 31 85 52 C83 70 70 86 50 83 C33 81 22 73 18 52 Z" fill={X.eggWhite} {...line(a)} />
      <Circle cx={52} cy={50} r={16} fill={X.yolk} {...line(a)} />
      <Circle cx={46} cy={44} r={4} fill={X.shine} opacity={0.6} />
    </>
  );
}

function Cheese({ a }: P) {
  return (
    <>
      <Path d="M10 50 L10 82 L90 82 L90 50 Z" fill={X.cheese} {...line(a)} />
      <Path d="M10 50 L62 22 L90 50 Z" fill={X.cheeseTop} {...line(a)} />
      <Circle cx={27} cy={67} r={5.5} fill={X.cheeseHole} />
      <Circle cx={57} cy={65} r={4} fill={X.cheeseHole} />
      <Circle cx={76} cy={72} r={3.5} fill={X.cheeseHole} />
      <Circle cx={56} cy={40} r={3} fill={X.cheeseHole} />
    </>
  );
}

/** An isometric cube: top, left and right faces. */
function Cube({ a, x, y, s }: P & { x: number; y: number; s: number }) {
  const w = 26 * s;
  const h = 12 * s;
  const d = 30 * s;
  return (
    <>
      <Path d={`M${x} ${y} L${x + w} ${y - h} L${x + 2 * w} ${y} L${x + w} ${y + h} Z`} fill={X.tofu} {...line(a)} />
      <Path d={`M${x} ${y} L${x + w} ${y + h} L${x + w} ${y + h + d} L${x} ${y + d} Z`} fill={X.tofuLeft} {...line(a)} />
      <Path d={`M${x + w} ${y + h} L${x + 2 * w} ${y} L${x + 2 * w} ${y + d} L${x + w} ${y + h + d} Z`} fill={X.tofuRight} {...line(a)} />
    </>
  );
}

function Tofu({ a }: P) {
  return (
    <>
      <Cube a={a} x={14} y={46} s={1.1} />
      <Cube a={a} x={52} y={64} s={0.65} />
      <Path d="M80 38 C80 28 88 22 96 24 C96 32 90 38 80 38 Z" fill={c('leafMid')} {...line(a)} />
    </>
  );
}

function Walnut({ a }: P) {
  return (
    <>
      <Circle cx={50} cy={55} r={32} fill={X.nutShell} {...line(a)} />
      <Path d="M50 24 C43 40 57 62 50 86" fill="none" stroke={X.nutLine} strokeWidth={STROKE.bold} strokeLinecap="round" />
      <Path d="M30 40 C36 44 38 50 36 58 M70 40 C64 44 62 50 64 58 M34 70 C40 72 43 76 44 80 M66 70 C60 72 57 76 56 80" fill="none" stroke={X.nutLine} strokeWidth={STROKE.line} strokeLinecap="round" />
      <Path d="M30 36 C33 31 38 27 44 26" fill="none" stroke={X.shine} strokeOpacity={0.5} strokeWidth={STROKE.bold} strokeLinecap="round" />
      <Path d="M70 20 C70 12 78 8 86 10 C86 18 80 22 70 20 Z" fill={c('leafMid')} {...line(a)} />
    </>
  );
}

function OilBottle({ a }: P) {
  return (
    <>
      <Path d="M36 42 L36 86 C36 91 40 93 44 93 L56 93 C60 93 64 91 64 86 L64 42 C64 35 58 32 58 26 L58 15 L42 15 L42 26 C42 32 36 35 36 42 Z" fill={X.oil} {...line(a)} />
      <Rect x={40} y={6} width={20} height={10} rx={3} fill={X.oilCap} {...line(a)} />
      <Rect x={38} y={56} width={24} height={22} rx={3} fill={X.label} stroke={a.ink} strokeWidth={STROKE.hair} />
      <Path d="M50 60 C54 66 56 69 56 72 C56 75 53 77 50 77 C47 77 44 75 44 72 C44 69 46 66 50 60 Z" fill={c('leafMid')} />
      <Path d="M41 44 L41 84" fill="none" stroke={X.shine} strokeOpacity={0.5} strokeWidth={STROKE.bold} strokeLinecap="round" />
    </>
  );
}

function ChipsBag({ a }: P) {
  return (
    <>
      <Path d="M24 12 L76 12 L83 90 L17 90 Z" fill={X.bag} {...line(a)} />
      <Path d="M24 12 L29 20 L34 12 L39 20 L44 12 L49 20 L54 12 L59 20 L64 12 L69 20 L76 12" fill="none" stroke={a.ink} strokeWidth={STROKE.line} strokeLinejoin="round" />
      <Ellipse cx={50} cy={54} rx={20} ry={17} fill={X.label} {...line(a)} />
      <Ellipse cx={50} cy={54} rx={11} ry={7} rotation={-25} origin="50, 54" fill={X.chip} {...line(a)} />
      <Path d="M24 80 L76 80" fill="none" stroke={X.bagDark} strokeWidth={STROKE.line} strokeLinecap="round" />
    </>
  );
}

function CakeSlice({ a }: P) {
  return (
    <>
      <Rect x={14} y={50} width={72} height={38} rx={5} fill={X.sponge} {...line(a)} />
      <Rect x={14} y={66} width={72} height={6} fill={X.eggWhite} stroke={a.ink} strokeWidth={STROKE.hair} />
      <Path d="M12 52 C12 41 20 37 30 40 C36 32 64 32 70 40 C80 37 88 41 88 52 C88 58 82 60 76 56 C70 62 58 60 50 56 C42 62 30 62 24 56 C18 60 12 58 12 52 Z" fill={X.frosting} {...line(a)} />
      <Circle cx={50} cy={29} r={8} fill={X.cherry} {...line(a)} />
      <Path d="M50 21 C50 15 54 11 59 10" fill="none" stroke={c('appleStem')} strokeWidth={STROKE.line} strokeLinecap="round" />
    </>
  );
}

function DrinkCup({ a }: P) {
  return (
    <>
      <Path d="M54 30 L62 8 L80 8" fill="none" stroke={X.straw} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M24 30 L76 30 L69 90 L31 90 Z" fill={X.cup} {...line(a)} />
      <Path d="M28 48 L72 48 L69 90 L31 90 Z" fill={X.drink} />
      <Rect x={20} y={24} width={60} height={9} rx={4} fill={X.cup} {...line(a)} />
      <Rect x={36} y={55} width={13} height={13} rx={3} fill={X.ice} />
      <Rect x={52} y={64} width={12} height={12} rx={3} fill={X.ice} />
      <Path d="M29 38 L33 82" fill="none" stroke={X.shine} strokeOpacity={0.6} strokeWidth={STROKE.bold} strokeLinecap="round" />
    </>
  );
}

function Burger({ a }: P) {
  return (
    <>
      <Path d="M14 46 C14 20 86 20 86 46 Z" fill={X.bun} {...line(a)} />
      <Ellipse cx={34} cy={34} rx={3.5} ry={2} rotation={-20} origin="34, 34" fill={X.label} />
      <Ellipse cx={50} cy={29} rx={3.5} ry={2} fill={X.label} />
      <Ellipse cx={66} cy={34} rx={3.5} ry={2} rotation={20} origin="66, 34" fill={X.label} />
      <Path d="M12 50 C16 44 22 56 28 50 C34 44 40 56 46 50 C52 44 58 56 64 50 C70 44 76 56 82 50 L88 50 C88 56 12 56 12 50 Z" fill={c('leafLight')} {...line(a)} />
      <Path d="M14 56 L86 56 L50 74 Z" fill={X.cheeseSlice} {...line(a)} />
      <Rect x={12} y={58} width={76} height={11} rx={5.5} fill={X.patty} {...line(a)} />
      <Path d="M14 72 L86 72 C86 84 80 88 72 88 L28 88 C20 88 14 84 14 72 Z" fill={X.bun} {...line(a)} />
    </>
  );
}

function Bowl({ a }: P) {
  return (
    <>
      <Path d="M36 28 C30 22 40 16 34 8 M54 28 C48 22 58 16 52 8 M72 28 C66 22 76 16 70 8" fill="none" stroke={X.steam} strokeWidth={STROKE.line} strokeLinecap="round" />
      <Path d="M18 56 C20 42 34 36 50 36 C66 36 80 42 82 56 Z" fill={c('rice')} {...line(a)} />
      <Circle cx={36} cy={46} r={5} fill={c('tomatoLight')} />
      <Circle cx={52} cy={44} r={5} fill={X.carrot} />
      <Circle cx={66} cy={48} r={5} fill={c('leafLight')} />
      <Path d="M10 54 L90 54 C90 76 72 90 50 90 C28 90 10 76 10 54 Z" fill={c('bowlFill')} {...line(a)} />
      <Path d="M22 66 C26 74 34 80 42 82" fill="none" stroke={X.shine} strokeOpacity={0.5} strokeWidth={STROKE.bold} strokeLinecap="round" />
    </>
  );
}

/** The fallback: a plate with a fork and a knife. */
function PlateCutlery({ a }: P) {
  return (
    <>
      <Circle cx={50} cy={50} r={32} fill={c('plateRimTop')} {...line(a)} />
      <Circle cx={50} cy={50} r={22} fill={c('plateCentre')} stroke={c('plateCentreEdge')} strokeWidth={STROKE.line} />
      <Path d="M12 26 L12 46 M18 26 L18 46 M24 26 L24 46 M12 46 C12 52 24 52 24 46 M18 50 L18 90" fill="none" stroke={a.ink} strokeWidth={STROKE.line} strokeLinecap="round" />
      <Path d="M86 26 C80 32 80 46 84 56 L84 90" fill="none" stroke={a.ink} strokeWidth={STROKE.line} strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
}

const SKETCHES: Record<FoodCategory, (p: P) => ReactElement> = {
  fruit: Apple,
  vegetable: Carrot,
  legume: PeaPod,
  grain: Wheat,
  bread: Loaf,
  meat: Steak,
  poultry: Drumstick,
  fish: Fish,
  egg: FriedEgg,
  dairy: Cheese,
  plant_protein: Tofu,
  nut: Walnut,
  oil: OilBottle,
  snack: ChipsBag,
  sweet: CakeSlice,
  drink: DrinkCup,
  fast_food: Burger,
  dish: Bowl,
  other: PlateCutlery,
};

/** The sketch for a food category, in a square box of `size` px. Decorative: hidden from accessibility. */
export function FoodArt({ category, size = 40, style, tone }: { category: FoodCategory; size?: number; style?: StyleProp<ViewStyle>; tone?: ArtTone }) {
  const Sketch = SKETCHES[category] ?? SKETCHES.other;
  const a = tone ? artPalettes[tone] : art;
  return (
    <View style={[{ width: size, height: size }, style]} accessible={false} importantForAccessibility="no-hide-descendants" aria-hidden>
      <Svg width="100%" height="100%" viewBox="0 0 100 100">
        <Sketch a={a} />
      </Svg>
    </View>
  );
}
