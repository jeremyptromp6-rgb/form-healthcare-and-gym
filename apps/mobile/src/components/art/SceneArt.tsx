import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { ACCENTS, art, artPalettes, FOODS, LIGHT_DIR, METALS, STROKE, useArtId, type ArtAccents, type ArtPalette, type ArtTone, type Metal } from '@/theme/artPalette';
import { colors, palettes, scheme } from '@/theme/tokens';

/**
 * Scene art for heroes and sign-in: a good morning drawn behind the words, and the same place at
 * night (a redrawn scene with a moon, stars and fireflies, not the day with a filter). Never a photo of
 * a person. Style rules: docs/art-style.md. Budget: 60 SVG elements per scene, in both tones.
 *
 * Every scene takes an optional `tone`; without it the launch scheme decides.
 */

type Tokens = typeof palettes.light;
interface Kit {
  a: ArtPalette;
  x: ArtAccents;
  t: Tokens;
  night: boolean;
}

function kitFor(tone?: ArtTone): Kit {
  if (!tone) return { a: art, x: ACCENTS[scheme], t: colors, night: scheme === 'dark' };
  return { a: artPalettes[tone], x: ACCENTS[tone], t: palettes[tone], night: tone === 'dark' };
}

const f1 = (n: number) => Math.round(n * 10) / 10;

/** Mixes two #RRGGBB colours: t = 0 is a, t = 1 is b. */
function mixHex(a: string, b: string, t: number): string {
  const ch = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  const out = [0, 1, 2].map((i) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t));
  return `#${out.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

const stroke = (color: string, width: number) => ({ stroke: color, strokeWidth: width, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' }) as const;

/** A hidden, decorative host: scenes are drawn behind the words and say nothing. */
/** Decorative art never takes touches (a style, not the deprecated prop, so the web build stays quiet). */
const NO_TOUCH = { pointerEvents: 'none' } as const;
const HIDDEN = { accessible: false, importantForAccessibility: 'no-hide-descendants', 'aria-hidden': true } as const;

/** A soft round glow: sun, moon, lantern. */
function Glow({ cx, cy, r, color, opacity }: { cx: number; cy: number; r: number; color: string; opacity: number }) {
  const id = useArtId('scGlow');
  return (
    <>
      <Defs>
        <RadialGradient id={id} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={color} stopOpacity={opacity} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={cx} cy={cy} r={r} fill={`url(#${id})`} />
    </>
  );
}

/** A four-point sparkle. */
function Sparkle({ x, y, r, color, opacity = 1 }: { x: number; y: number; r: number; color: string; opacity?: number }) {
  return <Path d={`M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r}Z`} fill={color} opacity={opacity} />;
}

/** A solid with a two-stop gradient along the light direction (top-left lit). */
function LitPath({ d, from, to, opacity }: { d: string; from: string; to: string; opacity?: number }) {
  const id = useArtId('scLit');
  return (
    <>
      <Defs>
        <LinearGradient id={id} {...LIGHT_DIR}>
          <Stop offset="0" stopColor={from} />
          <Stop offset="1" stopColor={to} />
        </LinearGradient>
      </Defs>
      <Path d={d} fill={`url(#${id})`} opacity={opacity} />
    </>
  );
}

/** A hill, drawn from its crest line down: the colour fades into haze before the visible bottom. */
function Hill({ crest, from, to, opacity = 1, stop = 0.55 }: { crest: string; from: string; to: string; opacity?: number; stop?: number }) {
  const id = useArtId('scHill');
  return (
    <>
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={from} />
          <Stop offset={stop} stopColor={to} />
        </LinearGradient>
      </Defs>
      <Path d={`${crest} V300 H-20 Z`} fill={`url(#${id})`} opacity={opacity} />
    </>
  );
}

/**
 * The crest lines that catch the light along the hills. They fade out towards the left and centre, so
 * the words that sit there are not crossed by a bright line, and show fully at the right.
 */
function CrestLines({ crests, color, widths, opacities }: { crests: readonly string[]; color: string; widths: readonly number[]; opacities: readonly number[] }) {
  const id = useArtId('scCrest');
  return (
    <>
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0.68" stopColor={color} stopOpacity={0} />
          <Stop offset="0.95" stopColor={color} stopOpacity={1} />
        </LinearGradient>
      </Defs>
      {crests.map((d, i) => (
        <Path key={`crest${i}`} d={d} fill="none" stroke={`url(#${id})`} strokeWidth={widths[i]} strokeLinecap="round" strokeLinejoin="round" opacity={opacities[i]} />
      ))}
    </>
  );
}

