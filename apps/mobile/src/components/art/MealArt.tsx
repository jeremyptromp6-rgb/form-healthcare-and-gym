import type { ReactElement } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { art, artPalettes, FOODS, LIGHT_DIR, METALS, STROKE, useArtId, type ArtPalette, type ArtTone } from '@/theme/artPalette';

/**
 * Meal illustrations with soft shading and no outline: for each meal slot two dishes (variant 0 or 1):
 *   breakfast  an oat bowl with fruit / a pancake stack
 *   lunch      a leafy salad / toasts with toppings on a board
 *   dinner     salmon with rice and broccoli / a nest of pasta with tomato sauce
 *   snack      an apple, banana and almonds / a bowl of berries
 * They are illustrations of a kind of meal, never presented as the user's own food. Colours come from FOODS
 * (food does not recolour at night); only the cast shadow follows the tone. Below 48px the detail layers
 * (seeds, veins, glints, flakes) are dropped so the dish reads crisply. Budget: 60 SVG elements, 30 when small.
 * Style rules: docs/art-style.md.
 */

export type MealKind = 'breakfast' | 'lunch' | 'dinner' | 'snack';

const c = (key: string): string => FOODS[key]!;

interface K {
  id: string;
  a: ArtPalette;
  /** Small: drop the detail layers. */
  lite: boolean;
}

/** A two-stop gradient along the light direction: lit top-left. */
function Lin({ id, from, to }: { id: string; from: string; to: string }) {
  return (
    <LinearGradient id={id} {...LIGHT_DIR}>
      <Stop offset="0" stopColor={from} />
      <Stop offset="1" stopColor={to} />
    </LinearGradient>
  );
}

/** A round two-stop gradient with the light at the upper left. */
function Rad({ id, from, to }: { id: string; from: string; to: string }) {
  return (
    <RadialGradient id={id} cx="36%" cy="32%" r="72%">
      <Stop offset="0" stopColor={from} />
      <Stop offset="1" stopColor={to} />
    </RadialGradient>
  );
}

/** A ceramic plate or bowl seen from above: a cast shadow, a shaded rim and a lit well. */
function Plate({ k, bowl }: { k: K; bowl?: boolean }) {
  const { id, a } = k;
  return (
    <>
      <Defs>
        <Lin id={`${id}pr`} from={c('plateRimTop')} to={c('plateRimBottom')} />
        {bowl ? null : <Lin id={`${id}pw`} from={c('plateCentre')} to={c('plateCentreEdge')} />}
      </Defs>
      {k.lite ? null : <Ellipse cx={62} cy={51} rx={39.5} ry={38} fill={a.shadow} opacity={a.shadowOpacity * 0.55} />}
      <Ellipse cx={61} cy={48.5} rx={37.5} ry={37} fill={a.shadow} opacity={a.shadowOpacity} />
      <Circle cx={60} cy={45} r={37} fill={`url(#${id}pr)`} />
      {k.lite ? null : <Circle cx={60} cy={45} r={33.5} fill="none" stroke={c('plateRimBottom')} strokeOpacity={0.5} strokeWidth={STROKE.hair} />}
      {bowl ? <Circle cx={60} cy={45} r={29} fill={c('bowlFill')} stroke={c('bowlRing')} strokeWidth={STROKE.line} /> : <Circle cx={60} cy={45} r={30} fill={`url(#${id}pw)`} stroke={c('plateCentreEdge')} strokeWidth={STROKE.hair} />}
    </>
  );
}

/** A berry: a round body with a glint on the lit side. */
function Berry({ x, y, r = 3.4, color, k }: { x: number; y: number; r?: number; color: string; k: K }) {
  return (
    <>
      <Circle cx={x} cy={y} r={r} fill={color} />
      {k.lite ? null : <Circle cx={x - r * 0.3} cy={y - r * 0.35} r={r * 0.3} fill={k.a.highlight} opacity={0.55} />}
    </>
  );
}

