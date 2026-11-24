import type { LLM } from "@thenetwork/core";

export function heldJudge(onCall: () => void = () => {}) {
  let release!: () => void, called!: () => void;
  const gate = new Promise<void>(r => (release = r));
  const first = new Promise<void>(r => (called = r));
  const llm: LLM = { chat: async () => { onCall(); called(); await gate; throw new Error("judge held by the test"); } };
  return { llm, release, first };
}

export const within = <T>(p: Promise<T>, ms: number) => Promise.race([p.then(v => ({ done: true as const, v })),
  new Promise<{ done: false }>(r => setTimeout(() => r({ done: false }), ms))]);
