export const INFERENCE_API_VERSION: 'depa.inference/v1';
export type Scalar = string | number | boolean | null;
export type Term = { var: string } | { value: Scalar };
export interface Atom { relation: string; terms: Term[]; }
export interface Rule { id: string; head: Atom; body: (Atom & { not?: boolean })[]; }
export interface RuleProgram { id: string; version: string; relations: { name: string; arity: number }[]; rules: Rule[]; }
export interface InputFact { relation: string; values: Scalar[]; source?: string; }
export interface InferenceInput { epoch: string; program: RuleProgram; facts: InputFact[]; }
export interface InferenceBudget { maxInputFacts?: number; maxRules?: number; maxFacts?: number; maxSupports?: number; timeoutMs?: number; }
export interface InferenceFact { id: string; relation: string; values: Scalar[]; sources: string[]; }
/** All premises in one support are required together (AND); alternative supports are OR. */
export interface InferenceSupport { id: string; ruleId: string; conclusion: string; premises: string[]; absences: { relation: string; values: Scalar[] }[]; }
export interface InferenceResult {
  apiVersion: 'depa.inference/v1'; epoch: string; status: 'complete' | 'incomplete' | 'invalid';
  programFingerprint: string; inputFingerprint: string;
  facts: InferenceFact[]; supports: InferenceSupport[];
  diagnostics: { code: string; message: string }[];
  stats: { elapsedMs: number; inputFacts: number; outputFacts: number; outputSupports: number };
}
export interface InferenceRuntime {
  now(): number;
  evaluate(query: { script: string; params: Record<string, unknown>; timeoutMs: number }): Promise<{ rows: unknown[][] }>;
}
export interface Explanation { factId: string; epoch: string; programFingerprint: string; inputFingerprint: string; facts: InferenceFact[]; supports: InferenceSupport[]; complete: boolean; }
