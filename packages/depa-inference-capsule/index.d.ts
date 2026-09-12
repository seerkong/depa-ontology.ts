import type { InferenceInput, InferenceBudget, InferenceRuntime, InferenceResult } from 'depa-inference-contract';
export * from 'depa-inference-contract';
export { factId, explain } from 'depa-inference-logic';
export function createInferenceCapsule(options?: { budget?: InferenceBudget; runtime?: InferenceRuntime }): Readonly<{ infer(input: InferenceInput): Promise<InferenceResult> }>;
