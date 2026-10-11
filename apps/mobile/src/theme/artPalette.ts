import { useId } from 'react';
import { allGradients, palettes, scheme } from './tokens';

/**
 * The one home for art colours. Illustrations (src/components/art) never write a hex or rgba of
 * their own; they take colours from here, from `palettes` (tokens) or from `colors`. Rules and
 * the shading recipe: docs/art-style.md. tokens.ts must never import this file.
 *
 * Light values are the colours the art already used. Dark values come from `palettes.dark`
 * wherever a token exists, and are otherwise warm evening colours that sit on the espresso surfaces.
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
  ink: palettes.light.text, // #3A2A1F
  featureInk: '#3A2A1F',
  shadow: '#7A4A26',
  shadowOpacity: 0.14,
  highlight: '#FFFFFF',
  highlightOpacity: 0.28,
  rim: '#FFE3CC',
  rimOpacity: 0.4,
  surface: palettes.light.cardRaised,
  floorLine: palettes.light.borderStrong,
  peach: { top: '#FFC29B', bottom: '#EE8257', belly: '#FFE6CF', foot: '#D9663F', cheek: '#FF8A7A', arm: '#F28F64' },
  leaf: { light: '#7FB06E', deep: '#5E9150' },
  figure: { skin: '#F6DCC6', skinShade: '#D9B79B', ghost: '#B8957A', work: '#E06A44', workDeep: '#B8482A', hair: '#4A3426', top: '#9CB88E', shorts: '#6B5747', shoe: '#3A2A1F' },
  scene: {
    sky: sky(allGradients.light.heroMedia),
    sun: '#F5A65B',
    sunGlow: '#FFD7A8',
    glowOpacity: 0.9,
    hillFar: '#F0CDA8',
    hillMid: '#C9DCBE',
    hillNear: '#A9C79C',
    haze: '#FFF1E0',
    cloud: '#FFFFFF',
    star: '#F5A65B',
    moon: '#FFF3D6',
    moonCrater: '#E8D5BF',
  },
  state: { generic: palettes.light.textFaint, warn: palettes.light.warning, danger: palettes.light.danger, water: palettes.light.water },
  locked: { metal: ['#F3EADF', '#E6D8C6', '#D6C4AD'], edge: '#CDBBA4', ink: '#B29C85', shine: 0.25 },
};

const dark: ArtPalette = {
  ink: '#2A1A12',
  featureInk: '#3A2A1F',
  shadow: '#000000',
  shadowOpacity: 0.35,
  highlight: '#FFF1E0',
  highlightOpacity: 0.2,
  rim: '#FFB98A',
  rimOpacity: 0.5,
  surface: palettes.dark.cardRaised,
  floorLine: palettes.dark.borderStrong,
  peach: { top: '#FFB48A', bottom: palettes.dark.primary, belly: '#FFE0C4', foot: '#B9532F', cheek: '#F5877A', arm: '#E87F57' },
  leaf: { light: palettes.dark.success, deep: '#68A06B' },
  figure: { skin: '#E8C4A6', skinShade: '#B8957A', ghost: '#8C705C', work: palettes.dark.primary, workDeep: '#C26A44', hair: '#6B4A36', top: '#7FA173', shorts: '#A58C78', shoe: '#E8D8C6' },
  scene: {
    sky: sky(allGradients.dark.heroMedia),
    sun: '#F6E3C2',
    sunGlow: '#F2A541',
    glowOpacity: 0.32,
    hillFar: '#4A372B',
    hillMid: '#3A4733',
    hillNear: '#2F3B2A',
    haze: '#5A4033',
    cloud: '#5B4538',
    star: '#FFE7B8',
    moon: '#F6E3C2',
    moonCrater: '#D9C3A0',
  },
  state: { generic: palettes.dark.textFaint, warn: palettes.dark.warning, danger: palettes.dark.danger, water: palettes.dark.water },
  locked: { metal: ['#4A3B31', '#3D3028', '#30251F'], edge: '#5E4C3F', ink: '#8C7562', shine: 0.06 },
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
    sparkleCoral: '#E9896A',
    sparkleHoney: '#F5B25B',
    sparkleCream: '#FFF3D6',
    sleepZ: '#8A7BB8',
    mouth: '#8A3422',
    eyeShine: '#FFFFFF',
    trophyStem: '#D98A3D',
    trophyBase: '#B86A2C',
    kettlebellHandle: '#5E4838',
    kettlebellBody: '#6B4E3B',
    figureEdge: '#5A3E2B',
    bodySkinTop: '#F3E6D6',
    bodySkinBottom: '#E3D1BC',
    bodyMuscleTop: '#E9D7C2',
    bodyMuscleBottom: '#D7C1A8',
    bodyOutline: 'rgba(90,62,43,0.22)',
    bodyActiveTop: '#FF8C6B',
    bodyActiveBottom: '#CF3F2A',
    bodyActiveEdge: 'rgba(120,20,10,0.35)',
  },
  dark: {
    sparkleCoral: '#F0A088',
    sparkleHoney: '#F5B25B',
    sparkleCream: '#FFF3D6',
    sleepZ: palettes.dark.purple,
    mouth: '#8A3422',
    eyeShine: '#FFFFFF',
    trophyStem: '#D98A3D',
    trophyBase: '#B86A2C',
    kettlebellHandle: '#7A5C47',
    kettlebellBody: '#8C6A52',
    figureEdge: '#2A1A12',
    bodySkinTop: '#5A483D',
    bodySkinBottom: '#3E3129',
    bodyMuscleTop: '#6B574A',
    bodyMuscleBottom: '#4E3F35',
    bodyOutline: 'rgba(0,0,0,0.35)',
    bodyActiveTop: '#FF8C6B',
    bodyActiveBottom: '#CF3F2A',
    bodyActiveEdge: 'rgba(120,20,10,0.35)',
  },
};