/** A shape that fades out towards its base, so the art melts into the card instead of ending on a line. */
function FadePath({ d, color, opacity = 1 }: { d: string; color: string; opacity?: number }) {
  const id = useArtId('scFade');
  return (
    <>
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0.35" stopColor={color} stopOpacity={opacity} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Path d={d} fill={`url(#${id})`} />
    </>
  );
}

/** The sky: the card's own colours run from the horizon glow up to a calmer top. */
function Sky({ kit, width, height }: { kit: Kit; width: number; height: number }) {
  const id = useArtId('scSky');
  const [low, , high] = kit.a.scene.sky;
  return (
    <>
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={high} />
          <Stop offset="1" stopColor={low} />
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width={width} height={height} fill={`url(#${id})`} />
    </>
  );
}

/** A cloud with volume: a lit top, a warm shaded underside. Drawn at 0,0 and moved into place. */
const CLOUD = 'M-26 0 A8 8 0 0 1 -21 -13 A12 12 0 0 1 -2 -19 A14 14 0 0 1 21 -13 A9 9 0 0 1 26 0 Z';
const CLOUD_UNDER = 'M-26 0 L-24.6 -4.6 Q0 -0.5 24.8 -4.4 L26 0 Z';

function Clouds({ kit, spots, shade = true, opacity = 1 }: { kit: Kit; spots: readonly { x: number; y: number; s: number }[]; shade?: boolean; opacity?: number }) {
  const id = useArtId('scCloud');
  const { a } = kit;
  return (
    <>
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={a.scene.cloud} />
          <Stop offset="1" stopColor={a.scene.haze} />
        </LinearGradient>
      </Defs>
      {spots.map((c, i) => (
        <Path key={`c${i}`} d={CLOUD} fill={`url(#${id})`} opacity={opacity} transform={`translate(${c.x} ${c.y}) scale(${c.s})`} />
      ))}
      {(shade ? spots : []).map((c, i) => (
        <Path key={`u${i}`} d={CLOUD_UNDER} fill={a.scene.sunGlow} opacity={0.55} transform={`translate(${c.x} ${c.y}) scale(${c.s})`} />
      ))}
    </>
  );
}

/** A crescent moon: the outer circle (cx, cy, R) minus a circle of radius r2 nudged by (ox, oy). */
function crescent(cx: number, cy: number, R: number, ox: number, oy: number, r2: number): string {
  const d = Math.hypot(ox, oy);
  const along = (R * R - r2 * r2 + d * d) / (2 * d);
  const half = Math.sqrt(R * R - along * along);
  const mx = cx + (along * ox) / d;
  const my = cy + (along * oy) / d;
  const p1 = `${f1(mx - (half * oy) / d)} ${f1(my + (half * ox) / d)}`;
  const p2 = `${f1(mx + (half * oy) / d)} ${f1(my - (half * ox) / d)}`;
  return `M${p1} A${R} ${R} 0 1 0 ${p2} A${r2} ${r2} 0 1 1 ${p1} Z`;
}

/** The moon: a glow, a lit crescent and a crater or two. */
function Moon({ kit, cx, cy, R, glow = 3.2 }: { kit: Kit; cx: number; cy: number; R: number; glow?: number }) {
  const { a } = kit;
  return (
    <>
      <Glow cx={cx} cy={cy} r={R * glow} color={a.scene.sunGlow} opacity={0.3} />
      <LitPath d={crescent(cx, cy, R, R * 0.62, -R * 0.3, R * 0.86)} from={a.scene.moon} to={a.scene.sunGlow} />
    </>
  );
}

/** A pinprick star. */
function Star({ x, y, r, kit, opacity = 0.9 }: { x: number; y: number; r: number; kit: Kit; opacity?: number }) {
  return <Circle cx={x} cy={y} r={r} fill={kit.a.scene.star} opacity={opacity} />;
}

/** A firefly: a warm speck with a halo. */
function Firefly({ x, y, kit }: { x: number; y: number; kit: Kit }) {
  return (
    <>
      <Circle cx={x} cy={y} r={4.5} fill={kit.x.sparkleHoney} opacity={0.22} />
      <Circle cx={x} cy={y} r={1.4} fill={kit.x.sparkleCream} />
    </>
  );
}

/** A round tree: foliage on a short trunk, lit top-left. */
function Tree({ x, y, s, kit }: { x: number; y: number; s: number; kit: Kit }) {
  return (
    <>
      <Path d={`M${x} ${y} V${f1(y - 5 * s)}`} {...stroke(METALS.wood.lo, STROKE.bold)} />
      <Ellipse cx={x} cy={f1(y - 10 * s)} rx={f1(6.5 * s)} ry={f1(8 * s)} fill={kit.a.leaf.deep} />
      <Ellipse cx={f1(x - 1.6 * s)} cy={f1(y - 12 * s)} rx={f1(3.6 * s)} ry={f1(4.4 * s)} fill={kit.a.leaf.light} opacity={0.75} />
    </>
  );
}

