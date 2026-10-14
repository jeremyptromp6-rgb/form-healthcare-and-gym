import { EXERCISE_BY_ID } from '@form/domain';
import { memo, useEffect, useState, type ReactNode } from 'react';
import { AppState, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, Line, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { useReducedMotion } from '@/lib/a11y';
import { ANATOMY, artPalettes, LIGHT_DIR, METALS, STROKE, type ArtPalette, type ArtTone, type Metal } from '@/theme/artPalette';
import { palettes, scheme } from '@/theme/tokens';

/**
 * Exercise illustrations: original vector art drawn from a small figure rig, so every movement in
 * the catalogue has a picture. The figure is a stylised, muscular anatomy model in light grey (a smooth
 * head, a broad torso, rounded limbs with fine muscle seams), lit from the top-left. The exercise's
 * main muscles are filled in the accent colour and its helpers in a softer tint of it; the start
 * position is a faint silhouette and the equipment is drawn in METALS. Side view, facing right.
 *
 * Data-driven: a handful of reusable movement templates (stand, hinge, squat, lunge, plank, supine,
 * seated, hanging, overhead...) hold the start and end poses and default props; ART maps every exercise
 * id to a template (and, where it differs, its props), and the highlighted muscles come from the domain
 * library's primary/secondary muscles. Style rules: docs/art-style.md.
 * Budget: 50 SVG elements for the figure with its ghost and gear, 25 as a thumb, 12 for the placeholder.
 */

type P = readonly [number, number];
export interface Pose {
  head: P;
  neck: P;
  hip: P;
  knee: P;
  foot: P;
  elbow: P;
  hand: P;
  /** A second leg when it differs from the first (a lunge's back leg). */
  knee2?: P;
  foot2?: P;
}
type Equipment = 'plate' | 'dumbbell' | 'kettlebell' | 'bench' | 'bench_end' | 'rails' | 'band' | 'cable' | 'pulldown' | 'bar' | 'seat' | 'floor';

interface Template {
  start: Pose;
  end: Pose;
  equipment: Equipment[];
}

const STAND = {
  head: [101, 31],
  neck: [100, 44],
  hip: [99, 76],
  knee: [99, 102],
  foot: [99, 128],
} as const;
const SQUAT_LEGS = {
  foot: [100, 128],
  knee: [117, 101],
  hip: [84, 102],
  neck: [106, 68],
  head: [112, 57],
} as const;
/** Hinged forward with a flat back, legs soft. */
const HINGE_ROW = {
  foot: [100, 128],
  knee: [108, 105],
  hip: [82, 84],
  neck: [120, 68],
  head: [131, 62],
} as const;
const SEATED = {
  hip: [90, 104],
  knee: [116, 100],
  foot: [120, 128],
  neck: [94, 70],
  head: [96, 57],
} as const;
const OVERHEAD = { head: [101, 28], neck: [100, 41], hip: [99, 73], knee: [99, 99], foot: [99, 125] } as const;
const PUSH_UP_TOP = {
  foot: [36, 126],
  knee: [62, 118],
  hip: [90, 110],
  neck: [138, 96],
  head: [151, 90],
  elbow: [138, 111],
  hand: [138, 127],
} as const;
const PUSH_UP_LOW = {
  foot: [36, 126],
  knee: [62, 121],
  hip: [90, 117],
  neck: [138, 111],
  head: [151, 107],
  elbow: [121, 113],
  hand: [138, 127],
} as const;
const LEG_EXT_BENT: Pose = { ...SEATED, elbow: [100, 94], hand: [104, 104], knee: [116, 100], foot: [118, 128] };
const LEG_EXT_STRAIGHT: Pose = { ...SEATED, elbow: [100, 94], hand: [104, 104], knee: [116, 102], foot: [145, 100] };
const BURPEE_UP: Pose = { ...OVERHEAD, elbow: [106, 32], hand: [104, 17] };

/** The movements the original library was drawn for: each keeps its own id as its template name. */
const BASE: Record<string, Template> = {
  bodyweight_squat: {
    start: { ...STAND, elbow: [113, 48], hand: [128, 48] },
    end: { ...SQUAT_LEGS, elbow: [120, 72], hand: [136, 72] },
    equipment: ['floor'],
  },
  goblet_squat: {
    start: { ...STAND, elbow: [108, 62], hand: [112, 52] },
    end: { ...SQUAT_LEGS, elbow: [114, 84], hand: [118, 74] },
    equipment: ['floor', 'kettlebell'],
  },
  squat: {
    start: { ...STAND, elbow: [89, 58], hand: [96, 46] },
    end: { ...SQUAT_LEGS, elbow: [95, 82], hand: [102, 70] },
    equipment: ['floor', 'plate'],
  },
  push_up: {
    start: PUSH_UP_TOP,
    end: PUSH_UP_LOW,
    equipment: ['floor'],
  },
  bicep_curl: {
    start: { ...STAND, elbow: [101, 62], hand: [102, 82] },
    end: { ...STAND, elbow: [101, 62], hand: [113, 48] },
    equipment: ['floor', 'dumbbell'],
  },
  lunge: {
    start: {
      ...STAND,
      elbow: [100, 62],
      hand: [100, 80],
      knee2: [99, 102],
      foot2: [99, 128],
    },
    end: {
      head: [102, 57],
      neck: [101, 70],
      hip: [100, 102],
      knee: [126, 102],
      foot: [126, 128],
      elbow: [101, 86],
      hand: [101, 104],
      knee2: [84, 125],
      foot2: [62, 121],
    },
    equipment: ['floor'],
  },
  glute_bridge: {
    start: {
      head: [38, 117],
      neck: [52, 121],
      hip: [98, 122],
      knee: [126, 100],
      foot: [146, 127],
      elbow: [72, 125],
      hand: [92, 126],
    },
    end: {
      head: [38, 117],
      neck: [52, 120],
      hip: [100, 96],
      knee: [130, 91],
      foot: [146, 127],
      elbow: [72, 125],
      hand: [92, 126],
    },
    equipment: ['floor'],
  },
  deadlift: {
    start: {
      foot: [100, 128],
      knee: [110, 106],
      hip: [78, 90],
      neck: [114, 70],
      head: [125, 63],
      elbow: [112, 92],
      hand: [110, 114],
    },
    end: { ...STAND, elbow: [101, 62], hand: [102, 84] },
    equipment: ['floor', 'plate'],
  },
  bench_press: {
    // Pressing: the bold pose is the lockout, the faint one the bar at the chest.
    start: {
      head: [44, 96],
      neck: [57, 100],
      hip: [110, 103],
      knee: [134, 96],
      foot: [142, 128],
      elbow: [78, 96],
      hand: [64, 86],
    },
    end: {
      head: [44, 96],
      neck: [57, 100],
      hip: [110, 103],
      knee: [134, 96],
      foot: [142, 128],
      elbow: [62, 80],
      hand: [62, 60],
    },
    equipment: ['floor', 'bench', 'plate'],
  },
  overhead_press: {
    start: { ...STAND, elbow: [112, 57], hand: [110, 43] },
    end: { ...STAND, elbow: [106, 32], hand: [104, 17] },
    equipment: ['floor', 'plate'],
  },
  row: {
    start: { ...HINGE_ROW, elbow: [122, 86], hand: [122, 104] },
    end: { ...HINGE_ROW, elbow: [100, 74], hand: [114, 90] },
    equipment: ['floor', 'plate'],
  },
  band_row: {
    start: {
      foot: [98, 128],
      knee: [100, 102],
      hip: [96, 76],
      neck: [98, 44],
      head: [100, 31],
      elbow: [116, 52],
      hand: [134, 54],
    },
    end: {
      foot: [98, 128],
      knee: [100, 102],
      hip: [96, 76],
      neck: [98, 44],
      head: [100, 31],
      elbow: [84, 60],
      hand: [104, 56],
    },
    equipment: ['floor', 'band'],
  },
  cable_row: {
    start: {
      hip: [84, 110],
      knee: [110, 98],
      foot: [132, 112],
      neck: [86, 76],
      head: [88, 63],
      elbow: [108, 88],
      hand: [128, 92],
    },
    end: {
      hip: [84, 110],
      knee: [110, 98],
      foot: [132, 112],
      neck: [86, 76],
      head: [88, 63],
      elbow: [68, 90],
      hand: [90, 90],
    },
    equipment: ['floor', 'seat', 'cable'],
  },
  lat_pulldown: {
    start: { ...SEATED, knee: [116, 100], foot: [120, 128], elbow: [104, 40], hand: [112, 16] },
    end: { ...SEATED, elbow: [86, 82], hand: [106, 64] },
    equipment: ['floor', 'seat', 'pulldown'],
  },
  pull_up: {
    start: {
      hand: [114, 18],
      elbow: [110, 36],
      neck: [105, 54],
      head: [119, 45],
      hip: [102, 90],
      knee: [106, 112],
      foot: [94, 124],
    },
    end: {
      hand: [114, 18],
      elbow: [100, 32],
      neck: [104, 30],
      head: [106, 15],
      hip: [102, 64],
      knee: [106, 86],
      foot: [94, 98],
    },
    equipment: ['bar'],
  },
};

/** Reusable movement templates for the wider library. */
const EXTRA: Record<string, Template> = {
  calf_raise: {
    start: { ...STAND, elbow: [101, 62], hand: [102, 82] },
    end: { head: [101, 25], neck: [100, 38], hip: [99, 70], knee: [99, 96], foot: [99, 122], elbow: [101, 56], hand: [102, 76] },
    equipment: ['floor'],
  },
  front_raise: {
    start: { ...STAND, elbow: [101, 62], hand: [103, 82] },
    end: { ...STAND, elbow: [119, 52], hand: [137, 50] },
    equipment: ['floor', 'dumbbell'],
  },
  upright: {
    start: { ...STAND, elbow: [104, 64], hand: [103, 84] },
    end: { ...STAND, elbow: [113, 48], hand: [104, 56] },
    equipment: ['floor', 'dumbbell'],
  },
  shrug: {
    start: { ...STAND, elbow: [101, 62], hand: [102, 84] },
    end: { head: [101, 28], neck: [100, 41], hip: [99, 76], knee: [99, 102], foot: [99, 128], elbow: [101, 60], hand: [102, 81] },
    equipment: ['floor', 'dumbbell'],
  },
  tri_overhead: {
    start: { ...STAND, elbow: [100, 28], hand: [89, 40] },
    end: { ...STAND, elbow: [100, 28], hand: [101, 8] },
    equipment: ['floor', 'dumbbell'],
  },
  kickback: {
    start: { ...HINGE_ROW, elbow: [100, 76], hand: [101, 96] },
    end: { ...HINGE_ROW, elbow: [100, 76], hand: [80, 78] },
    equipment: ['floor', 'dumbbell'],
  },
  pushdown: {
    start: { ...STAND, elbow: [101, 62], hand: [113, 57] },
    end: { ...STAND, elbow: [101, 62], hand: [103, 84] },
    equipment: ['floor', 'pulldown'],
  },
  crunch: {
    start: { head: [38, 117], neck: [52, 121], hip: [98, 122], knee: [126, 100], foot: [146, 127], elbow: [52, 108], hand: [42, 112] },
    end: { head: [60, 98], neck: [68, 108], hip: [98, 122], knee: [126, 100], foot: [146, 127], elbow: [66, 92], hand: [58, 98] },
    equipment: ['floor'],
  },
  leg_raise: {
    start: { head: [38, 121], neck: [52, 122], hip: [92, 123], knee: [122, 122], foot: [150, 123], elbow: [68, 126], hand: [88, 127] },
    end: { head: [38, 121], neck: [52, 122], hip: [92, 123], knee: [93, 95], foot: [95, 67], elbow: [68, 126], hand: [88, 127] },
    equipment: ['floor'],
  },
  hang_knee: {
    start: { hand: [110, 18], elbow: [108, 36], neck: [104, 56], head: [105, 43], hip: [102, 90], knee: [103, 114], foot: [100, 126] },
    end: { hand: [110, 18], elbow: [108, 36], neck: [104, 56], head: [105, 43], hip: [102, 90], knee: [124, 84], foot: [112, 104] },
    equipment: ['bar'],
  },
  vsit: {
    start: { head: [72, 76], neck: [80, 88], hip: [102, 116], knee: [128, 92], foot: [148, 104], elbow: [106, 96], hand: [124, 94] },
    end: { head: [72, 76], neck: [80, 88], hip: [102, 116], knee: [128, 92], foot: [148, 104], elbow: [96, 100], hand: [112, 100] },
    equipment: ['floor'],
  },
  plank: {
    start: { foot: [36, 126], knee: [62, 119], hip: [90, 113], neck: [136, 104], head: [149, 100], elbow: [134, 121], hand: [150, 125] },
    end: { foot: [36, 126], knee: [62, 118], hip: [90, 111], neck: [136, 104], head: [149, 100], elbow: [134, 121], hand: [150, 125] },
    equipment: ['floor'],
  },
  mountain: {
    start: { ...PUSH_UP_TOP, knee2: [64, 118], foot2: [38, 126] },
    end: { ...PUSH_UP_TOP, knee2: [112, 98], foot2: [92, 117] },
    equipment: ['floor'],
  },
  superman: {
    start: { head: [150, 118], neck: [136, 121], hip: [100, 122], knee: [70, 123], foot: [40, 124], elbow: [150, 121], hand: [168, 123] },
    end: { head: [152, 108], neck: [137, 114], hip: [100, 122], knee: [70, 116], foot: [42, 110], elbow: [152, 111], hand: [170, 105] },
    equipment: ['floor'],
  },
  seat_press: {
    start: { ...SEATED, elbow: [106, 92], hand: [108, 70] },
    end: { ...SEATED, elbow: [97, 56], hand: [98, 34] },
    equipment: ['floor', 'seat', 'dumbbell'],
  },
  leg_ext: { start: LEG_EXT_BENT, end: LEG_EXT_STRAIGHT, equipment: ['floor', 'seat'] },
  leg_curl: { start: LEG_EXT_STRAIGHT, end: LEG_EXT_BENT, equipment: ['floor', 'seat'] },
  leg_press: {
    start: { head: [32, 86], neck: [42, 92], hip: [66, 112], knee: [92, 94], foot: [114, 112], elbow: [80, 100], hand: [92, 108] },
    end: { head: [32, 86], neck: [42, 92], hip: [66, 112], knee: [94, 104], foot: [122, 92], elbow: [80, 100], hand: [92, 108] },
    equipment: ['floor'],
  },
  wall_sit: {
    start: { head: [89, 52], neck: [88, 66], hip: [88, 100], knee: [116, 100], foot: [116, 128], elbow: [98, 86], hand: [112, 92] },
    end: { head: [89, 52], neck: [88, 66], hip: [88, 100], knee: [116, 100], foot: [116, 128], elbow: [98, 86], hand: [112, 92] },
    equipment: ['floor'],
  },
  dip: {
    start: { head: [102, 38], neck: [100, 52], hip: [98, 84], knee: [106, 106], foot: [98, 120], elbow: [93, 76], hand: [100, 92] },
    end: { head: [103, 52], neck: [101, 66], hip: [99, 96], knee: [107, 113], foot: [98, 126], elbow: [88, 84], hand: [100, 92] },
    equipment: ['floor', 'rails'],
  },
  hip_thrust: {
    start: { head: [46, 98], neck: [58, 102], hip: [96, 118], knee: [120, 100], foot: [136, 127], elbow: [80, 112], hand: [96, 112] },
    end: { head: [46, 98], neck: [58, 102], hip: [98, 98], knee: [124, 95], foot: [132, 127], elbow: [82, 100], hand: [98, 98] },
    equipment: ['floor', 'bench_end', 'plate'],
  },
  hinge: {
    start: { ...STAND, elbow: [101, 62], hand: [102, 84] },
    end: { foot: [100, 128], knee: [100, 104], hip: [80, 86], neck: [112, 72], head: [123, 67], elbow: [108, 90], hand: [108, 108] },
    equipment: ['floor', 'plate'],
  },
  sldl: {
    start: { ...STAND, elbow: [101, 62], hand: [102, 84], knee2: [99, 102], foot2: [99, 128] },
    end: { foot: [100, 128], knee: [100, 104], hip: [80, 86], neck: [112, 72], head: [123, 67], elbow: [108, 90], hand: [108, 108], knee2: [58, 88], foot2: [32, 92] },
    equipment: ['floor', 'dumbbell'],
  },
  swing: {
    start: { ...HINGE_ROW, elbow: [104, 92], hand: [102, 106] },
    end: { ...STAND, elbow: [114, 54], hand: [132, 52] },
    equipment: ['floor', 'kettlebell'],
  },
  jack: {
    start: { ...STAND, elbow: [101, 62], hand: [102, 82] },
    end: BURPEE_UP,
    equipment: ['floor'],
  },
  burpee: { start: PUSH_UP_LOW, end: BURPEE_UP, equipment: ['floor'] },
  thruster: {
    start: { ...SQUAT_LEGS, elbow: [95, 82], hand: [102, 70] },
    end: { ...STAND, elbow: [106, 32], hand: [104, 17] },
    equipment: ['floor', 'dumbbell'],
  },
};

/** An exercise's art: a template name, or a template with its own props. */
type ArtSpec = string | readonly [string, readonly Equipment[]];
const DB: readonly Equipment[] = ['floor', 'dumbbell'];
const BAR: readonly Equipment[] = ['floor', 'plate'];
const CABLE: readonly Equipment[] = ['floor', 'cable'];
const MACHINE: readonly Equipment[] = ['floor', 'seat'];
const FLOOR: readonly Equipment[] = ['floor'];
const FREE: Record<string, ArtSpec> = {
  // chest
  incline_bench_press: 'bench_press',
  dumbbell_bench_press: ['bench_press', ['floor', 'bench', 'dumbbell']],
  incline_dumbbell_press: ['bench_press', ['floor', 'bench', 'dumbbell']],
  dumbbell_fly: ['bench_press', ['floor', 'bench', 'dumbbell']],
  cable_crossover: ['front_raise', CABLE],
  machine_chest_press: ['bench_press', ['floor', 'bench']],
  pec_deck: ['front_raise', FLOOR],
  incline_push_up: 'push_up',
  knee_push_up: 'push_up',
  diamond_push_up: 'push_up',
  // back
  one_arm_dumbbell_row: ['row', DB],
  t_bar_row: 'row',
  inverted_row: ['row', FLOOR],
  chin_up: 'pull_up',
  assisted_pull_up: 'pull_up',
  close_grip_pulldown: 'lat_pulldown',
  straight_arm_pulldown: 'pushdown',
  face_pull: ['band_row', CABLE],
  single_arm_cable_row: 'cable_row',
  superman: 'superman',
  back_extension: ['hinge', FLOOR],
  rack_pull: 'deadlift',
  dumbbell_shrug: 'shrug',
  rear_delt_fly: ['row', DB],
  // shoulders
  dumbbell_shoulder_press: ['overhead_press', DB],
  seated_dumbbell_press: 'seat_press',
  arnold_press: ['overhead_press', DB],
  lateral_raise: 'front_raise',
  front_raise: 'front_raise',
  upright_row: 'upright',
  push_press: 'overhead_press',
  machine_shoulder_press: ['seat_press', MACHINE],
  cable_lateral_raise: ['front_raise', CABLE],
  pike_push_up: 'push_up',
  // biceps
  hammer_curl: 'bicep_curl',
  barbell_curl: ['bicep_curl', BAR],
  concentration_curl: 'bicep_curl',
  cable_curl: ['bicep_curl', CABLE],
  incline_dumbbell_curl: 'bicep_curl',
  band_curl: ['bicep_curl', ['floor', 'band']],
  // triceps
  triceps_pushdown: 'pushdown',
  overhead_triceps_extension: 'tri_overhead',
  skull_crusher: 'bench_press',
  close_grip_bench_press: 'bench_press',
  bench_dip: ['dip', FLOOR],
  triceps_kickback: 'kickback',
  band_pushdown: ['pushdown', FLOOR],
  machine_dip: 'dip',
  // forearms and grip
  wrist_curl: 'bicep_curl',
  reverse_wrist_curl: 'bicep_curl',
  reverse_curl: ['bicep_curl', BAR],
  farmers_carry: 'shrug',
  dead_hang: 'pull_up',
  // core
  plank: 'plank',
  side_plank: 'plank',
  crunch: 'crunch',
  bicycle_crunch: 'crunch',
  sit_up: 'crunch',
  lying_leg_raise: 'leg_raise',
  hanging_knee_raise: 'hang_knee',
  russian_twist: 'vsit',
  mountain_climber: 'mountain',
  dead_bug: 'leg_raise',
  bird_dog: 'plank',
  cable_crunch: 'crunch',
  pallof_press: ['front_raise', CABLE],
  // glutes
  hip_thrust: 'hip_thrust',
  single_leg_glute_bridge: 'glute_bridge',
  donkey_kick: 'plank',
  fire_hydrant: 'plank',
  cable_kickback: ['plank', CABLE],
  step_up: 'lunge',
  banded_lateral_walk: 'bodyweight_squat',
  // quads
  front_squat: ['squat', BAR],
  sumo_squat: 'goblet_squat',
  bulgarian_split_squat: 'lunge',
  reverse_lunge: 'lunge',
  walking_lunge: 'lunge',
  leg_press: 'leg_press',
  leg_extension: 'leg_ext',
  wall_sit: 'wall_sit',
  jump_squat: 'bodyweight_squat',
  hack_squat: 'bodyweight_squat',
  // hamstrings
  romanian_deadlift: 'hinge',
  dumbbell_romanian_deadlift: ['hinge', DB],
  leg_curl: 'leg_curl',
  good_morning: 'hinge',
  single_leg_deadlift: 'sldl',
  kettlebell_swing: 'swing',
  sumo_deadlift: 'deadlift',
  // calves
  standing_calf_raise: 'calf_raise',
  seated_calf_raise: 'calf_raise',
  single_leg_calf_raise: 'calf_raise',
  // full body
  burpee: 'burpee',
  thruster: 'thruster',
  kettlebell_clean_and_press: ['overhead_press', ['floor', 'kettlebell']],
  jumping_jack: 'jack',
  bear_crawl: 'mountain',
};
const ART: Record<string, ArtSpec> = { ...Object.fromEntries(Object.keys(BASE).map((id) => [id, id])), ...FREE };
const TEMPLATES: Record<string, Template> = { ...BASE, ...EXTRA };

type ExerciseDrawing = Template;

const DRAWINGS: Record<string, ExerciseDrawing> = Object.fromEntries(
  Object.entries(ART).map(([id, spec]): [string, ExerciseDrawing] => {
    const [name, gear] = typeof spec === 'string' ? [spec, undefined] : spec;
    const t = TEMPLATES[name]!;
    return [id, { start: t.start, end: t.end, equipment: [...(gear ?? t.equipment)] }];
  }),
);

// ---- muscles ----------------------------------------------------------------------------------------

/** How hard each body zone works: 0 not at all, 1 helps, 2 main mover. */
interface Levels {
  delt: number;
  upper: number;
  core: number;
  glute: number;
  thigh: number;
  calf: number;
  arm: number;
  fore: number;
}
const ZONE: Record<string, keyof Levels> = {
  shoulders: 'delt',
  chest: 'upper',
  back: 'upper',
  lats: 'upper',
  traps: 'upper',
  core: 'core',
  glutes: 'glute',
  quads: 'thigh',
  hamstrings: 'thigh',
  calves: 'calf',
  biceps: 'arm',
  triceps: 'arm',
  forearms: 'fore',
};

/** The zones an exercise works, from the library's own primary and secondary muscles. */
function levelsFor(exerciseId: string): Levels {
  const out: Levels = { delt: 0, upper: 0, core: 0, glute: 0, thigh: 0, calf: 0, arm: 0, fore: 0 };
  const e = EXERCISE_BY_ID.get(exerciseId);
  if (!e) return out;
  for (const m of e.secondaryMuscles) {
    const z = ZONE[m];
    if (z) out[z] = Math.max(out[z], 1);
  }
  for (const m of e.primaryMuscles) {
    const z = ZONE[m];
    if (z) out[z] = 2;
  }
  return out;
}

/** A colour part of the way from `a` to `b` (both #RRGGBB; anything else leaves `a`). */
function mixHex(a: string, b: string, t: number): string {
  const ok = /^#[0-9a-f]{6}$/i;
  if (!ok.test(a) || !ok.test(b)) return a;
  const ch = (s: string, i: number) => parseInt(s.slice(1 + 2 * i, 3 + 2 * i), 16);
  const hex = (i: number) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t).toString(16).padStart(2, '0');
  return `#${hex(0)}${hex(1)}${hex(2)}`;
}