/* ------------------------------------------------------------ breakfast */

function OatBowl({ k }: { k: K }) {
  const { id, lite } = k;
  return (
    <>
      <Plate k={k} bowl />
      <Defs>
        <Rad id={`${id}oats`} from={c('oatsLight')} to={c('oatsDark')} />
      </Defs>
      <Circle cx={60} cy={45} r={26} fill={`url(#${id}oats)`} />
      {lite
        ? null
        : [
            [50, 36],
            [64, 32],
            [72, 46],
            [46, 52],
            [58, 58],
            [68, 56],
          ].map(([x, y], i) => <Ellipse key={`f${i}`} cx={x} cy={y} rx={2.6} ry={1.4} fill={c('oatFlake')} opacity={0.8} transform={`rotate(${i * 30} ${x} ${y})`} />)}
      <Path d="M42 50 q8 -10 16 -2 q6 6 14 -4" stroke={c('honey')} strokeWidth={STROKE.bold} fill="none" strokeLinecap="round" opacity={0.9} />
      {[
        [48, 42],
        [55, 47],
      ].map(([x, y], i) => (
        <Circle key={`b${i}`} cx={x} cy={y} r={5.5} fill={c('bananaSlice')} stroke={c('bananaSliceRim')} strokeWidth={STROKE.hair} />
      ))}
      {lite
        ? null
        : [
            [48, 42],
            [55, 47],
          ].map(([x, y], i) => <Circle key={`bc${i}`} cx={x} cy={y} r={1.6} fill={c('bananaSliceCore')} opacity={0.6} />)}
      <Berry k={k} x={66} y={38} color={c('blueberry')} />
      <Berry k={k} x={71} y={42} color={c('blueberryLight')} />
      <Berry k={k} x={63} y={44} color={c('blueberry')} />
      <Berry k={k} x={70} y={52} color={c('raspberry')} />
      <Berry k={k} x={62} y={54} color={c('raspberryLight')} />
      <Rect x={95} y={14} width={6} height={40} rx={3} fill={c('spoonHandle')} transform="rotate(28 98 34)" />
      <Ellipse cx={98} cy={14} rx={6} ry={8} fill={c('spoonBowl')} transform="rotate(28 98 34)" />
    </>
  );
}

function Pancakes({ k }: { k: K }) {
  const { id, a, lite } = k;
  const side = (yt: number) => `M32 ${yt} L32 ${yt + 9} A28 7.5 0 0 0 88 ${yt + 9} L88 ${yt} Z`;
  return (
    <>
      <Defs>
        <Lin id={`${id}pr`} from={c('plateRimTop')} to={c('plateRimBottom')} />
        <Lin id={`${id}pw`} from={c('plateCentre')} to={c('plateCentreEdge')} />
        <Lin id={`${id}pk`} from={c('oatsLight')} to={c('oatsDark')} />
        <Lin id={`${id}ps`} from={c('oatsDark')} to={c('almond')} />
      </Defs>
      <Ellipse cx={64} cy={69} rx={44} ry={13} fill={a.shadow} opacity={a.shadowOpacity} />
      <Ellipse cx={60} cy={64} rx={43} ry={15} fill={`url(#${id}pr)`} />
      <Ellipse cx={60} cy={63} rx={35} ry={11} fill={`url(#${id}pw)`} stroke={c('plateCentreEdge')} strokeWidth={STROKE.hair} />
      {[56, 47, 38].map((yt) => (
        <Path key={yt} d={side(yt)} fill={`url(#${id}ps)`} stroke={c('almondEdge')} strokeWidth={STROKE.hair} strokeLinejoin="round" />
      ))}
      <Ellipse cx={60} cy={29} rx={28} ry={7.5} fill={`url(#${id}pk)`} stroke={c('almondEdge')} strokeWidth={STROKE.hair} />
      <Path d="M43 31 Q40 44 43 53 Q47 56 48 51 Q50 43 49 33 Z" fill={c('honey')} />
      <Ellipse cx={58} cy={30} rx={19} ry={4.6} fill={c('honey')} opacity={0.92} />
      <Path d="M54 26 L67 24.5 L69 29.5 L56 31.5 Z" fill={c('bananaSlice')} stroke={c('bananaSliceRim')} strokeWidth={STROKE.hair} strokeLinejoin="round" />
      <Berry k={k} x={72} y={27.5} color={c('raspberry')} r={3.6} />
      <Berry k={k} x={47} y={27} color={c('blueberry')} r={3.2} />
      <Berry k={k} x={76} y={31} color={c('blueberryLight')} r={3} />
      {lite ? null : <Ellipse cx={46} cy={26.5} rx={9} ry={2.2} fill={a.highlight} opacity={a.highlightOpacity} transform="rotate(-8 46 26.5)" />}
      <Berry k={k} x={97} y={62} color={c('raspberryLight')} r={3.6} />
      <Berry k={k} x={25} y={66} color={c('blueberry')} r={3.4} />
    </>
  );
}