/** A metal solid: hi to mid to lo along the light direction. */
function MetalPath({ d, metal, opacity }: { d: string; metal: Metal; opacity?: number }) {
  const id = useArtId('scMetal');
  return (
    <>
      <Defs>
        <LinearGradient id={id} {...LIGHT_DIR}>
          <Stop offset="0" stopColor={metal.hi} />
          <Stop offset="0.5" stopColor={metal.mid} />
          <Stop offset="1" stopColor={metal.lo} />
        </LinearGradient>
      </Defs>
      <Path d={d} fill={`url(#${id})`} opacity={opacity} />
    </>
  );
}

/* ---------------------------------------------------------------- Home */

const HOME_CREST = {
  far: 'M-20 140 C26 112 70 114 112 130 C152 146 190 108 236 112 C266 114 292 126 320 120',
  mid: 'M-20 178 C36 152 92 154 142 170 C192 186 232 154 290 158 C304 159 314 162 320 164',
  near: 'M-20 218 C50 190 112 198 172 210 C222 220 272 192 320 188',
} as const;

/** The trail winding over the near hill at the right, away from the words, narrowing into the distance. */
const HOME_TRAIL_POINTS = [[238, 197], [210, 224], [266, 246], [226, 300]] as const;
const HOME_TRAIL = trailShape(HOME_TRAIL_POINTS, 2, 36);

/** A trail seen across a hill: a cubic through four points, widening towards the viewer, as one closed shape. */
function trailShape(p: readonly (readonly [number, number])[], w0: number, w1: number, steps = 18): string {
  const [a, b, c, d] = p as [[number, number], [number, number], [number, number], [number, number]];
  const left: string[] = [];
  const right: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const x = u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0];
    const y = u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1];
    const half = (w0 + (w1 - w0) * t ** 1.3) / 2;
    left.push(`${f1(x - half)} ${f1(y)}`);
    right.push(`${f1(x + half)} ${f1(y)}`);
  }
  return `M${left.join(' L')} L${right.reverse().join(' L')} Z`;
}

/**
 * The Home hills, as the fills they are drawn with (crest colour, then the colour they fade to). The
 * words sit over the left and centre of these hills, so by day each is tinted towards the haze until
 * the muted text colour reads at 4.5:1 or better on every one of them (SceneArt.test.tsx asserts it,
 * in both tones). At night the palette hills are already dark enough. They are drawn at or below full
 * opacity over lighter sky, which only lightens them, so the solid fills are the worst case.
 */
export function ringsHills(tone?: ArtTone) {
  const { a, night } = kitFor(tone);
  const { hillFar, hillMid, hillNear, haze } = a.scene;
  if (night) {
    return { far: { from: hillFar, to: haze }, mid: { from: hillMid, to: hillFar }, near: { from: hillNear, to: hillMid } };
  }
  const far = mixHex(hillFar, haze, 0.15);
  const mid = mixHex(hillMid, haze, 0.3);
  return { far: { from: far, to: haze }, mid: { from: mid, to: haze }, near: { from: mixHex(hillNear, haze, 0.5), to: mid } };
}

const HOME_RING_R = [32, 39, 46] as const;
const HOME_SUN = { x: 250, y: 50 } as const;