/** The anatomy model's greys, per tone: body, far side, fine seams, outline. */
const GREY = ANATOMY;
const workOf = (t: ArtTone) => artPalettes[t].figure.work;
const assistOf = (t: ArtTone) => mixHex(GREY[t].base, workOf(t), 0.5);

const HEAD_R = 10;
const TORSO_W = [10, 8.6, 10.5] as const;
const THIGH_W = [8.8, 8.2, 6.4] as const;
const LEG_W = [8.4, 6.6, 3.8] as const;
const CALF_W = [6.4, 6.6, 3.8] as const;
const ARM_W = [5.8, 4.8, 3.3] as const;
const FORE_W = [4.6, 4.2, 3.1] as const;
/** How far the far-side leg peeks out from behind the near one when the pose gives no second leg. */
const FAR_LEG_DX = 5;

/** The colours the art uses, so a legend elsewhere can match the picture instead of hard-coding a hex. */
export const EXERCISE_ART_COLORS = { work: workOf(scheme), assist: assistOf(scheme), ghost: GREY[scheme].seam, body: GREY[scheme].base } as const;

const lerpPoint = (a: P, b: P, t: number): P => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Linear interpolation of every joint the two poses share (including a lunge's knee2/foot2). */
export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const out: Record<string, P> = {};
  for (const key of Object.keys(a) as (keyof Pose)[]) {
    const from = a[key];
    const to = b[key];
    if (from && to) out[key] = lerpPoint(from, to, t);
  }
  return out as unknown as Pose;
}

