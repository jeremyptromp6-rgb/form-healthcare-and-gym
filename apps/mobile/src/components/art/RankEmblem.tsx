import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, Ellipse, LinearGradient, Path, Stop } from 'react-native-svg';
import { art, artPalettes, LIGHT_DIR, METALS, METAL_SYMBOL, METAL_TEXT, STROKE, useArtId, type ArtPalette, type ArtTone, type Metal } from '@/theme/artPalette';
import { scheme } from '@/theme/tokens';

/**
 * Rank emblems: a shield per rank, each a step up in grandeur and each with its own silhouette, so
 * the seven read apart at 38px without colour:
 * Rookie (oak, a plain round-top badge) -> Starter (bronze, a gabled shield with rivets) ->
 * Athlete (silver, winged) -> Iron (blued steel, angular with a spike) -> Elite (gold, a crowned top) ->
 * Master (platinum, laurels and a gem) -> Champion (sapphire, a gold crown over gold laurels).
 *
 * Each shield is a bevelled frame (lit top-left, with a thickness at the lower-right) around a recessed
 * face that carries an embossed symbol. A rank not reached yet is an unrevealed clay shield with a
 * keyhole: the same silhouette, no metal. Style rules: docs/art-style.md. Budget: 40 SVG elements.
 */

export type RankName = 'Rookie' | 'Starter' | 'Athlete' | 'Iron' | 'Elite' | 'Master' | 'Champion';

type RankMetal = keyof typeof METAL_SYMBOL;
type Symbol = { kind: 'chevrons'; n: number } | { kind: 'dumbbell' } | { kind: 'star' } | { kind: 'laurelStar' } | { kind: 'stars' };

interface Look {
  metal: RankMetal;
  /** The shield outline. */
  body: string;
  /** Where the face shrinks to, and the symbol sits. */
  pivot: readonly [number, number];
  symbol: Symbol;
  /** Ink is dark: the face is lit, not shaded. */
  darkInk?: boolean;
  /** Points on the frame that get a rivet or a pearl, and which. */
  studs?: readonly (readonly [number, number])[];
  /** Where the soft highlight sits on the lit upper-left. */
  shine: readonly [number, number];
}

const LOOKS: Record<RankName, Look> = {
  Rookie: {
    metal: 'oak',
    body: 'M50 12 C58 12 70 15 79 19 L79 52 C79 75 66 92 50 103 C34 92 21 75 21 52 L21 19 C30 15 42 12 50 12 Z',
    pivot: [50, 60],
    symbol: { kind: 'chevrons', n: 1 },
    shine: [37, 33],
  },
  Starter: {
    metal: 'bronze',
    body: 'M50 7 L90 19 L90 53 C90 77 73 93 50 103 C27 93 10 77 10 53 L10 19 Z',
    pivot: [50, 60],
    symbol: { kind: 'chevrons', n: 2 },
    studs: [[10, 19], [90, 19]],
    shine: [31, 32],
  },
  Athlete: {
    metal: 'silver',
    body: 'M50 12 L79 21 L79 53 C79 76 66 92 50 103 C34 92 21 76 21 53 L21 21 Z',
    pivot: [50, 60],
    symbol: { kind: 'chevrons', n: 3 },
    darkInk: true,
    shine: [37, 34],
  },
  Iron: {
    metal: 'steel',
    body: 'M50 5 L63 16 L90 16 L90 54 L74 87 L50 103 L26 87 L10 54 L10 16 L37 16 Z',
    pivot: [50, 58],
    symbol: { kind: 'dumbbell' },
    studs: [[10, 16], [90, 16], [10, 54], [90, 54]],
    shine: [30, 33],
  },
  Elite: {
    metal: 'gold',
    body: 'M13 9 L31 24 L50 3 L69 24 L87 9 L87 53 C87 77 70 93 50 103 C30 93 13 77 13 53 Z',
    pivot: [50, 60],
    symbol: { kind: 'star' },
    darkInk: true,
    studs: [[13, 9], [50, 3], [87, 9]],
    shine: [33, 40],
  },
  Master: {
    metal: 'platinum',
    body: 'M50 12 C64 24 80 31 80 54 C80 77 66 92 50 103 C34 92 20 77 20 54 C20 31 36 24 50 12 Z',
    pivot: [50, 62],
    symbol: { kind: 'laurelStar' },
    darkInk: true,
    shine: [36, 42],
  },
  Champion: {
    metal: 'sapphire',
    body: 'M50 29 L78 35 L78 59 C78 79 66 93 50 103 C34 93 22 79 22 59 L22 35 Z',
    pivot: [50, 68],
    symbol: { kind: 'stars' },
    shine: [37, 50],
  },
};

