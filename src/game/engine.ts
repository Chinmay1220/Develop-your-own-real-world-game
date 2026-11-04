// One step of the game, after everyone has chosen an action and the world model has answered.
// This part is plain code with no AI, so it always behaves the same way.
import { checkChanges, checkNoises } from "./checker.ts";
import { observe } from "./perception.ts";
import type { Action, AgentId, Observation, Outcome, StepRecord, WorldState } from "./types.ts";
import { applyChange, getGuards, getThief, heldItems, hidePhrase } from "./world.ts";

export interface StepResult {
  state: WorldState;
  record: StepRecord;
  observations: Record<AgentId, Observation>;
}

export function resolveStep(before: WorldState, actions: Action[], outcome: Outcome): StepResult {
  const after = structuredClone(before);
  after.step = before.step + 1;

  const { accepted, rejected } = checkChanges(before, actions, outcome.changes);
  for (const change of accepted) applyChange(after, change);
  const noises = checkNoises(after, outcome.noises);
  rejected.push(...noises.rejected);
  for (const raw of outcome.unreadable ?? []) rejected.push({ what: raw, reason: `the world model sent a change the game could not read: ${raw}` });
  const events = rejected.map((rejection) => `Checker blocked a change: ${rejection.reason}.`);

  const thief = getThief(after);

  // A guard searching a hiding spot finds whoever is in it.
  for (const action of actions) {
    if (action.kind !== "search" || !action.target || after.status !== "playing") continue;
    const guard = after.agents[action.actor];
    const spot = after.objects[action.target];
    if (guard?.role !== "guard" || !spot || spot.zone !== guard.zone) continue;
    if (thief.hiddenIn === spot.id) {
      thief.hiddenIn = null;
      after.status = "caught";
      events.push(`${guard.name} finds you ${hidePhrase(spot)}!`);
    }
  }

  // A guard in the same zone as a thief who is not hiding makes the catch.
  if (after.status === "playing" && thief.hiddenIn === null) {
    const catcher = getGuards(after).find((guard) => guard.zone === thief.zone);
    if (catcher) {
      after.status = "caught";
      events.push(`${catcher.name} catches you at ${after.zones[thief.zone].name}!`);
    }
  }

  if (after.status === "playing" && thief.hiddenIn !== null) {
    const spot = after.objects[thief.hiddenIn];
    for (const guard of getGuards(after)) {
      if (guard.zone === thief.zone) events.push(`${guard.name} walks right past you. You stay hidden ${hidePhrase(spot)}.`);
    }
  }

  const carriesTarget = heldItems(after, thief.id).some((object) => object.id === after.targetId);
  if (after.status === "playing" && after.zones[thief.zone].exit && carriesTarget) {
    after.status = "escaped";
    const exit = after.zones[thief.zone];
    events.push(`You slip out by ${exit.exitName ?? exit.name} with the ${after.objects[after.targetId].name}. You escaped!`);
  }

  if (after.status === "playing" && after.step >= after.maxSteps) {
    after.status = "timeout";
    events.push("Time is up. The guards win this round.");
  }

  const record: StepRecord = {
    step: after.step,
    actions,
    narration: outcome.narration,
    accepted,
    rejected,
    noises: noises.valid,
    events,
    status: after.status,
  };
  return { state: after, record, observations: observe(before, after, noises.valid) };
}