/** The eased pose at `t` (0 = start, 1 = end) for an exercise; null for an unknown id. */
export function poseAt(exerciseId: string, t: number): Pose | null {
  const d = DRAWINGS[exerciseId];
  if (!d) return null;
  const c = Math.min(1, Math.max(0, t));
  return lerpPose(d.start, d.end, 0.5 - 0.5 * Math.cos(Math.PI * c));
}

const DEFAULT_LOOP_MS = 2400;
const FRAME_MS = 1000 / 24;
/** Where the cosine wave counts as at rest: about 15% of the loop is spent holding each extreme. */
const REST = 0.055;

/** Loop phase (0..1) to progress between start (0) and end (1): a cosine ease with a short hold at each end. */
function loopProgress(phase: number): number {
  const wave = 0.5 - 0.5 * Math.cos(2 * Math.PI * phase);
  return Math.min(1, Math.max(0, (wave - REST) / (1 - 2 * REST)));
}

// ---- geometry -------------------------------------------------------------------------------------

type V = P;
const R1 = (n: number) => Math.round(n * 10) / 10;
const fp = (x: number, y: number) => `${R1(x)} ${R1(y)}`;
const unit = (x: number, y: number): V => {
  const l = Math.hypot(x, y) || 1;
  return [x / l, y / l];
};
const mix = (a: V, b: V, t: number): V => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const nudge = (p: V, dx: number, dy: number): V => [p[0] + dx, p[1] + dy];
/** The direction light arrives from (top-left), as a unit vector. */
const LIT = unit(-0.58, -0.81);