const METAL_OF: Record<RankName, RankMetal> = { Rookie: 'oak', Starter: 'bronze', Athlete: 'silver', Iron: 'steel', Elite: 'gold', Master: 'platinum', Champion: 'sapphire' };

/** Each rank's colour for text that names it: the metal, deepened for cream or brightened for the evening palette (4.5:1). */
export const rankColorFor = (rank: string, mood: 'light' | 'dark') => METAL_TEXT[mood][METAL_OF[rank as RankName] ?? 'oak'];

/** The rank's signature colour, for text that names the rank. */
export const rankColor = (rank: string) => rankColorFor(rank, scheme);

export const RANK_ORDER: RankName[] = ['Rookie', 'Starter', 'Athlete', 'Iron', 'Elite', 'Master', 'Champion'];

/* ------------------------------------------------------------ geometry */

const f1 = (n: number) => Math.round(n * 10) / 10;
const PAIR = /(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g;
/** The shape reflected across the emblem's centre line (absolute "x y" pairs only). */
const mirror = (d: string) => d.replace(PAIR, (_, x: string, y: string) => `${f1(100 - +x)} ${y}`);
/** The shape shrunk about a point: the recessed face inside the frame. */
const shrink = (d: string, s: number, [cx, cy]: readonly [number, number]) => d.replace(PAIR, (_, x: string, y: string) => `${f1(cx + (+x - cx) * s)} ${f1(cy + (+y - cy) * s)}`);
const FACE = 0.8;
const both = (d: string) => `${d} ${mirror(d)}`;

const star = (cx: number, cy: number, r: number) =>
  `M${Array.from({ length: 10 }, (_, i) => {
    const ang = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.45;
    return `${f1(cx + rr * Math.cos(ang))} ${f1(cy + rr * Math.sin(ang))}`;
  }).join(' L')} Z`;

/** A rounded rectangle, drawn clockwise. */
const rr = (x: number, y: number, w: number, h: number, r: number) =>
  `M${x + r} ${y} L${x + w - r} ${y} Q${x + w} ${y} ${x + w} ${y + r} L${x + w} ${y + h - r} Q${x + w} ${y + h} ${x + w - r} ${y + h} L${x + r} ${y + h} Q${x} ${y + h} ${x} ${y + h - r} L${x} ${y + r} Q${x} ${y} ${x + r} ${y} Z`;

/** A full circle, drawn counter-clockwise. */
const dot = (cx: number, cy: number, r: number) => `M${f1(cx - r)} ${cy} a${r} ${r} 0 1 0 ${r * 2} 0 a${r} ${r} 0 1 0 ${-r * 2} 0 Z`;

/** A chevron stack: `n` Vs, centred on y. */
const chevrons = (n: number, cy: number) =>
  Array.from({ length: n }, (_, i) => {
    const y = cy + (i - (n - 1) / 2) * 13;
    return `M35 ${f1(y + 6.5)} L50 ${f1(y - 6.5)} L65 ${f1(y + 6.5)}`;
  }).join(' ');

/** A lens-shaped leaf centred on (cx, cy), pointing along `ang`. */
function leaf(cx: number, cy: number, ang: number, len: number, wid: number): string {
  const dx = Math.cos(ang);
  const dy = Math.sin(ang);
  const [nx, ny] = [-dy * wid, dx * wid];
  const a = `${f1(cx - (dx * len) / 2)} ${f1(cy - (dy * len) / 2)}`;
  const b = `${f1(cx + (dx * len) / 2)} ${f1(cy + (dy * len) / 2)}`;
  return `M${a} Q${f1(cx + nx)} ${f1(cy + ny)} ${b} Q${f1(cx - nx)} ${f1(cy - ny)} ${a} Z`;
}

/** The left laurel branch: leaves along an arc up the side of the shield, and the stem they hang on. */
function branch(centre: readonly [number, number], radius: number, from: number, to: number, n: number) {
  const leaves: string[] = [];
  const stem: string[] = [];
  for (let i = 0; i < n; i++) {
    const deg = from + ((to - from) * i) / (n - 1);
    const ang = (deg * Math.PI) / 180;
    const x = centre[0] + radius * Math.cos(ang);
    const y = centre[1] + radius * Math.sin(ang);
    // the leaf follows the arc, leaning out a little
    leaves.push(leaf(x + 2.4 * Math.cos(ang), y + 2.4 * Math.sin(ang), ang + Math.PI / 2 - 0.55, 12.5, 6.4));
    stem.push(`${f1(centre[0] + (radius - 1.5) * Math.cos(ang))} ${f1(centre[1] + (radius - 1.5) * Math.sin(ang))}`);
  }
  return { leaves: leaves.join(' '), stem: `M${stem.join(' L')}` };
}

/** A feathered wing off the left side of the shield. */
const WING = 'M21 22 C14 20 7 15 1 8 C3 14 6 18 9 20 C5 22 2 26 1 33 C6 30 10 29 14 30 C11 33 9 37 9 43 C14 40 18 39 21 40 Z';
const CROWN = 'M24 38 L18 10 L34 22 L50 4 L66 22 L82 10 L76 38 Z';

/** The symbol's path, and whether it is stroked (chevrons) or filled. */
function symbolPath(look: Look): { d: string; stroked: boolean } {
  const [, cy] = look.pivot;
  const s = look.symbol;
  switch (s.kind) {
    case 'chevrons':
      return { d: chevrons(s.n, cy - 1), stroked: true };
    case 'dumbbell':
      return { d: `${rr(35, 54, 30, 7, 3)} ${rr(26, 44, 10, 27, 3)} ${rr(64, 44, 10, 27, 3)}`, stroked: false };
    case 'star':
      return { d: star(50, cy, 22), stroked: false };
    case 'laurelStar':
      return { d: `${star(50, cy - 5, 19)} ${rr(37, cy + 13, 26, 5.5, 2.75)}`, stroked: false };
    case 'stars':
      return { d: `${star(50, cy - 3, 15)} ${star(33, cy + 11, 7)} ${star(67, cy + 11, 7)}`, stroked: false };
  }
}

/** Where a stud sits: halfway between a frame corner and the matching corner of the face. */
const stud = (p: readonly [number, number], pivot: readonly [number, number]) => [f1((p[0] + pivot[0] + (p[0] - pivot[0]) * FACE) / 2), f1((p[1] + pivot[1] + (p[1] - pivot[1]) * FACE) / 2)] as const;

/* ------------------------------------------------------------- pieces */

function MetalGradient({ id, m }: { id: string; m: Metal }) {
  return (
    <LinearGradient id={id} {...LIGHT_DIR}>
      <Stop offset="0" stopColor={m.hi} />
      <Stop offset="0.5" stopColor={m.mid} />
      <Stop offset="1" stopColor={m.lo} />
    </LinearGradient>
  );
}

/** A symbol with a bevel: a shaded copy below-right, a lit copy above-left, then the ink. */
function Emboss({ d, stroked, ink, shade, light, lightOpacity }: { d: string; stroked: boolean; ink: string; shade: string; light: string; lightOpacity: number }) {
  const paint = (c: string) => (stroked ? ({ stroke: c, strokeWidth: STROKE.heavy, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' } as const) : ({ fill: c } as const));
  return (
    <>
      <Path d={d} {...paint(shade)} opacity={0.55} transform="translate(0.9 1.4)" />
      <Path d={d} {...paint(light)} opacity={lightOpacity} transform="translate(-0.7 -0.9)" />
      <Path d={d} {...paint(ink)} />
    </>
  );
}

function Studs({ points, r, color, edge }: { points: readonly (readonly [number, number])[]; r: number; color: string; edge: string }) {
  return <Path d={points.map(([x, y]) => dot(x, y, r)).join(' ')} fill={color} stroke={edge} strokeWidth={STROKE.hair} />;
}

/** The wings, laurels and crown that stand out beyond the shield (and its clay ghost when locked). */
function Crest({ name, id, a, locked }: { name: RankName; id: string; a: ArtPalette; locked: boolean }) {
  const clay = a.locked;
  const edge = locked ? clay.edge : METALS[METAL_OF[name]].lo;
  const flat = locked ? { fill: clay.metal[1], stroke: clay.edge, strokeWidth: STROKE.hair } : null;
  if (name === 'Athlete') return <Path d={both(WING)} fill={flat ? flat.fill : `url(#${id}m)`} stroke={edge} strokeWidth={STROKE.line} strokeLinejoin="round" />;
  if (name === 'Master' || name === 'Champion') {
    const champion = name === 'Champion';
    const { leaves, stem } = branch(champion ? [50, 64] : [50, 62], champion ? 41 : 38, 104, champion ? 214 : 222, champion ? 7 : 8);
    const leafFill = locked ? clay.metal[1] : (METAL_SYMBOL[METAL_OF[name]].laurel ?? METALS.gold.hi);
    return (
      <>
        <Path d={both(stem)} fill="none" stroke={locked ? clay.edge : METALS.gold.lo} strokeWidth={STROKE.line} strokeLinecap="round" strokeLinejoin="round" opacity={locked ? 1 : 0.8} />
        <Path d={both(leaves)} fill={leafFill} stroke={locked ? clay.edge : champion ? METALS.gold.lo : METALS.platinum.lo} strokeWidth={STROKE.hair} strokeLinejoin="round" />
      </>
    );
  }
  return null;
}

/** The crown that sits on the Champion's shield. */
function Crown({ id, a, locked }: { id: string; a: ArtPalette; locked: boolean }) {
  if (locked) return <Path d={CROWN} fill={a.locked.metal[1]} stroke={a.locked.edge} strokeWidth={STROKE.hair} strokeLinejoin="round" />;
  return (
    <>
      <Path d={CROWN} fill={`url(#${id}g)`} stroke={METALS.gold.lo} strokeWidth={STROKE.line} strokeLinejoin="round" />
      <Path d={dot(18, 10, 2.8) + dot(50, 4.5, 3) + dot(82, 10, 2.8)} fill={METALS.sapphire.hi} stroke={METALS.sapphire.lo} strokeWidth={STROKE.hair} />
    </>
  );
}

/** The keyhole of an unrevealed rank, cut into the clay. */
const KEYHOLE = `${dot(50, 57, 7)} M46.5 63 L44 79 L56 79 L53.5 63 Z`;

export function RankEmblem({ rank, size = 56, locked, style, tone }: { rank: string; size?: number; locked?: boolean; style?: StyleProp<ViewStyle>; tone?: ArtTone }) {
  const name: RankName = (rank as RankName) in LOOKS ? (rank as RankName) : 'Rookie';
  const look = LOOKS[name];
  const a = tone ? artPalettes[tone] : art;
  const id = useArtId('rank');
  const isLocked = Boolean(locked);
  const metal = METALS[look.metal];
  const sym = METAL_SYMBOL[look.metal];
  const clay = a.locked;
  const face = shrink(look.body, FACE, look.pivot);
  const { d: symD, stroked } = symbolPath(look);
  const frameEdge = isLocked ? clay.edge : metal.lo;
  const champion = name === 'Champion';
  // The shield's thickness: its shaded metal, or in the evening a warm rim light on the lower-right edge.
  const night = (tone ?? scheme) === 'dark';
  const thickness = isLocked ? clay.edge : night ? a.rim : metal.lo;
  const thicknessOpacity = !isLocked && night ? Math.min(1, a.rimOpacity + 0.3) : 1;
  return (
    <View style={[{ width: size, height: size * 1.08 }, style]} accessible accessibilityRole="image" accessibilityLabel={`${rank} rank${locked ? ', not reached yet' : ''}`}>
      <Svg width="100%" height="100%" viewBox="0 0 100 108">
        <Defs>
          {isLocked ? (
            <LinearGradient id={`${id}m`} {...LIGHT_DIR}>
              <Stop offset="0" stopColor={clay.metal[0]} />
              <Stop offset="0.5" stopColor={clay.metal[1]} />
              <Stop offset="1" stopColor={clay.metal[2]} />
            </LinearGradient>
          ) : (
            <>
              <MetalGradient id={`${id}m`} m={metal} />
              <LinearGradient id={`${id}f`} {...LIGHT_DIR}>
                <Stop offset="0" stopColor={look.darkInk ? metal.hi : metal.mid} />
                <Stop offset="1" stopColor={look.darkInk ? metal.mid : metal.lo} />
              </LinearGradient>
              <LinearGradient id={`${id}s`} {...LIGHT_DIR}>
                <Stop offset="0" stopColor={a.highlight} stopOpacity={0.4} />
                <Stop offset="0.6" stopColor={a.highlight} stopOpacity={0} />
              </LinearGradient>
              {champion ? <MetalGradient id={`${id}g`} m={METALS.gold} /> : null}
            </>
          )}
        </Defs>
        <Ellipse cx={50} cy={105.5} rx={champion ? 24 : 27} ry={2.5} fill={a.shadow} opacity={a.shadowOpacity} />
        <Crest name={name} id={id} a={a} locked={isLocked} />
        <Path d={look.body} fill={thickness} stroke={thickness} opacity={thicknessOpacity} strokeWidth={STROKE.line} strokeLinejoin="round" transform="translate(1.2 1.6)" />
        <Path d={look.body} fill={`url(#${id}m)`} stroke={frameEdge} strokeWidth={STROKE.line} strokeLinejoin="round" />
        <Path d={face} fill={isLocked ? clay.ink : metal.lo} opacity={0.5} transform="translate(-0.9 -1.2)" />
        <Path d={face} fill={a.highlight} opacity={isLocked ? 0.35 : 0.5} transform="translate(0.9 1.2)" />
        {isLocked ? (
          <Path d={face} fill={clay.ink} opacity={0.22} stroke={clay.edge} strokeWidth={STROKE.hair} strokeLinejoin="round" />
        ) : (
          <Path d={face} fill={`url(#${id}f)`} stroke={metal.rim} strokeOpacity={0.6} strokeWidth={STROKE.hair} strokeLinejoin="round" />
        )}
        {isLocked ? null : <Path d={shrink(face, 0.94, look.pivot)} fill={`url(#${id}s)`} />}
        <Ellipse cx={look.shine[0]} cy={look.shine[1]} rx={13} ry={5.5} fill={a.highlight} opacity={isLocked ? clay.shine + 0.1 : a.highlightOpacity} transform={`rotate(-38 ${look.shine[0]} ${look.shine[1]})`} />
        {isLocked ? (
          <>
            <Path d={KEYHOLE} fill={a.highlight} opacity={Math.min(0.6, clay.shine * 2 + 0.1)} transform="translate(0.8 1.4)" />
            <Path d={KEYHOLE} fill={clay.ink} />
          </>
        ) : (
          <Emboss d={symD} stroked={stroked} ink={sym.ink} shade={metal.lo} light={a.highlight} lightOpacity={0.6} />
        )}
        {!isLocked && look.studs ? <Studs points={look.studs.map((p) => stud(p, look.pivot))} r={name === 'Elite' ? 2.8 : 2.3} color={metal.rim} edge={metal.lo} /> : null}
        {champion ? <Crown id={id} a={a} locked={isLocked} /> : null}
        {name === 'Master' && !isLocked ? (
          <>
            <Path d="M50 3 L57 11 L50 20 L43 11 Z" fill={METALS.sapphire.mid} stroke={METALS.platinum.lo} strokeWidth={STROKE.line} strokeLinejoin="round" />
            <Path d="M50 5.5 L54.5 11 L50 11 Z" fill={METALS.sapphire.hi} />
          </>
        ) : null}
      </Svg>
    </View>
  );
}