/* ---------------------------------------------------------------- lunch */

/** A leaf for the salad: a lens with a vein. */
function Leaf({ x, y, r, s = 1, color, k }: { x: number; y: number; r: number; s?: number; color: string; k: K }) {
  const t = `translate(${x} ${y}) rotate(${r}) scale(${s})`;
  return (
    <>
      <Path d="M0 -11 C8 -8 9 6 0 11 C-9 6 -8 -8 0 -11 Z" fill={color} transform={t} />
      {k.lite ? null : <Path d="M0 -9 L0 9" stroke={k.a.highlight} strokeOpacity={0.4} strokeWidth={STROKE.hair} transform={t} />}
    </>
  );
}

function Salad({ k }: { k: K }) {
  const { id, lite } = k;
  return (
    <>
      <Plate k={k} />
      <Defs>
        <Rad id={`${id}tom`} from={c('tomatoLight')} to={c('tomatoDark')} />
      </Defs>
      <Leaf k={k} x={48} y={34} r={-30} s={1.3} color={c('leafMid')} />
      <Leaf k={k} x={70} y={32} r={40} s={1.2} color={c('leafLight')} />
      <Leaf k={k} x={76} y={52} r={100} s={1.25} color={c('leafMid')} />
      <Leaf k={k} x={44} y={56} r={-110} s={1.2} color={c('leafLight')} />
      <Leaf k={k} x={60} y={44} r={10} s={1.1} color={c('leafPale')} />
      {[
        [53, 48],
        [66, 54],
      ].map(([x, y], i) => (
        <Circle key={`c${i}`} cx={x} cy={y} r={5.5} fill={c('cucumberSkin')} />
      ))}
      {[
        [53, 48],
        [66, 54],
      ].map(([x, y], i) => (
        <Circle key={`cf${i}`} cx={x} cy={y} r={4.3} fill={c('cucumberFlesh')} />
      ))}
      {lite
        ? null
        : [
            [53, 48],
            [66, 54],
          ].map(([x, y], i) => <Circle key={`cs${i}`} cx={x} cy={y} r={1.4} fill={c('cucumberSeed')} />)}
      {[
        [62, 36],
        [42, 44],
        [72, 42],
      ].map(([x, y], i) => (
        <Circle key={`t${i}`} cx={x} cy={y} r={5.2} fill={`url(#${id}tom)`} />
      ))}
      {lite
        ? null
        : [
            [62, 36],
            [42, 44],
            [72, 42],
          ].map(([x, y], i) => (
            <Path key={`ts${i}`} d={`M${x - 1.5} ${y - 4.5} l1.5 1.5 l1.5 -1.5`} stroke={c('tomatoStem')} strokeWidth={STROKE.hair} fill="none" />
          ))}
      {lite
        ? null
        : [
            [62, 36],
            [42, 44],
            [72, 42],
          ].map(([x, y], i) => <Circle key={`th${i}`} cx={x - 1.6} cy={y - 1.8} r={1.4} fill={k.a.highlight} opacity={0.6} />)}
      <Rect x={54} y={56} width={6} height={6} rx={1.5} fill={c('feta')} transform="rotate(12 57 59)" />
      <Rect x={47} y={38} width={5} height={5} rx={1.5} fill={c('feta')} transform="rotate(-10 49 40)" />
    </>
  );
}

