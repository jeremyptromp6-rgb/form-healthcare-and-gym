import { useId } from 'react';
import { allGradients, palettes, scheme } from './tokens';

/**
 * The one home for art colours. Illustrations (src/components/art) never write a hex or rgba of
 * their own; they take colours from here, from `palettes` (tokens) or from `colors`. Rules and
 * the shading recipe: docs/art-style.md. tokens.ts must never import this file.
 *
 * Scenery, props and the figure follow the teal and amber of the tokens; Pip (the peach buddy) and
 * the foods keep their natural warm colours, so they stand out against the cool charcoal and mint.
 * Dark values come from `palettes.dark` wherever a token exists.
 */

export type ArtTone = 'light' | 'dark';

/** Stroke widths in viewBox units: the only widths art uses. */
export const STROKE = { hair: 1, line: 2, bold: 3, heavy: 6 } as const;

/** [width, height] of each art family's viewBox. */
export const VIEWBOX = {
  pip: [120, 120],
  meal: [120, 90],
  figure: [200, 140],
  emblem: [100, 108],
  state: [120, 120],
} as const;

/** Gradient direction for every lit surface: light comes from the top-left. */
export const LIGHT_DIR = { x1: 0.15, y1: 0, x2: 0.85, y2: 1 } as const;

/** A prefixed id that is unique per component instance and valid inside `url(#...)`. */
export function useArtId(prefix: string): string {
  return `${prefix}${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
}

export interface ArtPalette {
  /** Outline colour. */
  ink: string;
  /** Eyes, mouth and other small features drawn on a light body. */
  featureInk: string;
  shadow: string;
  shadowOpacity: number;
  highlight: string;
  /** 0.2 to 0.35. */
  highlightOpacity: number;
  rim: string;
  rimOpacity: number;
  /** tokens cardRaised */
  surface: string;
  /** tokens borderStrong */
  floorLine: string;
  peach: { top: string; bottom: string; belly: string; foot: string; cheek: string; arm: string };
  leaf: { light: string; deep: string };
  figure: { skin: string; skinShade: string; ghost: string; work: string; workDeep: string; hair: string; top: string; shorts: string; shoe: string };
  scene: {
    sky: [string, string, string];
    sun: string;
    sunGlow: string;
    glowOpacity: number;
    hillFar: string;
    hillMid: string;
    hillNear: string;
    haze: string;
    cloud: string;
    star: string;
    moon: string;
    moonCrater: string;
  };
  /** Colours for state props (StateArt): graphics, so 3:1 on the card is enough. */
  state: { generic: string; warn: string; danger: string; water: string };
  /** A rank not reached yet: unpolished clay. */
  locked: { metal: [string, string, string]; edge: string; ink: string; shine: number };
}

const sky = (g: readonly string[]): [string, string, string] => [g[0]!, g[1]!, g[2]!];

const light: ArtPalette = {
  ink: palettes.light.text, // #0F1A17
  featureInk: '#3A2A1F',
  shadow: '#0B2A22',
  shadowOpacity: 0.14,
  highlight: '#FFFFFF',
  highlightOpacity: 0.28,
  rim: '#D3F2E5',
  rimOpacity: 0.4,
  surface: palettes.light.cardRaised,
  floorLine: palettes.light.borderStrong,
  peach: { top: '#FFC29B', bottom: '#EE8257', belly: '#FFE6CF', foot: '#D9663F', cheek: '#FF8A7A', arm: '#F28F64' },
  leaf: { light: '#34D399', deep: '#059669' },
  figure: { skin: '#F6DCC6', skinShade: '#D9B79B', ghost: '#B8957A', work: '#10B981', workDeep: '#047857', hair: '#4A3426', top: '#8CCBB5', shorts: '#41504C', shoe: '#0F1A17' },
  scene: {
    sky: sky(allGradients.light.heroMedia),
    sun: '#F59E0B',
    sunGlow: '#FDE3A1',
    glowOpacity: 0.9,
    hillFar: '#BFE3D4',
    hillMid: '#8FD0B5',
    hillNear: '#5FB894',
    haze: '#E9F7F1',
    cloud: '#FFFFFF',
    star: '#FCD34D',
    moon: '#FFF3D6',
    moonCrater: '#DCE6E1',
  },
  state: { generic: palettes.light.textFaint, warn: palettes.light.warning, danger: palettes.light.danger, water: palettes.light.water },
  locked: { metal: ['#F1F5F3', '#E1E8E5', '#CFD9D5'], edge: '#C3CEC9', ink: '#9AA8A3', shine: 0.25 },
};

const dark: ArtPalette = {
  ink: '#2A1A12',
  featureInk: '#3A2A1F',
  shadow: '#000000',
  shadowOpacity: 0.35,
  highlight: '#E9FBF3',
  highlightOpacity: 0.2,
  rim: '#6EE7B7',
  rimOpacity: 0.5,
  surface: palettes.dark.cardRaised,
  floorLine: palettes.dark.borderStrong,
  peach: { top: '#FFB48A', bottom: '#E5825A', belly: '#FFE0C4', foot: '#B9532F', cheek: '#F5877A', arm: '#E87F57' },
  leaf: { light: '#34D399', deep: '#10B981' },
  figure: { skin: '#E8C4A6', skinShade: '#B8957A', ghost: '#8C705C', work: palettes.dark.primary, workDeep: '#0B8A63', hair: '#6B4A36', top: '#5FA58F', shorts: '#8E9A97', shoe: '#E5E7EB' },
  scene: {
    sky: sky(allGradients.dark.heroMedia),
    sun: '#FDE68A',
    sunGlow: '#F59E0B',
    glowOpacity: 0.32,
    hillFar: '#1B3A32',
    hillMid: '#15302A',
    hillNear: '#0F2520',
    haze: '#23463C',
    cloud: '#34433F',
    star: '#FDE68A',
    moon: '#F6EBC8',
    moonCrater: '#D4C79C',
  },
  state: { generic: palettes.dark.textFaint, warn: palettes.dark.warning, danger: palettes.dark.danger, water: palettes.dark.water },
  locked: { metal: ['#343D3B', '#2A3230', '#202726'], edge: '#46514E', ink: '#7C8985', shine: 0.06 },
};

export const artPalettes: Record<ArtTone, ArtPalette> = { light, dark };

/** The palette for the scheme chosen at launch (see `scheme` in tokens). Art takes `tone` to override it. */
export const art: ArtPalette = artPalettes[scheme];

export type MetalName = 'oak' | 'bronze' | 'silver' | 'steel' | 'gold' | 'platinum' | 'sapphire' | 'chrome' | 'iron' | 'rubber' | 'wood' | 'brass';
export interface Metal {
  /** Lit side. */
  hi: string;
  /** Body. */
  mid: string;
  /** Shaded side. */
  lo: string;
  /** Bright edge. */
  rim: string;
}

/**
 * Metals and materials, the same in both tones (an object does not change colour at night; the
 * scene around it does). The first seven are the rank metals; the rest are equipment.
 */
export const METALS: Record<MetalName, Metal> = {
  oak: { hi: '#C9925E', mid: '#8A5A33', lo: '#5A3A20', rim: '#D9A877' },
  bronze: { hi: '#F0B27A', mid: '#B86B35', lo: '#6E3A16', rim: '#F6C79A' },
  silver: { hi: '#FFFFFF', mid: '#C3CAD3', lo: '#7E8894', rim: '#F2F5F8' },
  steel: { hi: '#8EA4C2', mid: '#4B5F7D', lo: '#222D3F', rim: '#A9C1E3' },
  gold: { hi: '#FFE89A', mid: '#F2B829', lo: '#9A6A08', rim: '#FFF1BF' },
  platinum: { hi: '#F4FBFF', mid: '#A8D8EC', lo: '#5B8FA8', rim: '#E6F7FF' },
  sapphire: { hi: '#7DB4FF', mid: '#2B6CF0', lo: '#152E78', rim: '#FFD66B' },
  chrome: { hi: '#FFFFFF', mid: '#D5DCE3', lo: '#8E99A6', rim: '#F4F7FA' },
  iron: { hi: '#A68E7C', mid: '#8C705C', lo: '#5E4838', rim: '#BBA594' },
  rubber: { hi: '#5A4A40', mid: '#3E322B', lo: '#261E19', rim: '#6E5D52' },
  wood: { hi: '#D9B88C', mid: '#B88A5A', lo: '#7C5632', rim: '#E6C9A2' },
  brass: { hi: '#F5D68A', mid: '#D9A441', lo: '#8E6218', rim: '#FBE6B0' },
};

type RankMetal = 'oak' | 'bronze' | 'silver' | 'steel' | 'gold' | 'platinum' | 'sapphire';

/** The symbol ink (and laurel, where the rank has one) drawn on each rank metal. */
export const METAL_SYMBOL: Record<RankMetal, { ink: string; laurel?: string }> = {
  oak: { ink: '#FFF3E6' },
  bronze: { ink: '#FFF4EA' },
  silver: { ink: '#2A323C' },
  steel: { ink: '#F2F6FC' },
  gold: { ink: '#4A3404' },
  platinum: { ink: '#163646', laurel: '#BFE7F7' },
  sapphire: { ink: '#FFFFFF', laurel: '#FFC83D' },
};

/** Each rank metal as text colour (4.5:1 on the page): deepened for cream, brightened for the evening palette. */
export const METAL_TEXT: Record<ArtTone, Record<RankMetal, string>> = {
  light: { oak: '#87552F', bronze: '#94501F', silver: '#5A6572', steel: '#3F5170', gold: '#80580A', platinum: '#386A82', sapphire: '#2650AE' },
  dark: { oak: '#E3AE80', bronze: '#F2B784', silver: '#D9DFE6', steel: '#AFC5E5', gold: '#F5CF63', platinum: '#ADDBEE', sapphire: '#93BEFF' },
};

/** Natural food colours, the same in both tones (allowed hex table: food does not recolour at night). */
export const FOODS: Record<string, string> = {
  // plates and bowls
  plateRimTop: '#FFFFFF',
  plateRimBottom: '#E7DACA',
  plateCentre: '#FFFFFF',
  plateCentreEdge: '#F1E8DC',
  bowlFill: '#EADCC4',
  bowlRing: '#D3C0A0',
  spoonHandle: '#C9B6A0',
  spoonBowl: '#D6C4AF',
  // breakfast
  oatsLight: '#F6E6C2',
  oatsDark: '#E6CE9F',
  oatFlake: '#D7BE8E',
  bananaSlice: '#FBE7A1',
  bananaSliceRim: '#EBCB6A',
  bananaSliceCore: '#E3C46A',
  blueberry: '#4F57B8',
  blueberryLight: '#5B63C9',
  raspberry: '#C2405E',
  raspberryLight: '#D24A68',
  honey: '#E8A93A',
  // lunch
  leafMid: '#4E9A62',
  leafLight: '#6DB57F',
  leafPale: '#86C590',
  cucumberSkin: '#5E9E52',
  cucumberFlesh: '#D9EDB8',
  cucumberSeed: '#A8C98A',
  tomatoLight: '#FF7A66',
  tomatoDark: '#D0402F',
  tomatoStem: '#3F7D3A',
  feta: '#FBF6EC',
  // dinner
  rice: '#F3EFE6',
  riceGrain: '#E0D8C8',
  salmonLight: '#F7A47A',
  salmonDark: '#E47750',
  salmonStripe: '#C25A3A',
  broccoliStem: '#8FBF6E',
  broccoliDark: '#3F8A4C',
  broccoliLight: '#4E9A58',
  lemon: '#F5D45A',
  lemonRim: '#E7B93A',
  lemonPith: '#FFF3B8',
  // snack
  appleLight: '#F2675C',
  appleDark: '#B8322B',
  appleStem: '#6B4A2E',
  bananaLight: '#FBE07A',
  bananaDark: '#EDBD3C',
  bananaRidge: '#E2B23E',
  almond: '#B9814E',
  almondEdge: '#94613A',
  // the apple in the welcome scene
  sceneApple: '#D9574A',
  sceneAppleLeaf: '#7FAF6E',
};

/** Food colours the FOODS table has no slot for (the same in both tones). `shine` is the white glint on a food. */
export const FOOD_EXTRA = {
  carrot: '#F08A3C',
  carrotDark: '#D9702A',
  pod: '#5FA862',
  steak: '#C9514A',
  steakDark: '#A93B38',
  fat: '#F7E3CE',
  bone: '#F6EBDD',
  roast: '#D98A4A',
  roastDark: '#B86A2C',
  fish: '#7FB5D6',
  fishDark: '#5C97BE',
  fishBelly: '#CFE6F2',
  eggWhite: '#FFFFFF',
  yolk: '#F7B733',
  cheese: '#F7D56B',
  cheeseTop: '#FBE9A6',
  cheeseHole: '#E4B53F',
  tofu: '#FFF7E3',
  tofuLeft: '#F1E1BC',
  tofuRight: '#E6D0A0',
  nutShell: '#C99A62',
  nutLine: '#A57A45',
  oil: '#E8C547',
  oilCap: '#6B4A2E',
  label: '#FFF3D6',
  bag: '#E9644B',
  bagDark: '#C94A34',
  chip: '#F5D26B',
  sponge: '#F3D9A4',
  frosting: '#F4A6B8',
  cherry: '#D0402F',
  cup: '#FFFFFF',
  drink: '#6FB7E0',
  straw: '#E9644B',
  ice: '#DDF1FB',
  bun: '#E0A04F',
  patty: '#7A4A2E',
  cheeseSlice: '#F7C948',
  wheat: '#E2B85E',
  loaf: '#D9A05B',
  loafDark: '#B9783A',
  steam: '#C9BBA8',
  shine: '#FFFFFF',
} as const;

/** The grey anatomy mannequin (BodyMap, ExerciseArt), per tone. `line` is a fine seam drawn at `lineOpacity`. */
export interface ArtAnatomy {
  skinTop: string;
  skinBottom: string;
  muscleTop: string;
  muscleBottom: string;
  edge: string;
  line: string;
  lineOpacity: number;
  /** ExerciseArt figure: body, far side, fine seams, feet. */
  base: string;
  shade: string;
  seam: string;
  foot: string;
}

export const ANATOMY: Record<ArtTone, ArtAnatomy> = {
  light: { skinTop: '#E1E4E8', skinBottom: '#C4C8CF', muscleTop: '#D2D6DC', muscleBottom: '#B6BBC3', edge: '#6A707A', line: '#3C424C', lineOpacity: 0.3, base: '#D6D9DE', shade: '#B6BAC2', seam: '#8E949E', foot: '#9AA0AA' },
  dark: { skinTop: '#9BA1AB', skinBottom: '#777D88', muscleTop: '#8A909A', muscleBottom: '#6B717C', edge: '#2B2E33', line: '#14161A', lineOpacity: 0.45, base: '#8C929C', shade: '#6C727C', seam: '#4F545D', foot: '#5E646E' },
};

/**
 * Small accents the current art uses that have no slot in ArtPalette: sparkles, the sleepy Zs, the
 * trophy, the kettlebell, the figure outline and the body map. Tone-aware where the colour is.
 */
export interface ArtAccents {
  sparkleCoral: string;
  sparkleHoney: string;
  sparkleCream: string;
  sleepZ: string;
  mouth: string;
  eyeShine: string;
  trophyStem: string;
  trophyBase: string;
  kettlebellHandle: string;
  kettlebellBody: string;
  figureEdge: string;
  bodySkinTop: string;
  bodySkinBottom: string;
  bodyMuscleTop: string;
  bodyMuscleBottom: string;
  bodyOutline: string;
  bodyActiveTop: string;
  bodyActiveBottom: string;
  bodyActiveEdge: string;
}

export const ACCENTS: Record<ArtTone, ArtAccents> = {
  light: {
    sparkleCoral: '#10B981',
    sparkleHoney: '#F59E0B',
    sparkleCream: '#FFF3D6',
    sleepZ: '#8A7BB8',
    mouth: '#8A3422',
    eyeShine: '#FFFFFF',
    trophyStem: '#D98A3D',
    trophyBase: '#B86A2C',
    kettlebellHandle: '#41504C',
    kettlebellBody: '#566561',
    figureEdge: '#1F2D29',
    bodySkinTop: '#EEF2F1',
    bodySkinBottom: '#DCE4E1',
    bodyMuscleTop: '#E1E9E6',
    bodyMuscleBottom: '#CBD6D2',
    bodyOutline: 'rgba(15,26,23,0.22)',
    bodyActiveTop: '#34D399',
    bodyActiveBottom: '#047857',
    bodyActiveEdge: 'rgba(4,60,40,0.35)',
  },
  dark: {
    sparkleCoral: '#34D399',
    sparkleHoney: '#FBBF24',
    sparkleCream: '#FFF3D6',
    sleepZ: palettes.dark.purple,
    mouth: '#8A3422',
    eyeShine: '#FFFFFF',
    trophyStem: '#D98A3D',
    trophyBase: '#B86A2C',
    kettlebellHandle: '#7C8885',
    kettlebellBody: '#93A09C',
    figureEdge: '#0B0F0E',
    bodySkinTop: '#46514E',
    bodySkinBottom: '#2F3836',
    bodyMuscleTop: '#556260',
    bodyMuscleBottom: '#3B4644',
    bodyOutline: 'rgba(0,0,0,0.35)',
    bodyActiveTop: '#34D399',
    bodyActiveBottom: '#059669',
    bodyActiveEdge: 'rgba(0,50,35,0.4)',
  },
};
