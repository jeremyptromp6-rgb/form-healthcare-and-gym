import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { Buddy, type BuddyMood } from './Buddy';
import { ACCENTS, art, artPalettes, LIGHT_DIR, METALS, STROKE, useArtId, type ArtAccents, type ArtPalette, type ArtTone, type Metal } from '@/theme/artPalette';
import { colors, palettes, scheme } from '@/theme/tokens';

/**
 * The small scene behind empty, error and permission screens: a 120x120 prop with Pip standing in
 * front of it. Purely decorative (the screen's text says everything). Style rules: docs/art-style.md.
 * Budget: 40 SVG elements for the prop, plus Pip.
 */

export type StateArtKind = 'generic' | 'noWorkouts' | 'noRecords' | 'groceryEmpty' | 'notFound' | 'offline' | 'serverError' | 'cameraPermission' | 'unavailable';

export const STATE_ART_KINDS: readonly StateArtKind[] = ['generic', 'noWorkouts', 'noRecords', 'groceryEmpty', 'notFound', 'offline', 'serverError', 'cameraPermission', 'unavailable'];

const MOOD: Record<StateArtKind, BuddyMood> = {
  generic: 'happy',
  noWorkouts: 'rest',
  noRecords: 'thinking',
  groceryEmpty: 'happy',
  notFound: 'thinking',
  offline: 'worried',
  serverError: 'worried',
  cameraPermission: 'thinking',
  unavailable: 'sleepy',
};

/** Pip's share of the square: big enough to read at 64, small enough to leave the prop room on the right. */
const PIP = 0.68;

type Tokens = typeof palettes.light;
interface Kit {
  a: ArtPalette;
  x: ArtAccents;
  t: Tokens;
}