/** Smooth curve through the points (Catmull-Rom as cubic Beziers). */
function curve(pts: readonly V[]): string {
  let s = '';
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[Math.min(pts.length - 1, i + 2)]!;
    s += `C${fp(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)} ${fp(p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)} ${fp(p2[0], p2[1])}`;
  }
  return s;
}

/**
 * A soft tapered limb along the points, with a half-width at each, as one closed shape (so it can wear
 * the outline). With `shade` it is only the strip along the side away from the light, covering that
 * fraction of the width.
 */
function tube(pts: readonly V[], hw: readonly number[], shade = 0): string {
  const n = pts.length;
  const nor: V[] = pts.map((_, i) => {
    const a = pts[Math.max(0, i - 1)]!;
    const b = pts[Math.min(n - 1, i + 1)]!;
    const [tx, ty] = unit(b[0] - a[0], b[1] - a[1]);
    return [-ty, tx];
  });
  let away = 0;
  if (shade) {
    const m = nor[n >> 1]!;
    away = m[0] * LIT[0] + m[1] * LIT[1] > 0 ? -1 : 1;
  }
  const centre = pts.map((p, i) => (shade ? nudge(p, nor[i]![0] * away * shade * hw[i]!, nor[i]![1] * away * shade * hw[i]!) : p));
  const w = hw.map((h) => (shade ? h * (1 - shade) : h));
  const left = centre.map((p, i) => nudge(p, nor[i]![0] * w[i]!, nor[i]![1] * w[i]!));
  const right = centre.map((p, i) => nudge(p, -nor[i]![0] * w[i]!, -nor[i]![1] * w[i]!)).reverse();
  const l0 = left[0]!;
  const r0 = right[0]!;
  return `M${fp(l0[0], l0[1])}${curve(left)}A${R1(w[n - 1]!)} ${R1(w[n - 1]!)} 0 0 0 ${fp(r0[0], r0[1])}${curve(right)}A${R1(w[0]!)} ${R1(w[0]!)} 0 0 0 ${fp(l0[0], l0[1])}Z`;
}