const SLICE = 'M-17 14 L-17 -6 C-17 -17 -8 -20 0 -20 C8 -20 17 -17 17 -6 L17 14 Q17 17 14 17 L-14 17 Q-17 17 -17 14 Z';
const CRUMB = 'M-13.5 13 L-13.5 -5 C-13.5 -13 -7 -16 0 -16 C7 -16 13.5 -13 13.5 -5 L13.5 13 Q13.5 14 12.5 14 L-12.5 14 Q-13.5 14 -13.5 13 Z';

function Toasts({ k }: { k: K }) {
  const { id, a, lite } = k;
  const wood = METALS.wood;
  const at = (x: number, y: number, r: number) => `translate(${x} ${y}) rotate(${r})`;
  return (
    <>
      <Defs>
        <Lin id={`${id}bd`} from={wood.hi} to={wood.lo} />
        <Lin id={`${id}cr`} from={c('almond')} to={c('almondEdge')} />
        <Rad id={`${id}tom`} from={c('tomatoLight')} to={c('tomatoDark')} />
      </Defs>
      <Rect x={16} y={12} width={92} height={68} rx={11} fill={a.shadow} opacity={a.shadowOpacity} />
      <Rect x={12} y={8} width={92} height={68} rx={11} fill={`url(#${id}bd)`} />
      {lite ? null : <Path d="M20 20 H96 M20 64 H96" stroke={wood.rim} strokeOpacity={0.45} strokeWidth={STROKE.hair} strokeLinecap="round" />}
      <Path d={SLICE} fill={`url(#${id}cr)`} transform={at(38, 42, -8)} />
      <Path d={CRUMB} fill={c('oatsLight')} transform={at(38, 42, -8)} />
      <Path d={SLICE} fill={`url(#${id}cr)`} transform={at(76, 42, 7)} />
      <Path d={CRUMB} fill={c('oatsLight')} transform={at(76, 42, 7)} />
      <Path d="M27 36 C30 29 38 33 41 29 C46 28 49 34 48 39 C44 42 31 43 27 36 Z" fill={c('leafMid')} />
      <Circle cx={34} cy={47} r={5.4} fill={`url(#${id}tom)`} />
      <Circle cx={44} cy={52} r={5.4} fill={`url(#${id}tom)`} />
      <Circle cx={40} cy={39} r={3.6} fill={c('cucumberSkin')} />
      <Circle cx={40} cy={39} r={2.7} fill={c('cucumberFlesh')} />
      {lite ? null : <Circle cx={32.6} cy={45.4} r={1.4} fill={a.highlight} opacity={0.6} />}
      {lite ? null : <Circle cx={42.6} cy={50.4} r={1.4} fill={a.highlight} opacity={0.6} />}
      <Path d="M65 34 C69 28 76 33 80 28 C85 28 88 34 86 39 C82 42 69 42 65 34 Z" fill={c('leafLight')} />
      <Circle cx={69} cy={48} r={5} fill={c('cucumberSkin')} />
      <Circle cx={69} cy={48} r={3.9} fill={c('cucumberFlesh')} />
      <Circle cx={82} cy={51} r={5} fill={c('cucumberSkin')} />
      <Circle cx={82} cy={51} r={3.9} fill={c('cucumberFlesh')} />
      <Rect x={74} y={39} width={5} height={5} rx={1.5} fill={c('feta')} transform="rotate(14 76 41)" />
      {lite ? null : <Rect x={64} y={55} width={4} height={4} rx={1.2} fill={c('feta')} transform="rotate(-12 66 57)" />}
      {lite ? null : <Circle cx={69} cy={48} r={1.1} fill={c('cucumberSeed')} />}
      {lite ? null : <Circle cx={82} cy={51} r={1.1} fill={c('cucumberSeed')} />}
    </>
  );
}