const stroke = (color: string, width: number) => ({ stroke: color, strokeWidth: width, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' }) as const;
const outline = (kit: Kit) => ({ stroke: kit.a.ink, strokeWidth: STROKE.line, strokeLinejoin: 'round' }) as const;

function Sparkle({ x, y, r, color }: { x: number; y: number; r: number; color: string }) {
  return <Path d={`M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r}Z`} fill={color} />;
}

/** A two-stop gradient along the light direction, for any solid bigger than about 12 units. */
function Grad({ id, from, to }: { id: string; from: string; to: string }) {
  return (
    <LinearGradient id={id} {...LIGHT_DIR}>
      <Stop offset="0" stopColor={from} />
      <Stop offset="1" stopColor={to} />
    </LinearGradient>
  );
}

/** A metal as hi to mid to lo (the one allowed three-stop recipe). */
function MetalGrad({ id, metal }: { id: string; metal: Metal }) {
  return (
    <LinearGradient id={id} {...LIGHT_DIR}>
      <Stop offset="0" stopColor={metal.hi} />
      <Stop offset="0.5" stopColor={metal.mid} />
      <Stop offset="1" stopColor={metal.lo} />
    </LinearGradient>
  );
}

/** A yoga mat in soft perspective under Pip. */
function Mat({ kit }: { kit: Kit }) {
  const id = useArtId('stMat');
  return (
    <>
      <Defs>
        <Grad id={id} from={kit.a.leaf.light} to={kit.a.leaf.deep} />
      </Defs>
      <Path d="M12 105 L100 105 L117 115 L1 115 Z" fill={`url(#${id})`} {...outline(kit)} />
      <Path d="M22 108.5 L96 108.5" {...stroke(kit.a.highlight, STROKE.line)} opacity={kit.a.highlightOpacity + 0.1} />
    </>
  );
}

function Generic({ kit }: { kit: Kit }) {
  const { x, t } = kit;
  return (
    <>
      <Mat kit={kit} />
      <Sparkle x={90} y={34} r={9} color={x.sparkleHoney} />
      <Sparkle x={108} y={56} r={5} color={x.sparkleCoral} />
      <Sparkle x={76} y={14} r={4} color={x.sparkleHoney} />
      <Rect x={98} y={76} width={11} height={25} rx={4} fill={t.water} {...outline(kit)} />
      <Rect x={100.5} y={71} width={6} height={6} rx={2} fill={kit.a.peach.foot} {...outline(kit)} />
      <Path d="M101.5 82 V92" {...stroke(kit.a.highlight, STROKE.line)} opacity={kit.a.highlightOpacity + 0.25} />
    </>
  );
}

function NoWorkouts({ kit }: { kit: Kit }) {
  const id = useArtId('stDb');
  const iron = METALS.iron;
  return (
    <>
      <Defs>
        <MetalGrad id={id} metal={iron} />
      </Defs>
      <Mat kit={kit} />
      <Ellipse cx={92} cy={110} rx={22} ry={3} fill={kit.a.shadow} opacity={kit.a.shadowOpacity + 0.1} />
      <Rect x={74} y={86} width={7} height={22} rx={3} fill={`url(#${id})`} {...outline(kit)} />
      <Rect x={103} y={86} width={7} height={22} rx={3} fill={`url(#${id})`} {...outline(kit)} />
      <Rect x={80} y={91} width={5} height={12} rx={1.5} fill={`url(#${id})`} {...outline(kit)} />
      <Rect x={99} y={91} width={5} height={12} rx={1.5} fill={`url(#${id})`} {...outline(kit)} />
      <Rect x={84} y={95} width={16} height={4.5} rx={2} fill={METALS.chrome.mid} {...outline(kit)} />
      <Path d="M76.5 89 V97" {...stroke(iron.rim, STROKE.line)} />
      <Path d="M105.5 89 V97" {...stroke(iron.rim, STROKE.line)} />
      <Sparkle x={96} y={72} r={4.5} color={kit.x.sparkleHoney} />
    </>
  );
}

function NoRecords({ kit }: { kit: Kit }) {
  const { a } = kit;
  const dash = { strokeDasharray: '4 4' } as const;
  return (
    <>
      <Rect x={67} y={100} width={17} height={13} rx={2} fill={a.scene.cloud} {...outline(kit)} />
      <Rect x={84} y={90} width={17} height={23} rx={2} fill={a.scene.cloud} {...outline(kit)} />
      <Rect x={101} y={104} width={17} height={9} rx={2} fill={a.scene.cloud} {...outline(kit)} />
      <Path d="M70 103.5 H81 M87 93.5 H98 M104 107.5 H115" {...stroke(a.highlight, STROKE.line)} opacity={a.highlightOpacity + 0.1} />
      <Path d="M83 56 H102 V66 C102 76 97 80 92.5 80 C88 80 83 76 83 66 Z" {...stroke(a.state.generic, STROKE.line)} {...dash} />
      <Path d="M83 59 C75 59 75 70 85 72 M102 59 C110 59 110 70 100 72" {...stroke(a.state.generic, STROKE.line)} {...dash} />
      <Path d="M92.5 80 V86 M86 87 H99" {...stroke(a.state.generic, STROKE.line)} />
      <Sparkle x={112} y={46} r={5} color={kit.x.sparkleHoney} />
      <Sparkle x={74} y={52} r={3.5} color={kit.x.sparkleCoral} />
    </>
  );
}

function GroceryEmpty({ kit }: { kit: Kit }) {
  const id = useArtId('stBasket');
  const wood = METALS.wood;
  return (
    <>
      <Defs>
        <MetalGrad id={id} metal={wood} />
      </Defs>
      <Path d="M76 79 C76 50 108 50 108 79" {...stroke(wood.lo, STROKE.bold)} />
      <Path d="M71 81 L113 81 L106 111 L78 111 Z" fill={`url(#${id})`} {...outline(kit)} />
      <Rect x={68} y={76} width={48} height={8} rx={4} fill={wood.hi} {...outline(kit)} />
      <Ellipse cx={92} cy={80.5} rx={19} ry={2.2} fill={kit.a.ink} opacity={0.35} />
      <Path d="M73 92 H111 M75 102 H109" {...stroke(wood.lo, STROKE.hair)} />
      <Path d="M84 84 L81.5 110 M92 84 V110.5 M100 84 L102.5 110" {...stroke(wood.lo, STROKE.hair)} />
      <Path d="M75 87 L77 96" {...stroke(wood.rim, STROKE.line)} />
      <Sparkle x={108} y={38} r={5} color={kit.x.sparkleHoney} />
      <Sparkle x={74} y={46} r={3.5} color={kit.x.sparkleCoral} />
    </>
  );
}

function NotFound({ kit }: { kit: Kit }) {
  const id = useArtId('stPin');
  const { t, a, x } = kit;
  return (
    <>
      <Defs>
        <Grad id={id} from={t.primary} to={t.primaryDeep} />
      </Defs>
      <Ellipse cx={92} cy={107} rx={13} ry={3} fill={a.shadow} opacity={a.shadowOpacity + 0.05} />
      <Path d="M92 98 C80 82 72 74 72 60 A20 20 0 0 1 112 60 C112 74 104 82 92 98 Z" fill={`url(#${id})`} {...outline(kit)} />
      <Ellipse cx={82} cy={46} rx={5} ry={3} fill={a.highlight} opacity={a.highlightOpacity + 0.07} transform="rotate(-35 82 46)" />
      <Circle cx={92} cy={60} r={11.5} fill={x.eyeShine} stroke={a.ink} strokeWidth={STROKE.line} />
      <Path d="M87.5 56 q0 -5 4.5 -5 q4.5 0 4.5 4.2 q0 2.8 -3.2 3.8 q-1.3 0.7 -1.3 2.6" {...stroke(t.primary, STROKE.bold)} />
      <Circle cx={92} cy={65.8} r={1.6} fill={t.primary} />
      <Sparkle x={111} y={30} r={4} color={x.sparkleHoney} />
    </>
  );
}

function Offline({ kit }: { kit: Kit }) {
  const { a } = kit;
  const warn = a.state.warn;
  return (
    <>
      <Path d="M68 66 A11 11 0 0 1 68 46 A16 16 0 0 1 96 38 A13 13 0 0 1 112 52 A7 7 0 0 1 108 66 Z" fill={a.scene.cloud} {...outline(kit)} />
      <Path d="M72 49 A11 11 0 0 1 80 42" {...stroke(a.highlight, STROKE.line)} opacity={a.highlightOpacity + 0.3} />
      <Path d="M80 56 Q89.5 47 99 56" {...stroke(a.state.generic, STROKE.bold)} />
      <Path d="M84.5 60.5 Q89.5 56 94.5 60.5" {...stroke(a.state.generic, STROKE.bold)} />
      <Circle cx={89.5} cy={65} r={1.8} fill={a.state.generic} />
      <Path d="M76 40 L104 72" {...stroke(a.state.danger, STROKE.bold)} />
      <Path d="M94 74 L88 83 L94 83 L89 93" {...stroke(warn, STROKE.bold)} />
      <Circle cx={112} cy={82} r={2} fill={a.state.water} />
      <Circle cx={105} cy={90} r={1.5} fill={a.state.water} />
    </>
  );
}

/** A gear outline as one path: n teeth between inner radius ri and outer radius ro. */
function gearPath(cx: number, cy: number, ro: number, ri: number, n: number): string {
  const step = (Math.PI * 2) / n;
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const c = i * step;
    for (const [da, r] of [[-0.32, ri], [-0.19, ro], [0.19, ro], [0.32, ri]] as const) {
      const ang = c + da * step * 2;
      pts.push(`${Math.round((cx + Math.cos(ang) * r) * 10) / 10} ${Math.round((cy + Math.sin(ang) * r) * 10) / 10}`);
    }
  }
  return `M${pts.join(' L')} Z`;
}
const GEAR = gearPath(94, 54, 20, 15, 8);
const GEAR_SMALL = gearPath(70, 40, 9, 6.5, 6);

function ServerError({ kit }: { kit: Kit }) {
  const gearId = useArtId('stGear');
  const wrenchId = useArtId('stWrench');
  const { a, x } = kit;
  return (
    <>
      <Defs>
        <MetalGrad id={gearId} metal={METALS.brass} />
        <MetalGrad id={wrenchId} metal={METALS.steel} />
      </Defs>
      <Path d={GEAR} fill={`url(#${gearId})`} {...outline(kit)} />
      <Circle cx={94} cy={54} r={7} fill={a.surface} stroke={a.ink} strokeWidth={STROKE.line} />
      <Path d="M82 44 Q85 38 92 36" {...stroke(METALS.brass.rim, STROKE.line)} />
      <Path d={GEAR_SMALL} fill={METALS.iron.mid} {...outline(kit)} />
      <Circle cx={70} cy={40} r={2.4} fill={a.surface} />
      <G transform="rotate(38 88 86)">
        <Path d="M81.5 75 L81.5 100 A6.5 6.5 0 0 0 94.5 100 L94.5 75 L99 72 A11 11 0 0 0 96 56 L91 56 L91 64 L85 64 L85 56 L80 56 A11 11 0 0 0 77 72 Z" fill={`url(#${wrenchId})`} {...outline(kit)} />
        <Path d="M84.5 78 V98" {...stroke(METALS.steel.rim, STROKE.line)} />
      </G>
      <Sparkle x={112} y={86} r={4.5} color={x.sparkleHoney} />
      <Sparkle x={62} y={64} r={3} color={x.sparkleCoral} />
    </>
  );
}

function CameraPermission({ kit }: { kit: Kit }) {
  const bodyId = useArtId('stCam');
  const lensId = useArtId('stLens');
  const lockId = useArtId('stLock');
  const { a, x } = kit;
  return (
    <>
      <Defs>
        <MetalGrad id={bodyId} metal={METALS.rubber} />
        <MetalGrad id={lensId} metal={METALS.chrome} />
        <MetalGrad id={lockId} metal={METALS.brass} />
      </Defs>
      <Rect x={76} y={37} width={18} height={10} rx={3.5} fill={METALS.rubber.mid} {...outline(kit)} />
      <Rect x={67} y={44} width={49} height={36} rx={9} fill={`url(#${bodyId})`} {...outline(kit)} />
      <Path d="M73 49 H107" {...stroke(METALS.rubber.rim, STROKE.line)} />
      <Circle cx={90} cy={63} r={14} fill={`url(#${lensId})`} {...outline(kit)} />
      <Circle cx={90} cy={63} r={8.5} fill={METALS.steel.lo} stroke={a.ink} strokeWidth={STROKE.line} />
      <Circle cx={86.5} cy={59.5} r={2.6} fill={x.eyeShine} />
      <Path d="M114.5 58 C115.5 70 110 78 101 79.5" {...stroke(a.rim, STROKE.line)} opacity={a.rimOpacity} />
      <Circle cx={107} cy={52} r={2.4} fill={METALS.brass.mid} />
      <Path d="M103.5 38 H110" {...stroke(a.ink, STROKE.bold)} />
      <Path d="M101 87 V84 A6 6 0 0 1 113 84 V87" {...stroke(METALS.chrome.lo, STROKE.bold)} />
      <Rect x={97} y={86} width={20} height={15} rx={4} fill={`url(#${lockId})`} {...outline(kit)} />
      <Circle cx={107} cy={92.5} r={2.2} fill={a.ink} />
      <Path d="M107 93 V96.5" {...stroke(a.ink, STROKE.line)} />
      <Sparkle x={112} y={26} r={4.5} color={x.sparkleHoney} />
    </>
  );
}

function Unavailable({ kit }: { kit: Kit }) {
  const woodId = useArtId('stWood');
  const { a, t, x } = kit;
  const wood = METALS.wood;
  return (
    <>
      <Defs>
        <MetalGrad id={woodId} metal={wood} />
      </Defs>
      <Path d="M79 31 V94 M105 31 V94" {...stroke(wood.lo, STROKE.bold)} />
      <Path d="M80 30 H104 C104 46 96 51 92 60 C96 69 104 74 104 92 H80 C80 74 88 69 92 60 C88 51 80 46 80 30 Z" fill={t.water} opacity={0.22} />
      <Path d="M86 39 H98 C97 46 94 50 92 56 C90 50 87 46 86 39 Z" fill={x.sparkleHoney} />
      <Path d="M92 56 V82" {...stroke(x.sparkleHoney, STROKE.line)} />
      <Path d="M83 90 C84 85 88 82 92 80 C96 82 100 85 101 90 Z" fill={x.sparkleHoney} />
      <Path d="M80 30 H104 C104 46 96 51 92 60 C96 69 104 74 104 92 H80 C80 74 88 69 92 60 C88 51 80 46 80 30 Z" fill="none" {...outline(kit)} />
      <Path d="M84 34 C84 42 87 47 90 52" {...stroke(a.highlight, STROKE.line)} opacity={a.highlightOpacity + 0.3} />
      <Rect x={74} y={24} width={36} height={7} rx={3.5} fill={`url(#${woodId})`} {...outline(kit)} />
      <Rect x={74} y={92} width={36} height={7} rx={3.5} fill={`url(#${woodId})`} {...outline(kit)} />
      <Sparkle x={66} y={26} r={4} color={x.sparkleCoral} />
    </>
  );
}

const PROP: Record<StateArtKind, (p: { kit: Kit }) => ReactNode> = {
  generic: Generic,
  noWorkouts: NoWorkouts,
  noRecords: NoRecords,
  groceryEmpty: GroceryEmpty,
  notFound: NotFound,
  offline: Offline,
  serverError: ServerError,
  cameraPermission: CameraPermission,
  unavailable: Unavailable,
};

export function StateArt({
  kind,
  size = 96,
  tone,
  float = false,
  style,
}: {
  kind: StateArtKind;
  size?: number;
  tone?: ArtTone;
  float?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const kit: Kit = tone ? { a: artPalettes[tone], x: ACCENTS[tone], t: palettes[tone] } : { a: art, x: ACCENTS[scheme], t: colors };
  const Prop = PROP[kind];
  return (
    <View style={[{ width: size, height: size }, style]} accessible={false} importantForAccessibility="no-hide-descendants" aria-hidden>
      <Svg width="100%" height="100%" viewBox="0 0 120 120">
        <Ellipse cx={60} cy={114} rx={54} ry={4.5} fill={kit.a.shadow} opacity={kit.a.shadowOpacity} />
        <Prop kit={kit} />
      </Svg>
      <Buddy mood={MOOD[kind]} size={size * PIP} tone={tone} float={float} style={{ position: 'absolute', left: 0, bottom: 0 }} />
    </View>
  );
}
