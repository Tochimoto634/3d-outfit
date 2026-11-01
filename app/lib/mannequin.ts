/**
 * Parametric mannequin proportions for storefront try-on MVP.
 * No TRELLIS / photo scan — simple BMI + optional three-size heuristics.
 */

export type MannequinGender = "female" | "male" | "unspecified";

export type MannequinInput = {
  /** cm */
  heightCm: number;
  /** kg */
  weightKg: number;
  gender: MannequinGender;
  /** optional cm */
  bustCm?: number | null;
  waistCm?: number | null;
  hipCm?: number | null;
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
};

const REF_HEIGHT_CM = 170;
const REF_BMI = 22;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function circumferenceToRadiusScale(cm: number | null | undefined, fallbackCm: number) {
  const value = cm != null && Number.isFinite(cm) && cm > 0 ? cm : fallbackCm;
  // Reference chest ~90cm → scale 1
  return clamp(value / 90, 0.65, 1.55);
}

/**
 * Build body proportions used by the storefront Three.js mannequin.
 */
export function buildMannequinProportions(input: MannequinInput): MannequinProportions {
  const heightCm = clamp(Number(input.heightCm) || REF_HEIGHT_CM, 120, 220);
  const weightKg = clamp(Number(input.weightKg) || 60, 30, 200);
  const gender = input.gender || "unspecified";

  const heightM = heightCm / 100;
  const bmi = weightKg / (heightM * heightM);
  const bmiFactor = clamp(Math.sqrt(bmi / REF_BMI), 0.75, 1.45);
  const overallScale = heightCm / REF_HEIGHT_CM;

  // Soft gender bias when three sizes are omitted
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
    circumferenceToRadiusScale(input.bustCm, defaultChest) * shoulderBias;
  const waistScale = circumferenceToRadiusScale(input.waistCm, defaultWaist);
  const hipScale = circumferenceToRadiusScale(input.hipCm, defaultHip);
  const shoulderScale = chestScale * (gender === "male" ? 1.05 : 0.98);

  return {
    heightM,
    overallScale,
    shoulderScale,
    chestScale,
    waistScale,
    hipScale,
    limbThickness: clamp(bmiFactor * 0.95, 0.7, 1.35),
    torsoLength: 0.34 * overallScale,
    legLength: 0.48 * overallScale,
    bmi: Math.round(bmi * 10) / 10,
    gender,
  };
}

export type TryOnBodyPayload = {
  heightCm: number;
  weightKg: number;
  gender: MannequinGender;
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

  return {
    ok: true,
    value: {
      heightCm,
      weightKg,
      gender,
      bustCm: optional(body.bustCm),
      waistCm: optional(body.waistCm),
      hipCm: optional(body.hipCm),
    },
  };
}
