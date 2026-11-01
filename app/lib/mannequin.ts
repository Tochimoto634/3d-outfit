/**
 * Parametric mannequin proportions for storefront try-on MVP.
 * No TRELLIS / photo scan — BMI + TO-43 body categories (+ optional cm).
 */

export type MannequinGender = "female" | "male" | "unspecified";

export type BodyCategories = {
  muscle: "normal" | "slim" | "toned" | "muscular";
  legLength: "normal" | "short" | "long";
  shoulder: "normal" | "narrow" | "wide";
  waist: "normal" | "slim" | "thick";
  hip: "normal" | "narrow" | "wide";
  cup: "normal" | "a" | "b" | "c" | "d" | "e_plus" | null;
  chestThickness: "normal" | "flat" | "thick" | "very_thick" | null;
};

export type MannequinInput = {
  /** cm */
  heightCm: number;
  /** kg */
  weightKg: number;
  gender: MannequinGender;
  body?: Partial<BodyCategories> | null;
  /** optional cm — demoted; categories are primary */
  bustCm?: number | null;
  waistCm?: number | null;
  hipCm?: number | null;
};

export type CategoryBias = {
  limb: number;
  shoulder: number;
  waist: number;
  hip: number;
  chest: number;
  leg: number;
};

export type MannequinProportions = {
  heightM: number;
  /** Unitless scale relative to a 170cm / BMI-22 reference */
  overallScale: number;
  shoulderScale: number;
  chestScale: number;
  waistScale: number;
  hipScale: number;
  limbThickness: number;
  torsoLength: number;
  legLength: number;
  bmi: number;
  gender: MannequinGender;
  body: BodyCategories;
  catBias: CategoryBias;
};

const REF_HEIGHT_CM = 170;
const REF_BMI = 22;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function circumferenceToRadiusScale(cm: number | null | undefined, fallbackCm: number) {
  const value = cm != null && Number.isFinite(cm) && cm > 0 ? cm : fallbackCm;
  return clamp(value / 90, 0.65, 1.55);
}

function pickCat<T extends string>(raw: unknown, allowed: readonly T[], fallback: T): T {
  const v = String(raw || "").trim() as T;
  return (allowed as readonly string[]).includes(v) ? v : fallback;
}

export function normalizeBodyCategories(
  raw: Partial<BodyCategories> | null | undefined,
  gender: MannequinGender,
): BodyCategories {
  const src = raw || {};
  return {
    muscle: pickCat(src.muscle, ["normal", "slim", "toned", "muscular"] as const, "normal"),
    legLength: pickCat(src.legLength, ["normal", "short", "long"] as const, "normal"),
    shoulder: pickCat(src.shoulder, ["normal", "narrow", "wide"] as const, "normal"),
    waist: pickCat(src.waist, ["normal", "slim", "thick"] as const, "normal"),
    hip: pickCat(src.hip, ["normal", "narrow", "wide"] as const, "normal"),
    cup:
      gender === "female"
        ? pickCat(src.cup, ["normal", "a", "b", "c", "d", "e_plus"] as const, "normal")
        : null,
    chestThickness:
      gender === "male"
        ? pickCat(
            src.chestThickness,
            ["normal", "flat", "thick", "very_thick"] as const,
            "normal",
          )
        : null,
  };
}

export function categoryBiases(cats: BodyCategories): CategoryBias {
  const muscleMap = { normal: 1, slim: 0.94, toned: 1.04, muscular: 1.1 } as const;
  const legMap = { normal: 1, short: 0.94, long: 1.06 } as const;
  const shoulderMap = { normal: 1, narrow: 0.94, wide: 1.08 } as const;
  const waistMap = { normal: 1, slim: 0.94, thick: 1.08 } as const;
  const hipMap = { normal: 1, narrow: 0.94, wide: 1.08 } as const;
  const cupMap = {
    normal: 1,
    a: 0.96,
    b: 1.0,
    c: 1.04,
    d: 1.08,
    e_plus: 1.12,
  } as const;
  const chestMap = {
    normal: 1,
    flat: 0.94,
    thick: 1.06,
    very_thick: 1.12,
  } as const;

  const limb = clamp(muscleMap[cats.muscle], 0.9, 1.12);
  const shoulderX = clamp(shoulderMap[cats.shoulder] * (0.7 + 0.3 * limb), 0.88, 1.14);
  const waistX = clamp(waistMap[cats.waist], 0.9, 1.12);
  const hipX = clamp(hipMap[cats.hip], 0.9, 1.12);
  const cup = cats.cup ? cupMap[cats.cup] : 1;
  const chestT = cats.chestThickness ? chestMap[cats.chestThickness] : 1;
  const chestX = clamp(cup * chestT * (0.85 + 0.15 * limb), 0.9, 1.16);
  const legY = clamp(legMap[cats.legLength], 0.92, 1.08);

  const spread =
    Math.abs(limb - 1) +
    Math.abs(shoulderX - 1) +
    Math.abs(waistX - 1) +
    Math.abs(hipX - 1) +
    Math.abs(chestX - 1) +
    Math.abs(legY - 1);
  const damp = spread > 0.35 ? 0.35 / spread : 1;
  const towardOne = (v: number) => 1 + (v - 1) * damp;

  return {
    limb: towardOne(limb),
    shoulder: towardOne(shoulderX),
    waist: towardOne(waistX),
    hip: towardOne(hipX),
    chest: towardOne(chestX),
    leg: towardOne(legY),
  };
}

