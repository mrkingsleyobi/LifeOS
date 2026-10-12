/** Jev question/answer types — pure, importable from Workers and the browser. Jev.ts re-exports these. */

export type NoulQ = { type: "noul"; instructions: string };
export type ChoiceQ = { type: "choice"; instructions: string; criteria: Record<string, string> };
export type ScoreQ = { type: "score"; instructions: string; criteria: string[] };
export type Question = NoulQ | ChoiceQ | ScoreQ;

export type NoulA = { type: "noul"; noul: number };
export type ChoiceA = { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number };
export type ScoreA = { type: "score"; score: number; legend?: Record<string, string>; probabilities: number[] | Record<string, number>; confidence: number };
export type Answer = NoulA | ChoiceA | ScoreA;

/** Map each question id to the answer shape its question type produces. */
export type AnswersFor<Q extends Record<string, Question>> = {
  [K in keyof Q]: Q[K] extends NoulQ ? NoulA : Q[K] extends ChoiceQ ? ChoiceA : ScoreA;
};
