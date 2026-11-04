/**
 * Review-page CTA state for「確認して作成開始」.
 * Soft warnings (model_meta / size_chart) never disable the button —
 * only missing photos, empty segmentation prompts, or job already past review, do.
 */

export type EngineRunLike = { status: string };

export type CreateStartUiState =
  | { kind: "startable" }
  | { kind: "blocked_images"; titles: string[] }
  | { kind: "blocked_prompt"; titles: string[] }
  | {
      kind: "in_progress";
      /** Human-readable reason shown next to disabled CTA */
      reason: string;
      /** Primary button label while in progress */
      buttonLabel: string;
    }
  | {
      kind: "completed";
      reason: string;
      buttonLabel: string;
    }
  | {
      kind: "failed_retryable";
      reason: string;
      /** Restart CTA label */
      buttonLabel: string;
    }
  | {
      kind: "cancelled";
      reason: string;
      buttonLabel: string;
    };

const ACTIVE_ENGINE = new Set(["queued", "submitted", "running"]);

function summarizeEngineRuns(runs: EngineRunLike[]): string {
  if (runs.length === 0) return "EngineRun なし";
  const counts = new Map<string, number>();
  for (const r of runs) {
    counts.set(r.status, (counts.get(r.status) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([status, n]) => `${status}×${n}`)
    .join("、");
}

/**
 * Decide how the create CTA should look given job status + engine runs.
 * Soft warnings are intentionally ignored here (non-blocking).
 */
export function resolveCreateStartUiState(input: {
  jobStatus: string;
  engineRuns: EngineRunLike[];
  imagesBlocked: boolean;
  missingImageTitles?: string[];
  /** Empty Grounding/SAM2 prompt blocks create (same priority band as photos). */
  promptBlocked?: boolean;
  missingPromptTitles?: string[];
}): CreateStartUiState {
  const {
    jobStatus,
    engineRuns,
    imagesBlocked,
    missingImageTitles = [],
    promptBlocked = false,
    missingPromptTitles = [],
  } = input;

  const hasActiveRun = engineRuns.some((r) => ACTIVE_ENGINE.has(r.status));
  const runSummary = summarizeEngineRuns(engineRuns);

  if (jobStatus === "ready" || jobStatus === "sizing") {
    return {
      kind: "completed",
      reason: `作成済み（ジョブ: ${jobStatus}／${runSummary}）。不足メタの警告は作成を止めません。`,
      buttonLabel: "作成済み",
    };
  }

  if (jobStatus === "generating" || hasActiveRun) {
    return {
      kind: "in_progress",
      reason: `作成進行中のため再開始できません（ジョブ: ${jobStatus}／${runSummary}）。「状態を更新」でポーリングしてください。`,
      buttonLabel: "作成進行中",
    };
  }

  if (jobStatus === "failed") {
    if (imagesBlocked) {
      return { kind: "blocked_images", titles: missingImageTitles };
    }
    if (promptBlocked) {
      return { kind: "blocked_prompt", titles: missingPromptTitles };
    }
    return {
      kind: "failed_retryable",
      reason: `前回の作成は失敗しています（${runSummary}）。内容を直して再開始できます。`,
      buttonLabel: "失敗したため再開始",
    };
  }

  if (jobStatus === "cancelled") {
    if (imagesBlocked) {
      return { kind: "blocked_images", titles: missingImageTitles };
    }
    if (promptBlocked) {
      return { kind: "blocked_prompt", titles: missingPromptTitles };
    }
    return {
      kind: "cancelled",
      reason: "このジョブはキャンセル済みです。再開始できます。",
      buttonLabel: "キャンセル済み・再開始",
    };
  }

  // review / collecting (and any unexpected early status)
  if (imagesBlocked) {
    return { kind: "blocked_images", titles: missingImageTitles };
  }
  if (promptBlocked) {
    return { kind: "blocked_prompt", titles: missingPromptTitles };
  }

  if (jobStatus === "review" || jobStatus === "collecting") {
    return { kind: "startable" };
  }

  // Fallback: unknown post-review status without active runs
  return {
    kind: "in_progress",
    reason: `ジョブ状態「${jobStatus}」のため作成開始はできません（${runSummary}）。`,
    buttonLabel: "開始不可",
  };
}

export function createStartIsSubmittable(state: CreateStartUiState): boolean {
  return (
    state.kind === "startable" ||
    state.kind === "failed_retryable" ||
    state.kind === "cancelled"
  );
}