/** The shoulder: just below the base of the neck, along the torso. */
function shoulder(p: Pose): V {
  const [ux, uy] = unit(p.hip[0] - p.neck[0], p.hip[1] - p.neck[1]);
  return [p.neck[0] + ux * 6.5, p.neck[1] + uy * 6.5];
}

/** A running shoe at the ankle: flat on the floor when the shin is upright, otherwise turned with the shin. */
function shoeD(foot: V, knee: V): string {
  const dx = foot[0] - knee[0];
  const dy = foot[1] - knee[1];
  const steep = Math.abs(dy) / (Math.abs(dx) + Math.abs(dy) || 1);
  const planted = Math.min(1, Math.max(0, (steep - 0.4) / 0.15)) * Math.min(1, Math.max(0, (foot[1] - 118) / 8));
  const [px, py] = unit(dy, -dx); // perpendicular to the shin, pointing forward
  const [tx, ty] = unit(px + (1 - px) * planted, py - py * planted);
  const sx = -ty;
  const sy = tx;
  const at = (x: number, y: number) => fp(foot[0] + tx * x + sx * y, foot[1] + ty * x + sy * y);
  return `M${at(-5.5, -5)}L${at(-5.5, 0.5)}Q${at(-5.5, 2)} ${at(-3.5, 2)}L${at(8.5, 2)}Q${at(12.2, 2)} ${at(12.2, -0.9)}Q${at(12.2, -2.8)} ${at(8.5, -3.4)}Q${at(4.5, -3.8)} ${at(2.5, -5)}Z`;
}

/** The front of a limb or the torso: the side its muscles bulge towards when the figure faces right. */
const frontOf = (a: V, b: V, torso: boolean): V => {
  const [x, y] = unit(b[0] - a[0], b[1] - a[1]);
  // Torso: hip to shoulder, the belly is to the right of that. Limbs run the other way (joint to joint downwards).
  return torso ? [-y, x] : [y, -x];
};
/** A line running along a limb from `t0` to `t1`, pushed `off` towards `side`. */
const along = (a: V, b: V, t0: number, t1: number, off: number, side: V): string => {
  const p0 = mix(a, b, t0);
  const p1 = mix(a, b, t1);
  return `M${fp(p0[0] + side[0] * off, p0[1] + side[1] * off)}L${fp(p1[0] + side[0] * off, p1[1] + side[1] * off)}`;
};
/** A short line across a limb at `t`, from `off0` to `off1` towards `side`. */
const across = (a: V, b: V, t: number, off0: number, off1: number, side: V): string => {
  const m = mix(a, b, t);
  return `M${fp(m[0] + side[0] * off0, m[1] + side[1] * off0)}L${fp(m[0] + side[0] * off1, m[1] + side[1] * off1)}`;
};

/** The pieces of one pose shared by the figure and its ghost. */
function rig(pose: Pose) {
  const S = shoulder(pose);
  const mid = mix(pose.hip, S, 0.5);
  return {
    S,
    mid,
    thigh: [pose.hip, mix(pose.hip, pose.knee, 0.5), pose.knee] as V[],
    calf: [pose.knee, mix(pose.knee, pose.foot, 0.32), pose.foot] as V[],
    lower: [pose.hip, mix(pose.hip, mid, 0.5), mid] as V[],
    upper: [mid, mix(mid, S, 0.5), S] as V[],
    arm: [S, mix(S, pose.elbow, 0.5), pose.elbow] as V[],
    fore: [pose.elbow, mix(pose.elbow, pose.hand, 0.5), pose.hand] as V[],
  };
}

/** Fine muscle seams over the near side of the figure: abs and ribs, pec and shoulder blade, quad sweep, calf, arm. */
function seamsD(pose: Pose): string {
  const { S, mid } = rig(pose);
  const tf = frontOf(pose.hip, S, true);
  const tb: V = [-tf[0], -tf[1]];
  const lf = frontOf(pose.hip, pose.knee, false);
  const cf = frontOf(pose.knee, pose.foot, false);
  const af = frontOf(S, pose.elbow, false);
  const ff = frontOf(pose.elbow, pose.hand, false);
  return [
    across(pose.hip, mid, 0.25, -1, 8.5, tf),
    across(pose.hip, mid, 0.55, -1, 8.5, tf),
    across(pose.hip, mid, 0.85, -1, 8.5, tf),
    across(mid, S, 0.45, 0, 8.6, tf),
    across(mid, S, 0.4, 1, 8, tb),
    along(pose.hip, pose.knee, 0.18, 0.86, 2.6, lf),
    along(pose.hip, pose.knee, 0.22, 0.8, 2.8, [-lf[0], -lf[1]]),
    across(pose.knee, pose.foot, 0.3, -5.5, 5.5, cf),
    along(pose.knee, pose.foot, 0.12, 0.62, 2.2, [-cf[0], -cf[1]]),
    along(S, pose.elbow, 0.2, 0.85, 2, af),
    along(pose.elbow, pose.hand, 0.1, 0.75, 1.4, ff),
  ].join('');
}

