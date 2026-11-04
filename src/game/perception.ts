// What each guard notices. Guards only get these observations, never the full world state.
import type { AgentId, Noise, Observation, WorldState, ZoneId } from "./types.ts";
import { distance, getGuards, getThief, isLit, visibleZones } from "./world.ts";

/** A noise of loudness L is heard up to L zones away. */
export function observe(before: WorldState, after: WorldState, noises: Noise[]): Record<AgentId, Observation> {
  const thief = getThief(after);
  const justHid = thief.hiddenIn !== null && before.agents[thief.id].hiddenIn !== thief.hiddenIn;
  const observations: Record<AgentId, Observation> = {};
  for (const guard of getGuards(after)) {
    const visible = visibleZones(after, guard.zone);
    const canSeeThiefZone = visible.includes(thief.zone);
    const inView = [guard.zone, ...after.zones[guard.zone].sees];
    observations[guard.id] = {
      zone: guard.zone,
      lit: isLit(after, guard.zone),
      visibleZones: visible,
      thiefSeenAt: canSeeThiefZone && thief.hiddenIn === null ? thief.zone : null,
      sawHideIn: canSeeThiefZone && justHid ? thief.hiddenIn : null,
      heard: noises.filter((noise) => distance(after, guard.zone, noise.zone) <= noise.loudness),
      lightsWentOut: inView.some((zone) => isLit(before, zone) && !isLit(after, zone)),
    };
  }
  return observations;
}

/** The zones each guard can see right now, for the map. */
export function guardVision(state: WorldState): Record<AgentId, ZoneId[]> {
  return Object.fromEntries(getGuards(state).map((guard) => [guard.id, visibleZones(state, guard.zone)]));
}