/** Home: the sun coming up over the hills, or the same hills under a crescent moon. Today is a fresh start. */
export function RingsArt({ style, tone }: { style?: StyleProp<ViewStyle>; tone?: ArtTone }) {
  const kit = kitFor(tone);
  const { a, night, t } = kit;
  const sunId = useArtId('scSun');
  const hills = ringsHills(tone);
  return (
    <View style={[style, NO_TOUCH]} {...HIDDEN}>
      <Svg width="100%" height="100%" viewBox="0 0 300 300" preserveAspectRatio="xMaxYMin slice">
        <Sky kit={kit} width={300} height={300} />
        <FadePath d="M-20 120 C26 94 70 98 116 114 C158 128 196 94 250 100 C282 104 300 110 320 106 V210 H-20 Z" color={a.scene.haze} opacity={night ? 0.55 : 0.95} />
        {night ? (
          <>
            <Moon kit={kit} cx={HOME_SUN.x} cy={HOME_SUN.y} R={22} />
            <Clouds kit={kit} shade={false} opacity={0.75} spots={[{ x: 120, y: 84, s: 1.1 }, { x: 214, y: 112, s: 0.7 }]} />
            <Star x={34} y={26} r={1.3} kit={kit} />
            <Star x={84} y={62} r={1} kit={kit} opacity={0.7} />
            <Star x={124} y={22} r={1.7} kit={kit} />
            <Star x={176} y={64} r={1.1} kit={kit} opacity={0.75} />
            <Star x={206} y={26} r={1.4} kit={kit} opacity={0.8} />
            <Star x={22} y={92} r={0.9} kit={kit} opacity={0.6} />
            <Sparkle x={150} y={40} r={5} color={a.scene.star} />
            <Sparkle x={172} y={14} r={3.2} color={a.scene.star} opacity={0.8} />
          </>
        ) : (
          <>
            <Glow cx={HOME_SUN.x} cy={HOME_SUN.y} r={96} color={a.scene.sunGlow} opacity={a.scene.glowOpacity} />
            {HOME_RING_R.map((r, i) => {
              const c = 2 * Math.PI * r;
              const share = [0.78, 0.62, 0.46][i]!;
              return (
                <Circle
                  key={r}
                  cx={HOME_SUN.x}
                  cy={HOME_SUN.y}
                  r={r}
                  {...stroke([t.primary, t.accent, t.success][i]!, STROKE.bold)}
                  opacity={0.5}
                  strokeDasharray={`${f1(c * share)} ${f1(c)}`}
                  transform={`rotate(-90 ${HOME_SUN.x} ${HOME_SUN.y})`}
                />
              );
            })}
            <Defs>
              <LinearGradient id={sunId} {...LIGHT_DIR}>
                <Stop offset="0" stopColor={a.scene.sunGlow} />
                <Stop offset="1" stopColor={a.scene.sun} />
              </LinearGradient>
            </Defs>
            <Circle cx={HOME_SUN.x} cy={HOME_SUN.y} r={21} fill={`url(#${sunId})`} />
            <Ellipse cx={HOME_SUN.x - 7} cy={HOME_SUN.y - 8} rx={8} ry={5} fill={a.highlight} opacity={a.highlightOpacity} transform={`rotate(-30 ${HOME_SUN.x - 7} ${HOME_SUN.y - 8})`} />
            <Clouds
              kit={kit}
              spots={[
                { x: 138, y: 56, s: 1 },
                { x: 270, y: 112, s: 0.66 },
              ]}
            />
            <Path d="M200 20 q4 -5 8 0 q4 -5 8 0 M222 32 q3 -4 6 0 q3 -4 6 0" {...stroke(a.ink, STROKE.hair)} opacity={0.5} />
            <Sparkle x={196} y={64} r={5} color={t.accent} opacity={0.7} />
            <Sparkle x={290} y={20} r={4} color={kit.x.sparkleCoral} />
          </>
        )}
        <Hill crest={HOME_CREST.far} from={hills.far.from} to={hills.far.to} opacity={night ? 1 : 0.8} />
        <Hill crest={HOME_CREST.mid} from={hills.mid.from} to={hills.mid.to} opacity={night ? 1 : 0.92} />
        <Tree x={286} y={160} s={0.8} kit={kit} />
        <Tree x={296} y={162} s={0.58} kit={kit} />
        <Hill crest={HOME_CREST.near} from={hills.near.from} to={hills.near.to} opacity={night ? 1 : 0.78} stop={0.4} />
        <Path d={HOME_TRAIL} fill={a.scene.hillFar} opacity={night ? 0.7 : 0.85} />
        {night ? (
          <>
            <CrestLines crests={[HOME_CREST.far, HOME_CREST.mid, HOME_CREST.near]} color={t.water} widths={[STROKE.hair, STROKE.line, STROKE.line]} opacities={[0.35, 0.4, 0.5]} />
            <Firefly x={92} y={226} kit={kit} />
            <Firefly x={236} y={210} kit={kit} />
            <Firefly x={274} y={178} kit={kit} />
          </>
        ) : (
          <>
            <CrestLines crests={[HOME_CREST.mid, HOME_CREST.near]} color={a.highlight} widths={[STROKE.line, STROKE.line]} opacities={[0.5, 0.5]} />
            <Circle cx={218} cy={246} r={2.2} fill={kit.x.sparkleCoral} />
            <Circle cx={228} cy={250} r={1.8} fill={a.scene.cloud} />
            <Circle cx={252} cy={236} r={2} fill={a.scene.cloud} />
          </>
        )}
      </Svg>
    </View>
  );
}

/* ------------------------------------------------------------ Progress */

