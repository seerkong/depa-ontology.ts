import type { InferenceInput, InferenceBudget, InferenceRuntime, InferenceResult, Scalar, Explanation } from 'depa-inference-contract';
export function infer(runtime: InferenceRuntime, input: InferenceInput, budget?: InferenceBudget): Promise<InferenceResult>;
export function factId(relation: string, values: Scalar[]): string;
export function explain(result: InferenceResult, factId: string): Explanation;