// ---- kit ------------------------------------------------------------------------------------------

interface Kit {
  a: ArtPalette;
  t: ArtTone;
  /** Band colour. */
  primary: string;
  uid: string;
  /** Thumbnail: flat fills, no shade strips, no small details. */
  lite: boolean;
  /** Outline width: the standard line, or bold on a thumb so it survives the scale. */
  line: number;
}

function makeKit(tone: ArtTone | undefined, uid: string, lite: boolean): Kit {
  const t = tone ?? scheme;
  return { a: artPalettes[t], t, primary: palettes[t].primary, uid, lite, line: lite ? STROKE.bold : STROKE.line };
}

type MetalKey = 'iron' | 'rubber' | 'chrome';
const METAL_ID: Record<MetalKey, string> = { iron: 'i', rubber: 'r', chrome: 'c' };
/** A metal's fill: its gradient, or its body colour on a thumb. */
const metalFill = (kit: Kit, m: MetalKey) => (kit.lite ? METALS[m].mid : `url(#${kit.uid}${METAL_ID[m]})`);

function Grad({ id, m }: { id: string; m: Metal }) {
  return (
    <LinearGradient id={id} {...LIGHT_DIR}>
      <Stop offset="0" stopColor={m.hi} />
      <Stop offset="0.5" stopColor={m.mid} />
      <Stop offset="1" stopColor={m.lo} />
    </LinearGradient>
  );
}

// ---- equipment ------------------------------------------------------------------------------------

/** Gear that stands still behind the figure: drawn once, in the static layer. */
const STATIC_GEAR: readonly Equipment[] = ['bench', 'bench_end', 'rails', 'seat', 'bar', 'band', 'cable'];
const GEAR_METALS: Record<Equipment, MetalKey[]> = {
  plate: ['rubber', 'chrome'],
  dumbbell: ['chrome', 'iron'],
  kettlebell: ['iron'],
  bench: ['rubber', 'iron'],
  bench_end: ['rubber', 'iron'],
  rails: ['chrome', 'iron'],
  band: ['iron', 'chrome'],
  cable: ['iron', 'chrome'],
  pulldown: ['chrome'],
  bar: ['iron', 'chrome'],
  seat: ['rubber', 'iron'],
  floor: [],
};

function metalEdge(m: MetalKey, kit: Kit) {
  return { stroke: METALS[m].lo, strokeWidth: kit.lite ? STROKE.line : STROKE.hair, strokeLinejoin: 'round' } as const;
}

function StaticGear({ kind, kit, hip }: { kind: Equipment; kit: Kit; hip: V }) {
  const iron = metalFill(kit, 'iron');
  const rubber = metalFill(kit, 'rubber');
  const chrome = metalFill(kit, 'chrome');
  switch (kind) {
    case 'bench':
      return (
        <>
          <Rect x={48} y={118} width={6} height={12} rx={2} fill={iron} {...metalEdge('iron', kit)} />
          <Rect x={116} y={118} width={6} height={12} rx={2} fill={iron} {...metalEdge('iron', kit)} />
          <Rect x={38} y={110} width={92} height={8} rx={4} fill={rubber} {...metalEdge('rubber', kit)} />
        </>
      );
    case 'bench_end':
      return (
        <>
          <Rect x={40} y={118} width={6} height={12} rx={2} fill={iron} {...metalEdge('iron', kit)} />
          <Rect x={32} y={110} width={44} height={8} rx={4} fill={rubber} {...metalEdge('rubber', kit)} />
        </>
      );
    case 'rails':
      return (
        <>
          <Rect x={98} y={96} width={5} height={34} rx={2} fill={iron} {...metalEdge('iron', kit)} />
          <Rect x={84} y={92} width={34} height={4.5} rx={2.2} fill={chrome} {...metalEdge('chrome', kit)} />
        </>
      );
    case 'seat':
      return (
        <>
          <Rect x={hip[0] - 3} y={hip[1] + 14} width={6} height={130 - hip[1] - 14} rx={2} fill={iron} {...metalEdge('iron', kit)} />
          <Rect x={hip[0] - 16} y={hip[1] + 7.5} width={32} height={7} rx={3.5} fill={rubber} {...metalEdge('rubber', kit)} />
        </>
      );
    case 'bar':
      return (
        <>
          <Rect x={58} y={18} width={5} height={112} rx={2} fill={iron} {...metalEdge('iron', kit)} />
          <Rect x={146} y={18} width={5} height={112} rx={2} fill={iron} {...metalEdge('iron', kit)} />
          <Rect x={55} y={15.5} width={98} height={5} rx={2.5} fill={chrome} {...metalEdge('chrome', kit)} />
        </>
      );
    case 'band':
      return (
        <>
          <Rect x={176} y={40} width={6} height={90} rx={2} fill={iron} {...metalEdge('iron', kit)} />
          {kit.lite ? null : <Circle cx={179} cy={56} r={3.2} fill={chrome} {...metalEdge('chrome', kit)} />}
        </>
      );
    case 'cable':
      return (
        <>
          <Rect x={137} y={104} width={6} height={22} rx={2} fill={iron} {...metalEdge('iron', kit)} />
          <Rect x={180} y={62} width={12} height={68} rx={3} fill={iron} {...metalEdge('iron', kit)} />
          {kit.lite ? null : <Path d="M183.5 76H188.5M183.5 106H188.5M183.5 116H188.5" fill="none" stroke={METALS.iron.rim} strokeWidth={STROKE.hair} strokeLinecap="round" />}
          <Circle cx={182} cy={92} r={5} fill={chrome} {...metalEdge('chrome', kit)} />
        </>
      );
    default:
      return null;
  }
}

