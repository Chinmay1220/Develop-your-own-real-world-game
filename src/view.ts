// The game as the browser sees it: the map, the thief's choices, the story and the notebooks.
import { THROW_RANGE } from "./game/checker.ts";
import { guardVision } from "./game/perception.ts";
import type { Session } from "./game/session.ts";
import { distance, getThief, heldItems, hiddenCount, hidePhrase, isLit, objectsIn } from "./game/world.ts";

export function buildView(session: Session) {
  const { state } = session;
  const thief = getThief(state);
  const here = objectsIn(state, thief.zone);
  const playing = state.status === "playing";
  return {
    mode: session.ai.mode,
    models: session.ai.models,
    round: session.round,
    status: state.status,
    step: state.step,
    maxSteps: state.maxSteps,
    lit: isLit(state, thief.zone),
    room: { name: state.roomName, description: state.description },
    zones: Object.values(state.zones).map(({ id, name, x, y, neighbors, exit }) => ({ id, name, x, y, neighbors, exit: Boolean(exit) })),
    objects: Object.values(state.objects).map(({ id, name, zone, heldBy, on, broken, lightSource }) => ({
      id,
      name,
      zone,
      heldBy,
      target: id === state.targetId,
      on,
      broken,
      lightSource,
    })),
    agents: Object.values(state.agents).map(({ id, name, role, zone, hiddenIn, duty }) => ({ id, name, role, zone, hidden: hiddenIn !== null, duty })),
    vision: guardVision(state),
    options: playing
      ? {
          move: state.zones[thief.zone].neighbors.map((id) => ({ id, name: state.zones[id].name })),
          take: here.filter((object) => object.portable).map(({ id, name }) => ({ id, name })),
          hide: thief.hiddenIn
            ? []
            : here
                .filter((object) => (object.hideCapacity ?? 0) > hiddenCount(state, object.id))
                .map((object) => ({ id: object.id, name: object.name, phrase: hidePhrase(object) })),
          use: here.filter((object) => object.switchable).map(({ id, name, on }) => ({ id, name, on: Boolean(on) })),
          held: heldItems(state, thief.id).map(({ id, name }) => ({ id, name })),
          throwTargets: Object.values(state.zones)
            .filter((zone) => zone.id !== thief.zone && distance(state, thief.zone, zone.id) <= THROW_RANGE)
            .map(({ id, name }) => ({ id, name })),
          canUnhide: thief.hiddenIn !== null,
        }
      : null,
    log: session.steps.map((step) => ({ step: step.step, action: step.actions[0]?.text ?? "", lines: [...step.narration, ...step.events] })),
    notebook: session.notebook,
    report: session.lastReport,
    usage: session.ai.usage(),
  };
}