/** The summit and the mountain's half-width at height y: the flanks run straight down from the peak. */
const PEAK = { x: 212, y: 56 } as const;
const half = (y: number) => 3 + (y - PEAK.y) * 0.78;
const xl = (y: number) => f1(PEAK.x - half(y));
const xr = (y: number) => f1(PEAK.x + half(y));

/** The terraces, bottom to top: [bottom y, top y, inset of the bottom edge]. Each band overlaps the one below. */
const BANDS = [
  [196, 150, 0],
  [160, 116, 7],
  [126, 88, 7],
  [96, 66, 6],
] as const;

/** One terrace: sloped sides, and a front lip that bows towards the viewer. */
function bandPath(bottom: number, top: number, inset: number): string {
  return `M${f1(+xl(bottom) + inset)} ${bottom} L${xl(top)} ${top} H${xr(top)} L${f1(+xr(bottom) - inset)} ${bottom} Q${PEAK.x} ${bottom + 7} ${f1(+xl(bottom) + inset)} ${bottom} Z`;
}

/** The switchbacks up the mountain, a dotted route that turns at each terrace. */
const ROUTE: readonly (readonly [number, number])[] = [
  [168, 190],
  [262, 176],
  [172, 150],
  [250, 136],
  [186, 112],
  [236, 98],
  [196, 80],
  [224, 70],
  [PEAK.x, PEAK.y + 6],
];
const ROUTE_D = `M${ROUTE.map(([x, y]) => `${x} ${y}`).join(' L')}`;

/** Progress: a terraced climb to a summit flag. Drawn without a sky, because it is shown faded over a card. */
export function ProgressArt({ style, tone }: { style?: StyleProp<ViewStyle>; tone?: ArtTone }) {
  const kit = kitFor(tone);
  const { a, night, t } = kit;
  const tints = [a.scene.hillNear, a.scene.hillMid, a.scene.hillFar, a.scene.haze] as const;
  return (
    <View style={[style, NO_TOUCH]} {...HIDDEN}>
      <Svg width="100%" height="100%" viewBox="0 0 300 200" preserveAspectRatio="xMaxYMid slice">
        {night ? (
          <>
            <Moon kit={kit} cx={276} cy={38} R={12} glow={3.2} />
            <Star x={166} y={30} r={1.5} kit={kit} />
            <Star x={190} y={54} r={1} kit={kit} opacity={0.7} />
            <Star x={138} y={76} r={1.2} kit={kit} opacity={0.8} />
            <Sparkle x={152} y={46} r={4.5} color={a.scene.star} />
          </>
        ) : (
          <>
            <Glow cx={PEAK.x} cy={PEAK.y + 6} r={96} color={a.scene.sunGlow} opacity={a.scene.glowOpacity} />
            <Sparkle x={160} y={50} r={6} color={kit.x.sparkleHoney} />
            <Sparkle x={286} y={76} r={4} color={kit.x.sparkleCoral} />
          </>
        )}
        <FadePath d="M30 196 L98 104 Q110 90 122 104 L190 196 Z" color={a.scene.hillFar} opacity={0.9} />
        <FadePath d="M70 196 L150 126 Q160 118 170 126 L236 196 Z" color={a.scene.hillMid} opacity={0.7} />
        <FadePath d={bandPath(...BANDS[0])} color={tints[0]} />
        {BANDS.slice(1).map(([bottom, top, inset], i) => (
          <LitPath key={bottom} d={bandPath(bottom, top, inset)} from={tints[i + 1]!} to={tints[i]!} />
        ))}
        {BANDS.slice(1).map(([bottom, , inset]) => (
          <Path key={`l${bottom}`} d={`M${f1(+xl(bottom) + inset + 2)} ${bottom - 0.5} Q${PEAK.x} ${bottom + 6.5} ${f1(+xr(bottom) - inset - 2)} ${bottom - 0.5}`} {...stroke(night ? t.water : a.highlight, STROKE.line)} opacity={night ? 0.4 : a.highlightOpacity + 0.3} />
        ))}
        <LitPath d={`M${xl(72)} 72 L${PEAK.x} ${PEAK.y} L${xr(72)} 72 L${f1(PEAK.x + 7)} 67 L${f1(PEAK.x + 1)} 73 L${f1(PEAK.x - 6)} 67 Z`} from={night ? a.scene.moon : a.scene.cloud} to={a.scene.haze} />
        <Path d={ROUTE_D} {...stroke(t.primary, STROKE.bold)} strokeDasharray="0.1 7" />
        {ROUTE.slice(1, -1)
          .filter((_, i) => i % 2 === 0)
          .map(([x, y]) => (
            <Circle key={`${x}`} cx={x} cy={y} r={3.6} fill={t.onPrimary} stroke={t.primary} strokeWidth={STROKE.line} />
          ))}
        <Path d={`M${PEAK.x} ${PEAK.y} V22`} {...stroke(night ? kit.x.sparkleCream : a.ink, STROKE.bold)} />
        <Path d={`M${PEAK.x} 23 L${PEAK.x + 22} 29.5 L${PEAK.x} 36 Z`} fill={t.primary} stroke={t.primary} strokeWidth={STROKE.line} strokeLinejoin="round" />
      </Svg>
    </View>
  );
}