/* --------------------------------------------------------------- dinner */

function Salmon({ k }: { k: K }) {
  const { id, lite } = k;
  return (
    <>
      <Plate k={k} />
      <Defs>
        <Lin id={`${id}sal`} from={c('salmonLight')} to={c('salmonDark')} />
      </Defs>
      <Ellipse cx={72} cy={54} rx={14} ry={10.5} fill={c('rice')} />
      {lite
        ? null
        : [
            [66, 51],
            [72, 49],
            [78, 53],
            [70, 57],
            [76, 58],
            [64, 56],
          ].map(([x, y], i) => <Ellipse key={`g${i}`} cx={x} cy={y} rx={1.8} ry={0.9} fill={c('riceGrain')} transform={`rotate(${i * 40} ${x} ${y})`} />)}
      <Path d="M36 30 Q52 22 70 28 Q74 36 68 42 Q52 46 38 42 Q32 36 36 30 Z" fill={`url(#${id}sal)`} />
      {lite
        ? null
        : [44, 52, 60].map((x) => <Path key={x} d={`M${x} 27 Q${x + 2} 35 ${x} 43`} stroke={c('salmonStripe')} strokeWidth={STROKE.line} strokeLinecap="round" fill="none" opacity={0.65} />)}
      {lite ? null : <Path d="M40 31 Q54 26 66 30" stroke={k.a.highlight} strokeOpacity={0.4} strokeWidth={STROKE.line} fill="none" strokeLinecap="round" />}
      {[
        [44, 56],
        [52, 60],
        [47, 50],
      ].map(([x, y], i) => (
        <Rect key={`s${i}`} x={x - 1.4} y={y} width={2.8} height={6} rx={1.2} fill={c('broccoliStem')} />
      ))}
      {[
        [44, 56],
        [52, 60],
        [47, 50],
      ].map(([x, y], i) => (
        <Circle key={`l${i}`} cx={x - 3} cy={y} r={3.4} fill={c('broccoliDark')} />
      ))}
      {[
        [44, 56],
        [52, 60],
        [47, 50],
      ].map(([x, y], i) => (
        <Circle key={`r${i}`} cx={x + 3} cy={y} r={3.4} fill={c('broccoliDark')} />
      ))}
      {[
        [44, 56],
        [52, 60],
        [47, 50],
      ].map(([x, y], i) => (
        <Circle key={`t${i}`} cx={x} cy={y - 3} r={3.8} fill={c('broccoliLight')} />
      ))}
      <Path d="M82 30 a10 10 0 0 1 4 16 z" fill={c('lemon')} stroke={c('lemonRim')} strokeWidth={STROKE.hair} strokeLinejoin="round" />
      {lite ? null : <Path d="M83 33 l2 9" stroke={c('lemonPith')} strokeWidth={STROKE.hair} />}
    </>
  );
}

