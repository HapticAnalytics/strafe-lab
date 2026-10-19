// The coach's output contract. Structured output is constrained to this schema by the API, and re-checked here.
import { z } from "zod";

export const SKILL_ENUM = ["pb", "mid", "duo", "vert", "turn", "click", "flick", "long"] as const;

export const PlanSchema = z.object({
  kind: z.enum(["daily", "weekly", "long"]),
  headline: z.string(),
  /** each claim: prose where every number is immediately followed by a [F#] citation */
  claims: z.array(z.object({ text: z.string() })),
  sessions: z.array(z.object({
    title: z.string(),
    skill: z.enum(SKILL_ENUM),
    minutes: z.number().int(),
    focus: z.string(),
  })),
  experiment: z.object({
    name: z.string(),
    hypothesis: z.string(),
    armA: z.string(),
    armB: z.string(),
    metricKey: z.string(),
    minEffectFloors: z.number(),
    daysPerArm: z.number().int(),
  }).nullable(),
  /** the coach may only suggest a sens re-test, never a change, and only when sens is not locked */
  sensRetest: z.boolean(),
});

export type Plan = z.infer<typeof PlanSchema>;