/* ---------------------------------------------------------------- Trophy */

/** A gold trophy for a beaten record: a bevelled cup with handles on a plinth. */
export function TrophyArt({ size = 72, tone }: { size?: number; tone?: ArtTone }) {
  const kit = kitFor(tone);
  const { a, x } = kit;
  const gold = METALS.gold;
  const bronze = METALS.bronze;
  const cup = 'M21 10 H59 V25 C59 38 50 46 40 46 C30 46 21 38 21 25 Z';
  const star = Array.from({ length: 10 }, (_, i) => {
    const ang = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 === 0 ? 8 : 3.6;
    return `${f1(40 + rr * Math.cos(ang))},${f1(26 + rr * Math.sin(ang))}`;
  });
  return (
    <View style={{ width: size, height: size }} {...HIDDEN}>
      <Svg width="100%" height="100%" viewBox="0 0 80 80">
        <Glow cx={40} cy={38} r={38} color={a.scene.sunGlow} opacity={a.scene.glowOpacity * 0.55} />
        <Ellipse cx={40} cy={74} rx={21} ry={2.8} fill={a.shadow} opacity={a.shadowOpacity} />
        <MetalPath d="M23 65 H57 V71 Q57 73 55 73 H25 Q23 73 23 71 Z" metal={bronze} />
        <MetalPath d="M28 58 H52 V65 H28 Z" metal={bronze} />
        <Rect x={34} y={60} width={12} height={3} rx={1.5} fill={gold.mid} />
        <MetalPath d="M35 48 H45 L48 58 H32 Z" metal={gold} />
        <Ellipse cx={40} cy={48} rx={8.5} ry={2.4} fill={gold.hi} />
        <Path d="M22 15 H15 C8 15 9 31 25 34 M58 15 H65 C72 15 71 31 55 34" {...stroke(gold.mid, STROKE.heavy)} />
        <Path d="M21 14.5 H15 C11 14.5 11 24 16 28" {...stroke(gold.hi, STROKE.hair)} />
        <MetalPath d={cup} metal={gold} />
        <Ellipse cx={40} cy={10} rx={19} ry={4.2} fill={gold.rim} />
        <Ellipse cx={40} cy={10.6} rx={15.5} ry={2.8} fill={gold.lo} />
        <Path d="M25 14 H31 C29 24 31 34 37 42 C28 38 24 28 25 14 Z" fill={a.highlight} opacity={a.highlightOpacity + 0.06} />
        <Path d={`M${star.join(' L')} Z`} fill={gold.lo} opacity={0.6} />
        <Path d="M57 26 C56 36 49 44 40 44.5" {...stroke(gold.rim, STROKE.hair)} opacity={0.7} />
        <Sparkle x={67} y={12} r={5} color={x.sparkleCoral} />
        <Sparkle x={13} y={44} r={3.2} color={x.sparkleHoney} />
      </Svg>
    </View>
  );
}

/* ------------------------------------------------------------- FormMark */

/**
 * The FORM mark: a terracotta tile, a crisp cream F and a warm dot. Used at sign-in and as the app's signature.
 * It is a brand mark, so it looks the same in both tones (always the light palette's coral tile and white F):
 * `tone` is accepted for symmetry with the other art and changes nothing.
 */
