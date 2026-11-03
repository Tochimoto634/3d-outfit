/**
 * Smoke: create-button CTA state must distinguish soft warnings from
 * "already generating / submitted" so the review UI does not look broken.
 */
import assert from "node:assert/strict";
import {
  createStartIsSubmittable,
  resolveCreateStartUiState,
} from "../app/lib/create-button-state.ts";

function check(name, fn) {
  try {
    fn();
    console.log(`OK  ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    throw err;
  }
}

check("review + soft-warning data → startable (soft never blocks)", () => {
  const state = resolveCreateStartUiState({
    jobStatus: "review",
    engineRuns: [],
    imagesBlocked: false,
  });
  assert.equal(state.kind, "startable");
  assert.equal(createStartIsSubmittable(state), true);
});

check("review + missing images → blocked_images", () => {
  const state = resolveCreateStartUiState({
    jobStatus: "review",
    engineRuns: [],
    imagesBlocked: true,
    missingImageTitles: ["Tee"],
  });
  assert.equal(state.kind, "blocked_images");
  assert.equal(createStartIsSubmittable(state), false);
});

check("review + empty segmentation prompt → blocked_prompt", () => {
  const state = resolveCreateStartUiState({
    jobStatus: "review",
    engineRuns: [],
    imagesBlocked: false,
    promptBlocked: true,
    missingPromptTitles: ["Untitled"],
  });
  assert.equal(state.kind, "blocked_prompt");
  assert.equal(createStartIsSubmittable(state), false);
});

check("images block wins over empty prompt", () => {
  const state = resolveCreateStartUiState({
    jobStatus: "review",
    engineRuns: [],
    imagesBlocked: true,
    missingImageTitles: ["Tee"],
    promptBlocked: true,
    missingPromptTitles: ["Tee"],
  });
  assert.equal(state.kind, "blocked_images");
});

check("generating + submitted mock → in_progress (not silent disable)", () => {
  const state = resolveCreateStartUiState({
    jobStatus: "generating",
    engineRuns: [{ status: "submitted" }],
    imagesBlocked: false,
  });
  assert.equal(state.kind, "in_progress");
  assert.match(state.buttonLabel, /進行中/);
  assert.match(state.reason, /進行中|submitted/);
  assert.equal(createStartIsSubmittable(state), false);
});

check("ready → completed copy", () => {
  const state = resolveCreateStartUiState({
    jobStatus: "ready",
    engineRuns: [{ status: "succeeded" }],
    imagesBlocked: false,
  });
  assert.equal(state.kind, "completed");
  assert.match(state.buttonLabel, /作成済み/);
  assert.equal(createStartIsSubmittable(state), false);
});

check("failed → retryable restart", () => {
  const state = resolveCreateStartUiState({
    jobStatus: "failed",
    engineRuns: [{ status: "failed" }],
    imagesBlocked: false,
  });
  assert.equal(state.kind, "failed_retryable");
  assert.equal(createStartIsSubmittable(state), true);
});

check("active engine run even if job still review → in_progress", () => {
  const state = resolveCreateStartUiState({
    jobStatus: "review",
    engineRuns: [{ status: "submitted" }],
    imagesBlocked: false,
  });
  assert.equal(state.kind, "in_progress");
  assert.equal(createStartIsSubmittable(state), false);
});

console.log("smoke-create-button-state: all passed");