function Pasta({ k }: { k: K }) {
  const { id, a, lite } = k;
  const chrome = METALS.chrome;
  return (
    <>
      <Plate k={k} />
      <Defs>
        <Rad id={`${id}sau`} from={c('tomatoLight')} to={c('tomatoDark')} />
        <Lin id={`${id}nest`} from={c('oatsLight')} to={c('honey')} />
      </Defs>
      <Ellipse cx={60} cy={47} rx={25} ry={22} fill={a.shadow} opacity={a.shadowOpacity} />
      <Ellipse cx={59} cy={44} rx={24} ry={21} fill={`url(#${id}nest)`} />
      <Ellipse cx={59} cy={44} rx={20} ry={17} fill="none" stroke={c('oatsDark')} strokeWidth={STROKE.bold} />
      <Ellipse cx={58} cy={43} rx={14} ry={12} fill="none" stroke={c('oatsLight')} strokeWidth={STROKE.bold} />
      {lite ? null : <Ellipse cx={58} cy={43} rx={8} ry={6.5} fill="none" stroke={c('oatsDark')} strokeWidth={STROKE.bold} />}
      <Ellipse cx={58} cy={40} rx={12} ry={9.5} fill={`url(#${id}sau)`} />
      {lite ? null : <Ellipse cx={53} cy={36} rx={4.4} ry={2.2} fill={a.highlight} opacity={0.4} transform="rotate(-25 53 36)" />}
      <Circle cx={65} cy={46} r={4.6} fill={c('tomatoLight')} />
      <Circle cx={50} cy={48} r={4.2} fill={c('tomatoDark')} />
      {lite ? null : <Circle cx={65} cy={46} r={1.5} fill={c('tomatoDark')} opacity={0.5} />}
      <Path d="M56 33 C58 26 66 27 68 31 C64 36 58 36 56 33 Z" fill={c('leafMid')} />
      {lite ? null : <Path d="M49 36 C50 31 55 31 57 34 C54 38 50 38 49 36 Z" fill={c('leafLight')} />}
      {lite ? null : <Circle cx={61} cy={50} r={1.3} fill={c('feta')} />}
      {lite ? null : <Circle cx={55} cy={51} r={1.1} fill={c('feta')} />}
      <Path d="M97 19 L97 66" stroke={chrome.mid} strokeWidth={STROKE.bold} strokeLinecap="round" />
      <Path d="M91 17 V27 Q91 31 97 31 Q103 31 103 27 V17" stroke={chrome.mid} strokeWidth={STROKE.line} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {lite ? null : <Path d="M96 24 V62" stroke={chrome.hi} strokeWidth={STROKE.hair} strokeLinecap="round" />}
    </>
  );
}

/* ---------------------------------------------------------------- snack */

function FruitSnack({ k }: { k: K }) {
  const { id, a, lite } = k;
  return (
    <>
      <Defs>
        <Rad id={`${id}app`} from={c('appleLight')} to={c('appleDark')} />
        <Lin id={`${id}ban`} from={c('bananaLight')} to={c('bananaDark')} />
      </Defs>
      <Ellipse cx={62} cy={76} rx={44} ry={6} fill={a.shadow} opacity={a.shadowOpacity} />
      <Path d="M30 40 C30 26 44 24 48 30 C52 24 66 26 66 40 C66 56 56 70 48 66 C40 70 30 56 30 40 Z" fill={`url(#${id}app)`} />
      {lite ? null : <Ellipse cx={39} cy={38} rx={4} ry={7} fill={a.highlight} opacity={a.highlightOpacity + 0.04} transform="rotate(-20 39 38)" />}
      <Path d="M48 30 q1 -7 5 -10" stroke={c('appleStem')} strokeWidth={STROKE.bold} fill="none" strokeLinecap="round" />
      <Path d="M52 24 q9 -7 16 -1 q-9 5 -16 1z" fill={c('leafLight')} />
      <Path d="M70 22 C90 30 98 52 86 70 C84 62 78 42 66 30 Z" fill={`url(#${id}ban)`} />
      {lite ? null : <Path d="M70 24 C86 32 92 50 86 66" stroke={c('bananaRidge')} strokeWidth={STROKE.hair} fill="none" opacity={0.7} />}
      <Path d="M66 30 l-3 -6" stroke={c('appleStem')} strokeWidth={STROKE.bold} strokeLinecap="round" />
      <Circle cx={86} cy={70} r={1.8} fill={c('appleStem')} />
      {[
        [26, 70, -20],
        [36, 74, 25],
        [100, 66, 60],
      ].map(([x, y, r], i) => (
        <Ellipse key={i} cx={x} cy={y} rx={5} ry={3} fill={c('almond')} stroke={c('almondEdge')} strokeWidth={STROKE.hair} transform={`rotate(${r} ${x} ${y})`} />
      ))}
    </>
  );
}