export function FormMark({ size = 48 }: { size?: number; tone?: ArtTone }) {
  const a = artPalettes.light;
  const t = palettes.light;
  const id = useArtId('scMark');
  const letter = 'M14.5 35 V13.5 H33 M14.5 24.5 H26.5';
  return (
    <View style={{ width: size, height: size }} accessible accessibilityRole="image" accessibilityLabel="FORM">
      <Svg width="100%" height="100%" viewBox="0 0 48 48">
        <Defs>
          <LinearGradient id={id} {...LIGHT_DIR}>
            <Stop offset="0" stopColor={t.primary} />
            <Stop offset="1" stopColor={t.primaryDeep} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={48} height={48} rx={15} fill={`url(#${id})`} />
        <Ellipse cx={15} cy={9} rx={13} ry={5.5} fill={a.highlight} opacity={a.highlightOpacity * 0.7} transform="rotate(-24 15 9)" />
        <Rect x={0.5} y={0.5} width={47} height={47} rx={14.5} {...stroke(a.highlight, STROKE.hair)} opacity={a.highlightOpacity} />
        <Path d={letter} {...stroke(a.shadow, STROKE.heavy)} opacity={a.shadowOpacity + 0.12} transform="translate(0.8 1.4)" />
        <Path d={letter} {...stroke(t.onPrimary, STROKE.heavy)} />
        <Circle cx={34} cy={34.5} r={4.4} fill={a.scene.sunGlow} />
        <Circle cx={32.8} cy={33.2} r={1.5} fill={a.highlight} opacity={0.7} />
      </Svg>
    </View>
  );
}

/* --------------------------------------------------------------- Welcome */

const WELCOME_CREST = {
  far: 'M-20 130 C30 100 84 98 134 118 C184 136 238 104 320 112',
  mid: 'M-20 160 C50 134 116 138 178 154 C228 168 270 144 320 146',
  near: 'M-20 190 C60 166 140 168 204 180 C256 190 296 176 320 172',
} as const;

/** The kettlebell: an iron body on a flat base with a thick handle, lit top-left. */
function Kettlebell({ kit, night }: { kit: Kit; night: boolean }) {
  const { a } = kit;
  const iron = METALS.iron;
  return (
    <>
      <Ellipse cx={208} cy={181} rx={20} ry={3.2} fill={a.shadow} opacity={a.shadowOpacity + 0.04} />
      <Path d="M197 150 C194 128 220 128 217 150" {...stroke(night ? iron.mid : iron.lo, STROKE.heavy)} />
      <Path d="M196.5 146 C196 134 204 131 209 131.5" {...stroke(iron.hi, STROKE.hair)} opacity={0.8} />
      {night ? <Path d="M216 144 C217 138 214 133 210 131" {...stroke(a.rim, STROKE.hair)} opacity={a.rimOpacity + 0.2} /> : null}
      <MetalPath d="M193 176 A17 17 0 1 1 223 176 Q208 183 193 176 Z" metal={iron} />
      <Ellipse cx={201} cy={158} rx={6} ry={3.6} fill={a.highlight} opacity={a.highlightOpacity} transform="rotate(-30 201 158)" />
      <Path d="M221 160 C221 168 217 175 211 178" {...stroke(night ? a.rim : iron.rim, STROKE.hair)} opacity={night ? a.rimOpacity + 0.2 : 0.7} />
    </>
  );
}

/** The apple: a lit red body, a stem and a leaf. */
function Apple({ kit, night }: { kit: Kit; night: boolean }) {
  const { a } = kit;
  return (
    <>
      <Ellipse cx={243} cy={181} rx={12} ry={2.4} fill={a.shadow} opacity={a.shadowOpacity + 0.04} />
      <LitPath d="M243 165 C239 162 232 164 232 171 C232 178 237 183 243 181 C249 183 254 178 254 171 C254 164 247 162 243 165 Z" from={FOODS.appleLight!} to={FOODS.appleDark!} />
      <Ellipse cx={238} cy={168} rx={3.2} ry={2.2} fill={a.highlight} opacity={a.highlightOpacity + 0.07} transform="rotate(-35 238 168)" />
      <Path d="M243 165 Q243 160 246 157" {...stroke(FOODS.appleStem!, STROKE.line)} />
      <Path d="M246 160 Q251 156 256 158 Q252 163 246 160 Z" fill={FOODS.sceneAppleLeaf} />
      <Path d="M252 175 C250 179 247 181 244 181.5" {...stroke(night ? a.rim : FOODS.appleLight!, STROKE.hair)} opacity={night ? a.rimOpacity + 0.2 : 0.55} />
    </>
  );
}

/** A little lantern that lights the grass at night. */
function Lantern({ kit }: { kit: Kit }) {
  const { a, x } = kit;
  const brass = METALS.brass;
  return (
    <>
      <Glow cx={168} cy={170} r={48} color={x.sparkleHoney} opacity={0.4} />
      <Path d="M161 156 Q168 146 175 156" {...stroke(brass.lo, STROKE.line)} />
      <MetalPath d="M162 158 H174 L176 162 H160 Z" metal={brass} />
      <Rect x={162} y={162} width={12} height={14} rx={2.5} fill={x.sparkleHoney} />
      <Rect x={163.5} y={163.5} width={4} height={11} rx={1.5} fill={x.sparkleCream} opacity={0.7} />
      <MetalPath d="M160 176 H176 L175 179 H161 Z" metal={brass} />
      <Ellipse cx={168} cy={180.5} rx={9} ry={1.8} fill={a.shadow} opacity={a.shadowOpacity} />
    </>
  );
}