/** Gear that moves with the hands: redrawn every frame. */
function LiveGear({ kind, kit, pose, at }: { kind: Equipment; kit: Kit; pose: Pose; at?: V }) {
  const [hx, hy] = at ?? pose.hand;
  const iron = metalFill(kit, 'iron');
  const rubber = metalFill(kit, 'rubber');
  const chrome = metalFill(kit, 'chrome');
  switch (kind) {
    case 'plate': {
      // A barbell seen end-on, resting on the floor if it is low enough to touch it.
      const cy = Math.min(hy, 114);
      return (
        <>
          <Circle cx={hx} cy={cy} r={14.5} fill={rubber} stroke={METALS.rubber.rim} strokeWidth={kit.line} />
          {kit.lite ? null : <Circle cx={hx} cy={cy} r={9.5} fill="none" stroke={METALS.rubber.rim} strokeWidth={STROKE.hair} />}
          <Circle cx={hx} cy={cy} r={3.8} fill={chrome} {...metalEdge('chrome', kit)} />
        </>
      );
    }
    case 'dumbbell':
      return (
        <>
          <Rect x={hx - 9} y={hy - 2.2} width={18} height={4.4} rx={2.2} fill={chrome} {...metalEdge('chrome', kit)} />
          <Rect x={hx - 14.5} y={hy - 7} width={6.5} height={14} rx={2.5} fill={iron} {...metalEdge('iron', kit)} />
          <Rect x={hx + 8} y={hy - 7} width={6.5} height={14} rx={2.5} fill={iron} {...metalEdge('iron', kit)} />
        </>
      );
    case 'kettlebell':
      return (
        <>
          <Path d={`M${fp(hx - 5, hy + 4)}Q${fp(hx - 5, hy - 6)} ${fp(hx, hy - 6)}Q${fp(hx + 5, hy - 6)} ${fp(hx + 5, hy + 4)}`} fill="none" stroke={METALS.iron.lo} strokeWidth={STROKE.bold} strokeLinecap="round" />
          <Circle cx={hx} cy={hy + 10} r={9} fill={iron} {...metalEdge('iron', kit)} />
        </>
      );
    case 'band':
      return <Line x1={hx} y1={hy} x2={179} y2={56} stroke={kit.primary} strokeWidth={STROKE.bold} strokeLinecap="round" />;
    case 'cable':
      return (
        <>
          <Line x1={hx} y1={hy} x2={182} y2={92} stroke={METALS.chrome.lo} strokeWidth={STROKE.line} strokeLinecap="round" />
          <Rect x={hx - 2.2} y={hy - 5.5} width={4.4} height={11} rx={2.2} fill={iron} {...metalEdge('iron', kit)} />
        </>
      );
    case 'pulldown':
      return (
        <>
          <Line x1={hx} y1={hy} x2={hx} y2={0} stroke={METALS.chrome.lo} strokeWidth={STROKE.line} strokeLinecap="round" />
          <Rect x={hx - 22} y={hy - 2.2} width={40} height={4.4} rx={2.2} fill={chrome} {...metalEdge('chrome', kit)} />
        </>
      );
    default:
      return null;
  }
}

// ---- static layers (memoised, fed only primitives) --------------------------------------------------

/** Floor, contact shadow, gradients and the gear that stands still. Never redrawn by the animation. */
const Backdrop = memo(function Backdrop({ id, tone, uid, lite }: { id: string; tone: ArtTone | undefined; uid: string; lite: boolean }) {
  const d = DRAWINGS[id];
  if (!d) return null;
  const kit = makeKit(tone, uid, lite);
  const used = new Set<MetalKey>(d.equipment.flatMap((k) => GEAR_METALS[k]));
  return (
    <>
      {lite ? null : (
        <Defs>{(['iron', 'rubber', 'chrome'] as const).map((m) => (used.has(m) ? <Grad key={m} id={`${uid}${METAL_ID[m]}`} m={METALS[m]} /> : null))}</Defs>
      )}
      <Ellipse cx={100} cy={131} rx={70} ry={4} fill={kit.a.shadow} opacity={kit.a.shadowOpacity} />
      <Line x1={14} y1={130} x2={186} y2={130} stroke={kit.a.floorLine} strokeWidth={STROKE.line} strokeLinecap="round" />
      {d.equipment
        .filter((k) => STATIC_GEAR.includes(k))
        .map((k) => (
          <StaticGear key={k} kind={k} kit={kit} hip={d.end.hip} />
        ))}
    </>
  );
});

/** The start position as one faint silhouette in a single colour: cheap, and never redrawn. */
const Ghost = memo(function Ghost({ id, tone }: { id: string; tone: ArtTone | undefined }) {
  const d = DRAWINGS[id];
  if (!d) return null;
  const t = tone ?? scheme;
  const p = d.start;
  const r = rig(p);
  const parts = [tube([p.hip, r.mid, r.S], TORSO_W), tube([p.hip, p.knee, p.foot], LEG_W), tube([...r.arm, p.hand], [...ARM_W, 3])];
  if (p.knee2 && p.foot2) parts.push(tube([p.hip, p.knee2, p.foot2], LEG_W));
  const color = GREY[t].seam;
  return (
    <G opacity={t === 'dark' ? 0.42 : 0.34}>
      <Path d={parts.join('')} fill={color} />
      <Circle cx={p.head[0]} cy={p.head[1]} r={HEAD_R} fill={color} />
    </G>
  );
});