function BerryBowl({ k }: { k: K }) {
  const { id, a, lite } = k;
  const back = [
    [38, 36, 'blueberry'],
    [48, 31, 'raspberry'],
    [60, 29, 'blueberryLight'],
    [72, 31, 'raspberryLight'],
    [82, 36, 'blueberry'],
  ] as const;
  const front = [
    [43, 42, 'raspberryLight'],
    [54, 38, 'blueberry'],
    [66, 38, 'raspberry'],
    [77, 42, 'blueberryLight'],
    [60, 44, 'blueberry'],
  ] as const;
  return (
    <>
      <Defs>
        <Lin id={`${id}bw`} from={c('plateRimTop')} to={c('plateRimBottom')} />
      </Defs>
      <Ellipse cx={62} cy={79} rx={42} ry={6} fill={a.shadow} opacity={a.shadowOpacity} />
      <Ellipse cx={60} cy={46} rx={38} ry={8} fill={c('bowlRing')} />
      {back.map(([x, y, col], i) => (
        <Berry key={`b${i}`} k={k} x={x} y={y} r={5.4} color={c(col)} />
      ))}
      {front.map(([x, y, col], i) => (
        <Berry key={`f${i}`} k={k} x={x} y={y} r={5.4} color={c(col)} />
      ))}
      <Path d="M22 46 C22 70 38 80 60 80 C82 80 98 70 98 46 C84 53 36 53 22 46 Z" fill={`url(#${id}bw)`} />
      <Path d="M22 46 C36 53 84 53 98 46" stroke={c('bowlRing')} strokeWidth={STROKE.line} fill="none" strokeLinecap="round" />
      {lite ? null : <Path d="M29 56 C32 64 38 70 46 73" stroke={a.highlight} strokeOpacity={0.7} strokeWidth={STROKE.line} fill="none" strokeLinecap="round" />}
      {lite ? null : <Path d="M30 62 C36 66 50 69 60 69" stroke={c('bowlRing')} strokeOpacity={0.5} strokeWidth={STROKE.hair} fill="none" strokeLinecap="round" />}
      <Ellipse cx={104} cy={72} rx={5} ry={3} fill={c('almond')} stroke={c('almondEdge')} strokeWidth={STROKE.hair} transform="rotate(-25 104 72)" />
      <Ellipse cx={12} cy={74} rx={5} ry={3} fill={c('almond')} stroke={c('almondEdge')} strokeWidth={STROKE.hair} transform="rotate(20 12 74)" />
    </>
  );
}

const DISHES: Record<MealKind, [(p: { k: K }) => ReactElement, (p: { k: K }) => ReactElement]> = {
  breakfast: [OatBowl, Pancakes],
  lunch: [Salad, Toasts],
  dinner: [Salmon, Pasta],
  snack: [FruitSnack, BerryBowl],
};

/** A meal illustration. `variant` picks one of the slot's two dishes (0 or 1, wrapping around). */
export function MealArt({ kind, size = 56, style, variant = 0, tone }: { kind: MealKind; size?: number; style?: StyleProp<ViewStyle>; variant?: number; tone?: ArtTone }) {
  const id = useArtId('meal');
  const dish = DISHES[kind][Number.isFinite(variant) ? Math.abs(Math.trunc(variant)) % 2 : 0]!;
  const Dish = dish;
  const k: K = { id, a: tone ? artPalettes[tone] : art, lite: size < 48 };
  return (
    <View style={[{ width: size * (120 / 90), height: size }, style]} accessible={false} importantForAccessibility="no-hide-descendants" aria-hidden>
      <Svg width="100%" height="100%" viewBox="0 0 120 90">
        <Dish k={k} />
      </Svg>
    </View>
  );
}