/** Sign-in: sunrise over the hills with a kettlebell and an apple on the grass (train and eat, gently), or the same spot lit by a lantern. */
export function WelcomeArt({ style, tone }: { style?: StyleProp<ViewStyle>; tone?: ArtTone }) {
  const kit = kitFor(tone);
  const { a, night, x } = kit;
  const sunId = useArtId('scSun');
  return (
    <View style={[style, NO_TOUCH]} {...HIDDEN}>
      <Svg width="100%" height="100%" viewBox="0 0 300 220" preserveAspectRatio="xMidYMid slice">
        <Sky kit={kit} width={300} height={220} />
        {night ? (
          <>
            <Moon kit={kit} cx={198} cy={76} R={27} />
            <Star x={40} y={34} r={1.4} kit={kit} />
            <Star x={92} y={22} r={1.8} kit={kit} />
            <Star x={132} y={66} r={1.1} kit={kit} opacity={0.75} />
            <Star x={268} y={30} r={1.5} kit={kit} />
            <Star x={252} y={78} r={1} kit={kit} opacity={0.7} />
            <Star x={22} y={80} r={1} kit={kit} opacity={0.65} />
            <Sparkle x={150} y={38} r={5} color={a.scene.star} />
            <Sparkle x={282} y={62} r={3.4} color={a.scene.star} opacity={0.8} />
          </>
        ) : (
          <>
            <Glow cx={198} cy={78} r={112} color={a.scene.sunGlow} opacity={a.scene.glowOpacity} />
            <Defs>
              <LinearGradient id={sunId} {...LIGHT_DIR}>
                <Stop offset="0" stopColor={a.scene.sunGlow} />
                <Stop offset="1" stopColor={a.scene.sun} />
              </LinearGradient>
            </Defs>
            <Circle cx={198} cy={78} r={30} fill={`url(#${sunId})`} />
            <Ellipse cx={188} cy={68} rx={11} ry={7} fill={a.highlight} opacity={a.highlightOpacity} transform="rotate(-30 188 68)" />
            <Clouds
              kit={kit}
              spots={[
                { x: 112, y: 54, s: 1.05 },
                { x: 270, y: 100, s: 0.66 },
              ]}
            />
            <Sparkle x={256} y={38} r={6} color={x.sparkleCoral} />
            <Sparkle x={94} y={100} r={5} color={x.sparkleHoney} />
          </>
        )}
        <Hill crest={WELCOME_CREST.far} from={a.scene.hillFar} to={a.scene.haze} opacity={night ? 1 : 0.85} />
        <Tree x={268} y={120} s={1} kit={kit} />
        <Tree x={284} y={121} s={0.72} kit={kit} />
        <Hill crest={WELCOME_CREST.mid} from={a.scene.hillMid} to={night ? a.scene.hillFar : a.scene.haze} opacity={night ? 1 : 0.95} />
        <Hill crest={WELCOME_CREST.near} from={a.scene.hillNear} to={a.scene.hillMid} stop={0.5} opacity={night ? 1 : 0.85} />
        {night ? (
          <>
            <Path d={WELCOME_CREST.far} {...stroke(kit.t.water, STROKE.hair)} opacity={0.35} />
            <Path d={WELCOME_CREST.mid} {...stroke(kit.t.water, STROKE.line)} opacity={0.4} />
            <Path d={WELCOME_CREST.near} {...stroke(kit.t.water, STROKE.line)} opacity={0.45} />
            <Lantern kit={kit} />
          </>
        ) : (
          <>
            <Path d={WELCOME_CREST.mid} {...stroke(a.highlight, STROKE.line)} opacity={0.5} />
            <Path d={WELCOME_CREST.near} {...stroke(a.highlight, STROKE.line)} opacity={0.5} />
          </>
        )}
        <Kettlebell kit={kit} night={night} />
        <Apple kit={kit} night={night} />
        {night ? (
          <>
            <Firefly x={120} y={150} kit={kit} />
            <Firefly x={282} y={150} kit={kit} />
          </>
        ) : (
          <>
            <Circle cx={150} cy={188} r={2.2} fill={x.sparkleCoral} />
            <Circle cx={160} cy={192} r={1.8} fill={a.scene.cloud} />
            <Circle cx={274} cy={186} r={2} fill={a.scene.cloud} />
          </>
        )}
      </Svg>
    </View>
  );
}