/** For an exercise with no picture yet: a neutral, dashed standing figure. */
const Placeholder = memo(function Placeholder({ tone, lite }: { tone: ArtTone | undefined; lite: boolean }) {
  const a = artPalettes[tone ?? scheme];
  const dash = { fill: a.figure.ghost, fillOpacity: 0.16, stroke: a.figure.ghost, strokeWidth: lite ? STROKE.bold : STROKE.line, strokeDasharray: lite ? '5 4' : '4 3', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
  return (
    <>
      <Ellipse cx={100} cy={131} rx={34} ry={3.4} fill={a.shadow} opacity={a.shadowOpacity} />
      {lite ? null : <Line x1={14} y1={130} x2={186} y2={130} stroke={a.floorLine} strokeWidth={STROKE.line} strokeLinecap="round" />}
      <Circle cx={100} cy={31} r={11.5} {...dash} />
      <Path
        d="M100 47C88 47 79 52 77 63L74 88Q73.5 93 78.5 93Q83.5 93 84 88L86 71L87.5 92L89 126Q89.2 129 92.5 129L98 129L100 97L102 129L107.5 129Q110.8 129 111 126L112.5 92L114 71L116 88Q116.5 93 121.5 93Q126.5 93 126 88L123 63C121 52 112 47 100 47Z"
        {...dash}
      />
    </>
  );
});

// ---- the live figure ----------------------------------------------------------------------------------

/**
 * The anatomy model. Back to front: the back-squat bar, the far leg and arm (shade), the near leg and
 * foot, the pelvis, the torso in two halves (core below, chest and back above), any gear the hands
 * hold, the near arm, the shoulder cap and hand, then the head. Each muscle zone is filled grey, the
 * soft tint (helps) or the accent (main mover).
 */
function Figure({ pose, lv, kit, back, held }: { pose: Pose; lv: Levels; kit: Kit; back?: ReactNode; held?: ReactNode }) {
  const { t, lite, line } = kit;
  const g = GREY[t];
  const fill = (level: number) => (level >= 2 ? workOf(t) : level === 1 ? assistOf(t) : g.base);
  const r = rig(pose);
  const hasFarLeg = Boolean(pose.knee2 && pose.foot2);
  const farKnee: V = pose.knee2 ?? nudge(pose.knee, FAR_LEG_DX, 0);
  const farFoot: V = pose.foot2 ?? nudge(pose.foot, FAR_LEG_DX, 0);
  const farElbow = nudge(pose.elbow, -3, 1);
  const farHand = nudge(pose.hand, -2.5, 1);
  const edged = { stroke: g.edge, strokeWidth: line, strokeLinejoin: 'round' } as const;
  const pelvis = nudge(pose.hip, -1.5, 0);
  const shade = lite
    ? ''
    : [tube(r.thigh, THIGH_W, 0.6), tube(r.calf, CALF_W, 0.6), tube(r.lower, TORSO_W, 0.6), tube(r.upper, TORSO_W, 0.6), tube(r.arm, ARM_W, 0.6), tube(r.fore, FORE_W, 0.6)].join('');

  return (
    <>
      {back}
      {hasFarLeg || !lite ? (
        <>
          <Path d={tube([pose.hip, farKnee, farFoot], LEG_W)} fill={g.shade} {...edged} />
          <Path d={shoeD(farFoot, farKnee)} fill={g.foot} {...edged} />
        </>
      ) : null}
      {lite ? null : <Path d={tube([r.S, farElbow, farHand], ARM_W)} fill={g.shade} {...edged} />}
      <Path d={tube([pose.neck, pose.head], [4, 4])} fill={g.shade} {...edged} />
      <Path d={tube(r.thigh, THIGH_W)} fill={fill(lv.thigh)} {...edged} />
      <Path d={tube(r.calf, CALF_W)} fill={fill(lv.calf)} {...edged} />
      <Path d={shoeD(pose.foot, pose.knee)} fill={g.foot} {...edged} />
      <Circle cx={pelvis[0]} cy={pelvis[1]} r={9} fill={fill(lv.glute)} {...edged} />
      <Path d={tube(r.lower, TORSO_W)} fill={fill(lv.core)} {...edged} />
      <Path d={tube(r.upper, TORSO_W)} fill={fill(lv.upper)} {...edged} />
      {held}
      <Path d={tube(r.arm, ARM_W)} fill={fill(lv.arm)} {...edged} />
      <Path d={tube(r.fore, FORE_W)} fill={fill(lv.fore)} {...edged} />
      <Circle cx={r.S[0]} cy={r.S[1]} r={6.4} fill={fill(lv.delt)} {...edged} />
      {lite ? null : <Path d={shade} fill={g.edge} opacity={t === 'dark' ? 0.3 : 0.2} />}
      {lite ? null : <Path d={seamsD(pose)} fill="none" stroke={g.seam} strokeWidth={STROKE.hair} strokeLinecap="round" />}
      <Circle cx={pose.hand[0]} cy={pose.hand[1]} r={lite ? 4.4 : 3.9} fill={g.base} {...edged} />
      <Circle cx={pose.head[0]} cy={pose.head[1]} r={HEAD_R} fill={g.base} {...edged} />
    </>
  );
}

/** Exercises whose bar rests across the back, so the plate is drawn at the neck instead of in the hands. */
const BACK_BAR = new Set(['squat']);

/** A movement picture for any exercise id (a dashed placeholder figure for an id with no drawing yet). */
export function ExerciseArt({
  exerciseId,
  name,
  size = 'card',
  decorative,
  style,
  animated = false,
  loopMs = DEFAULT_LOOP_MS,
  tone,
}: {
  exerciseId: string;
  name?: string;
  size?: 'thumb' | 'card' | 'hero';
  /** Hide from screen readers when the surrounding row already names the exercise. */
  decorative?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Play the movement start to finish on a loop (skipped under reduced motion). Leave off in lists. */
  animated?: boolean;
  /** Length of one full start-finish-start loop. */
  loopMs?: number;
  /** Draw in this tone instead of the app's scheme (the gallery shows both). */
  tone?: ArtTone;
}) {
  const d = DRAWINGS[exerciseId];
  // Every instance of a tone defines the same gradients, so one id per tone is enough (and keeps the tree identical between mounts).
  const uid = `ex${tone ?? scheme}`;
  const reduceMotion = useReducedMotion();
  // An id with no drawing is a still placeholder, so it never starts the frame loop.
  const play = animated && !reduceMotion && d !== undefined;
  const [phase, setPhase] = useState(0);
  // The frame loop runs only while the app is in the foreground, so a backgrounded app burns no CPU.
  useEffect(() => {
    if (!play) return;
    const period = Math.max(300, loopMs);
    let id: ReturnType<typeof setInterval> | undefined;
    let began = 0;
    let elapsed = 0; // carried across a pause so the figure resumes where it left off
    const start = () => {
      if (id !== undefined) return;
      began = Date.now() - elapsed;
      id = setInterval(() => setPhase(((Date.now() - began) / period) % 1), FRAME_MS);
    };
    const stop = () => {
      if (id === undefined) return;
      clearInterval(id);
      id = undefined;
      elapsed = Date.now() - began;
    };
    const state = AppState.currentState;
    if (state !== 'background' && state !== 'inactive') start();
    const sub = AppState.addEventListener('change', (next) => (next === 'active' ? start() : stop()));
    return () => {
      sub.remove();
      stop();
    };
  }, [play, loopMs]);

  const height = size === 'thumb' ? 56 : size === 'card' ? 140 : 200;
  const lite = size === 'thumb';
  const label = d ? `${name ?? 'Exercise'} illustration` : `${name ?? 'Exercise'} illustration coming soon`;
  const kit = makeKit(tone, uid, lite);
  let figure: ReactNode;
  if (d) {
    const live = play ? lerpPose(d.start, d.end, loopProgress(phase)) : d.end;
    const backBar = BACK_BAR.has(exerciseId);
    const held = d.equipment
      .filter((k) => !STATIC_GEAR.includes(k) && k !== 'floor' && !(k === 'plate' && backBar))
      .map((k) => <LiveGear key={k} kind={k} kit={kit} pose={live} />);
    // Bands and cables run to the hand; the static part of the same gear sits behind in the backdrop.
    for (const k of d.equipment) if ((k === 'band' || k === 'cable') && STATIC_GEAR.includes(k)) held.push(<LiveGear key={`${k}-line`} kind={k} kit={kit} pose={live} />);
    const back = backBar ? <LiveGear kind="plate" kit={kit} pose={live} at={[live.neck[0] - 2, live.neck[1] + 1]} /> : undefined;
    figure = (
      <>
        <Backdrop id={exerciseId} tone={tone} uid={uid} lite={lite} />
        {lite ? null : <Ghost id={exerciseId} tone={tone} />}
        <Figure pose={live} lv={levelsFor(exerciseId)} kit={kit} back={back} held={held} />
      </>
    );
  } else {
    figure = <Placeholder tone={tone} lite={lite} />;
  }
  return (
    <View
      style={[{ height, aspectRatio: 200 / 140 }, style]}
      {...(decorative
        ? {
            accessible: false,
            importantForAccessibility: 'no-hide-descendants' as const,
            'aria-hidden': true,
          }
        : {
            accessible: true,
            accessibilityRole: 'image' as const,
            accessibilityLabel: label,
          })}>
      <Svg width="100%" height="100%" viewBox="0 0 200 140">
        {figure}
      </Svg>
    </View>
  );
}

/** A small rounded tile with the exercise drawing, for list rows. */
export function ExerciseThumb({ exerciseId, size = 52, tone }: { exerciseId: string; size?: number; tone?: ArtTone }) {
  return (
    <View
      style={{
        width: size * 1.25,
        height: size,
        borderRadius: 12,
        backgroundColor: artPalettes[tone ?? scheme].surface,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}>
      <ExerciseArt exerciseId={exerciseId} size="thumb" decorative tone={tone} style={{ height: size * 0.95 }} />
    </View>
  );
}

export const ILLUSTRATED_EXERCISES = Object.keys(DRAWINGS);