/**
 * Build body proportions used by the storefront Three.js mannequin.
 */
export function buildMannequinProportions(input: MannequinInput): MannequinProportions {
  const heightCm = clamp(Number(input.heightCm) || REF_HEIGHT_CM, 120, 220);
  const weightKg = clamp(Number(input.weightKg) || 60, 30, 200);
  const gender = input.gender || "unspecified";
  const body = normalizeBodyCategories(input.body, gender);
  const catBias = categoryBiases(body);

  const heightM = heightCm / 100;
  const bmi = weightKg / (heightM * heightM);
  const bmiFactor = clamp(Math.sqrt(bmi / REF_BMI), 0.75, 1.45);
  const overallScale = heightCm / REF_HEIGHT_CM;

  let shoulderBias = 1;
  let hipBias = 1;
  let chestBias = 1;
  if (gender === "male") {
    shoulderBias = 1.08;
    hipBias = 0.96;
    chestBias = 1.04;
  } else if (gender === "female") {
    shoulderBias = 0.94;
    hipBias = 1.08;
    chestBias = 1.02;
  }

  const defaultChest = 90 * bmiFactor * chestBias;
  const defaultWaist = 74 * bmiFactor;
  const defaultHip = 94 * bmiFactor * hipBias;

  const chestScale =
    circumferenceToRadiusScale(input.bustCm, defaultChest) *
    shoulderBias *
    catBias.chest;
  const waistScale =
    circumferenceToRadiusScale(input.waistCm, defaultWaist) * catBias.waist;
  const hipScale =
    circumferenceToRadiusScale(input.hipCm, defaultHip) * catBias.hip;
  const shoulderScale =
    chestScale * (gender === "male" ? 1.05 : 0.98) * catBias.shoulder;

  const legBase = 0.48 * overallScale;
  const torsoBase = 0.34 * overallScale;

  return {
    heightM,
    overallScale,
    shoulderScale,
    chestScale,
    waistScale,
    hipScale,
    limbThickness: clamp(bmiFactor * 0.95 * catBias.limb, 0.7, 1.4),
    torsoLength: torsoBase * (2 - catBias.leg),
    legLength: legBase * catBias.leg,
    bmi: Math.round(bmi * 10) / 10,
    gender,
    body,
    catBias,
  };
}

export type TryOnBodyPayload = {
  heightCm: number;
  weightKg: number;
  gender: MannequinGender;
  body: BodyCategories;
  bustCm?: number | null;
  waistCm?: number | null;
  hipCm?: number | null;
};

export function parseTryOnBody(raw: unknown): {
  ok: true;
  value: TryOnBodyPayload;
} | {
  ok: false;
  error: string;
} {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "身長・体重・性別を入力してください。" };
  }
  const body = raw as Record<string, unknown>;
  const heightCm = Number(body.heightCm);
  const weightKg = Number(body.weightKg);
  const genderRaw = String(body.gender || "").toLowerCase();
  const gender: MannequinGender =
    genderRaw === "female" || genderRaw === "male" || genderRaw === "unspecified"
      ? genderRaw
      : ("" as MannequinGender);

  if (!Number.isFinite(heightCm) || heightCm < 120 || heightCm > 220) {
    return { ok: false, error: "身長は 120〜220 cm で入力してください。" };
  }
  if (!Number.isFinite(weightKg) || weightKg < 30 || weightKg > 200) {
    return { ok: false, error: "体重は 30〜200 kg で入力してください。" };
  }
  if (!gender) {
    return { ok: false, error: "性別を選択してください。" };
  }

  const optional = (v: unknown) => {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const nested =
    body.body && typeof body.body === "object"
      ? (body.body as Partial<BodyCategories>)
      : {};

  return {
    ok: true,
    value: {
      heightCm,
      weightKg,
      gender,
      body: normalizeBodyCategories(nested, gender),
      bustCm: optional(body.bustCm),
      waistCm: optional(body.waistCm),
      hipCm: optional(body.hipCm),
    },
  };
}
