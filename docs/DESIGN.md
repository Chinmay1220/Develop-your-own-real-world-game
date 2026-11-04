# Home Heist: design

Last updated: Oct 28, 2026.

Each part is marked **Built** (in the demo today), **Next** (planned for the hackathon), or **Stretch** (only if there is time).

## 1. The idea

You take a photo of a real place, and it becomes a heist level. You are the thief. AI guards protect one object, the *target*.

An AI world model decides what happens when anyone acts, so the game has almost no hand-written rules. When the guards lose a round, they write your trick in a notebook, and it never works again. A teacher AI compares the world model's results with the real place and corrects its mistakes.

**Tagline:** every trick works once.

## 2. Why this is "Push the Frontier"

- **A world model as the game engine.** Odyssey's Agora-2 showed a model acting as a learned game engine for many players, with one shared world state and a separate view per player. Home Heist uses the same structure with Meta's models:
  - an explicit shared state
  - a model that predicts what everyone's actions cause
  - partial views for the AI guards
- **Agents and the world model improve together.** Odyssey's PROWL work trains a team of agents and the world model in one loop. Here, the guards learn strategy and the world model learns facts about the place, both from playing.
- **Grounded in a real place.** The world starts from a photo, and the teacher checks the world against that photo. This is the same pattern as training robots in a simulation of a real room.
- **Measured** (Next). The claims are backed by two charts: guards catch the thief more often, and the world model makes fewer mistakes. See section 5.

**What "learning" means here.** The guards and the world model learn by writing and reading lessons, which is memory. The model weights do not change. The pitch must say this clearly. Changing the weights, by fine-tuning Muse Spark Open on corrected steps, is a Stretch goal.

## 3. The game

### Setup

- A room is a set of **zones** (areas such as "the desk" or "the rug"), **objects** and **characters**.
- Each zone lists:
  - its neighbors (where you can walk in one step)
  - what it can see while the room is lit
- One or more zones are exits.
- The thief starts near an exit. Each guard has a post and a duty: protect the target, or watch an exit.
- A round lasts at most 30 steps.

### Who decides what

| Decided by code (the checker and the engine) | Decided by the world model |
|---|---|
| Moves go to a neighboring zone, once per step | What an action causes |
| Objects never vanish; they are always somewhere or held by someone | What makes noise, and how loud it is |
| A hiding spot fits only as many people as its capacity | What breaks, what switches on or off, where thrown things land |
| A searched hiding spot reveals whoever is in it | Whether an unusual action works at all ("hide under the bed") |
| A guard in the thief's zone catches the thief, unless the thief is hidden | The story line for each action |
| Reaching an exit with the target wins; 30 steps without it loses | |

### Senses

- **Sight:** a guard sees its own zone plus the zones in its `sees` list, and only while the room is lit. In the dark, a guard sees only its own zone.
- **Hearing:** a noise of loudness *L* is heard up to *L* zones away.
- **Partial view:** the guards act only on these observations, never on the thief's true position.

### Example (from the demo)

1. **Round 1.**
   - The thief throws a shoe at the bathroom door.
   - Both guards go to check, so the laptop is left unguarded.
   - The thief grabs it and leaves by the window.
   - The guards lost, so they write: *a noise can be a trick; the laptop guard never leaves the laptop.*
2. **Round 2.**
   - The same shoe throw. Only Guard B checks; Guard A stays at the desk.
   - The thief hides under the bed, which the world model allows.
   - The thief walks to the desk and is caught.
   - After the round, the teacher reports that in the real room the bed has storage drawers underneath, so nobody can hide there. That becomes a world lesson.
3. **Round 3.** A new trick: switch off the lamp and sneak in the dark. It works.
4. **Round 4.**
   - The darkness trick fails, because the guards learned it.
   - Hiding under the bed is now refused by the world model.

## 4. The two learning loops

### Loop A: the guards learn strategy (Built)

- After a round, the **reflector** reads the round log and writes at most two new lessons, such as *"When the room goes dark, the guard protecting the laptop stays put."*
- The guards read their lessons at every step.
- The offline stand-in learns only from rounds the guards lose. The Meta version may also learn from close calls.

### Loop B: the world model learns the place (Built)

- After a round, the **teacher** compares every accepted change with the facts about the real place.
  - In the demo, the facts are a written list in the room file.
  - In the full game, Muse Wonder looks at the photo itself.
- Each mistake becomes a **world lesson**.
- The world model reads the world lessons at every step and must follow them.

### How the loops feed each other (Next)

- AI thieves try strange tricks during AI-against-AI play, and those tricks expose the world model's mistakes.
- So the agents produce the training material for the world model. This is the PROWL idea at hackathon scale.

## 5. How learning will be measured (Next, Nov 1–2)

1. **Guard catch rate.**
   - Fresh guards (empty notebook) and trained guards each play the same AI thief many times, for example 20 games each.
   - The opponent is the same, so the comparison is fair.
   - Chart: catch rate for fresh guards versus trained guards, plus the catch rate over training rounds.
2. **World-model mistakes.**
   - A fixed set of about 50 test situations is taken from the room: a state plus actions.
   - The world model answers each one without lessons and with lessons.
   - The teacher grades the answers without knowing which version produced them. About 20 grades are also checked by hand, so the result does not rest on one AI's grading.
   - Chart: mistakes per 50 situations, before and after.
3. **Blocked changes.** Every impossible change the checker blocks is counted, in the round history as "blocked changes". This is a fully objective error count.

If a chart shows no improvement, we report that honestly. The game still works either way.

## 6. Architecture

### One step (`src/game/session.ts` → `act`)

1. The player's action arrives, from a button or typed text. A button action is turned into words such as "throw the shoe at the bathroom door".
2. **Guards decide** (`ai.guards.decide`), using only each guard's last observation, its working memory and the notebook. This call starts right after the previous step ends, or when the round starts, so it runs while the player is still choosing.
3. **The world model resolves** all actions at once (`ai.world.resolve`). It returns changes, noises and story lines.
4. **The checker** (`src/game/checker.ts`) tests each change against the hard rules, in order, on a scratch copy. Impossible changes are blocked and reported in the story.
5. **The engine** (`src/game/engine.ts`) applies the accepted changes, then settles searches, catches, escapes and the step limit.
6. **Perception** (`src/game/perception.ts`) works out what each guard now sees and hears, for the next step.

### After a round (`#finishRound`)

1. The **reflector** and the **teacher** run in parallel on the round log.
2. New lessons are added to the notebook. Duplicates are skipped by kind and target.
3. A summary row is added to the history.
4. The notebook is saved to `data/notebooks/<room>.json`, and the full round log to `data/logs/`.

### The four AI roles

All four share one interface (`src/ai/types.ts`), so the offline and Meta versions can be swapped.

| Role | Offline stand-in (`offline.ts`) | Meta version (`meta.ts`) | Model | Reasoning effort |
|---|---|---|---|---|
| World model | Reads typed words with keyword rules, then applies simple physics: throws land up to 3 zones away, breakable things shatter, a lamp click is quiet | One Chat Completions call per step, with a JSON schema for changes, noises and story | `muse-spark-1.3` | low |
| Guard brain | Tasks: chase, investigate a noise, relight the lamp, search. Lessons change which guard reacts. | One call for all guards, giving each guard's observation, memory and plan. Untrained guards have ordinary habits (chase what they see, check noises), and lessons override them. | `muse-spark-1.3` | low |
| Reflector | Replays the accepted changes and spots throws, darkness and hiding | One call, writing at most 2 lessons | `muse-spark-1.3` | medium |
| Teacher | Checks accepted hide changes against facts marked `forbids: "hide"` | One call with the room facts and the steps | `muse-wonder-1.0` | medium |

- **Fallback** (`src/ai/index.ts`): if a Meta call fails, the offline stand-in handles that call and a warning appears in the story.
- **Cost tracking:** each Meta call's token usage is turned into dollars using the price table in `src/config.ts`.

### Server and browser

`src/server.ts` serves `public/` and a small JSON API. It listens only on `127.0.0.1`.

| Endpoint | What it does |
|---|---|
| `GET /api/state` | The full view: map, options, story, notebooks, report, cost |
| `POST /api/action` | Plays one step. Body: `{ "kind": "move", "target": "desk" }` or `{ "kind": "free", "text": "..." }` |
| `POST /api/round` | Starts the next round, or restarts the current one if it has not finished |
| `POST /api/reset` | Wipes the notebooks and starts again from round 1 |

The browser (`public/app.js`) only draws what the server sends and posts actions back. All game logic is on the server.

## 7. Data formats

### Room file (`rooms/*.json`)

In the full game, the world builder (Next) writes this from a photo. `src/game/room.ts` validates it:
- neighbors and sight must go both ways
- every reference must exist
- there must be an exit and exactly one thief

```json
{
  "id": "sample-bedroom",
  "maxSteps": 30,
  "targetId": "laptop",
  "facts": [{ "text": "The bed has storage drawers underneath...", "object": "bed", "forbids": "hide" }],
  "zones": [{ "id": "window", "name": "the window", "x": 16, "y": 16, "exit": true, "neighbors": ["rug", "bed", "desk"], "sees": ["rug", "bed"] }],
  "objects": [{ "id": "bed", "name": "bed", "zone": "bed", "heldBy": null, "hideCapacity": 1, "hidePhrase": "under the bed", "notes": "It looks like there may be space underneath." }],
  "agents": [{ "id": "guardA", "name": "Guard A", "role": "guard", "zone": "desk", "hiddenIn": null, "post": "desk", "duty": "target" }]
}
```

The sample bed deliberately has `hideCapacity: 1`. This copies a mistake a world builder could make from a photo, so the teacher has something real to catch.

### Action (what a character does)

```json
{ "actor": "thief", "kind": "throw", "item": "shoe", "target": "bathroom", "text": "throw the shoe at the bathroom door" }
```

The kinds are `move`, `take`, `drop`, `hide`, `unhide`, `throw`, `use`, `search`, `wait` and `free`. A `free` action is typed text that the world model interprets.

### Changes (what the world model may propose)

| `op` | Fields | Meaning |
|---|---|---|
| `move` | `actor`, `to` | Walk to a neighboring zone. This also leaves any hiding spot. |
| `hide` | `actor`, `object` | Hide in, under or behind an object in the same zone |
| `unhide` | `actor` | Leave the hiding spot |
| `pickUp` | `actor`, `object` | Pick up a portable object in the same zone |
| `place` | `object`, `zone` | A dropped or thrown object lands. Held objects fly up to 3 zones; loose ones move at most 1. |
| `set` | `object`, `key` (`on` or `broken`), `value` | Switch something, or break it |

### Outcome (the world model's answer for one step)

```json
{
  "changes": [{ "op": "place", "object": "shoe", "zone": "bathroom" }],
  "noises": [{ "zone": "bathroom", "loudness": 2, "what": "the shoe landing" }],
  "narration": ["You throw the shoe. It lands by the bathroom door with a thud."]
}
```

### Observation (what one guard knows after a step)

```json
{ "zone": "desk", "lit": true, "visibleZones": ["desk", "rug", "closet"], "thiefSeenAt": null, "sawHideIn": null, "heard": [{ "zone": "bathroom", "loudness": 2, "what": "the shoe landing" }], "lightsWentOut": false }
```

### Lesson and notebook (`data/notebooks/<room>.json`)

```json
{
  "guardLessons": [{ "id": "G1", "kind": "distraction", "round": 1, "text": "The thief threw the shoe at the bathroom door to pull us away..." }],
  "worldLessons": [{ "id": "W1", "kind": "forbid", "action": "hide", "target": "bed", "round": 2, "text": "The bed has storage drawers underneath..." }],
  "history": [{ "round": 1, "status": "escaped", "steps": 5, "blockedChanges": 0, "worldMistakes": 0, "newGuardLessons": 1 }]
}
```

## 8. The hard rules in full (`src/game/checker.ts`)

- Every character, zone and object id must exist.
- `move`: to the same zone or a neighbor of the character's starting zone, once per step.
- `hide`: the object is in the character's zone, has `hideCapacity`, is not full, and the character is not already hiding.
- `unhide`: the character is hiding.
- `pickUp`: the object is portable, not held, in the same zone, and the character is not hiding.
- `place`: a held object travels at most 3 zones from its holder; a loose portable object at most 1 zone.
- `set on`: the object has a switch, and someone who acted this step stood in its zone.
- `set broken`: the object is breakable.
- A noise must be in a known zone, with loudness 1, 2 or 3.

## 9. Meta models (prices checked Oct 27, 2026)

| Model | Use in Home Heist | Price | Status |
|---|---|---|---|
| `muse-spark-1.3` | World model, guards, reflector; naming objects in the photo | $1.25 in / $4.25 out per million tokens | Runs (first real round Oct 28) |
| `muse-spark-1.3-contributor` | Cheap AI-against-AI training, text only (Meta may train on it) | $0.10 / $0.20 | Next |
| `muse-wonder-1.0` | Teacher | $4 / $20 | Runs (first real round Oct 28) |
| `sam-3.1` | Cut the objects out of the photo | $2.50 per 1,000 images | Next |
| `muse-image-1.0` | Picture of the scene each step, comic replay | $0.01 per image | Next |
| `muse-voice-transcribe-1.0` | Speak your actions | $0.18 per hour of audio | Stretch |
| Muse Spark Open (via Modal) | Fine-tune on corrected steps | Partner credits | Stretch |

API facts used in the code, from dev.meta.ai/docs:
- base URL `https://api.meta.ai/v1`
- `POST /chat/completions`
- `Authorization: Bearer <key>`
- `response_format: { type: "json_schema", json_schema: { name, strict: true, schema } }`. Strict mode is required: without it the model sometimes garbled key names (see BUILD_LOG step 16). In strict mode, every key is required and no extra keys are allowed, which is why the world model's changes come back as separate lists (`moves`, `hides`, `unhides`, `pickUps`, `places`, `sets`).
- `reasoning_effort` (`"none"` is rejected by Muse models)
- `max_completion_tokens`
- the reply text is in `choices[0].message.content`

**Seen on the first real run (Oct 28):**
- Cached tokens are reported in `usage.prompt_tokens_details.cached_tokens`.
- `completion_tokens` was about 700–1,000 per call, although each JSON reply is short. So it very likely includes the reasoning tokens, which is what the cost tracking assumes.
- To be sure, compare the tracked spend with the Billing page.

## 10. Privacy

- Photos of real places go only through the normal (standard) mode.
- Contributor mode lets Meta train on what is sent, so it is used only for text-only AI-against-AI rounds, and only with rooms the player is happy to share.
- The API key lives in `.env`, which git ignores.

## 11. Schedule

| Date | Work | Status |
|---|---|---|
| Oct 27–28 | Design; game core with offline stand-ins; browser game; Meta API code; docs | **Built** (this demo) |
| Oct 28 | First real rounds: about 2–4 s and 1 cent per step; strict JSON; the teacher caught the planted mistake | **Done** |
| Oct 29–30 | Run the game on the real Meta models and tune the prompts | Next |
| Oct 30–31 | Photo becomes a level (Muse Spark names objects → SAM 3.1 boxes → world builder) | Next |
| Nov 1 | AI-against-AI runner with an AI thief | Next |
| Nov 2 | Training runs and the two charts | Next |
| Nov 3 | Polish: a picture each step, comic replay, bug fixes. No new features after this day. | Next |
| Nov 4 | README, demo video, submit by 3 PM ET (the deadline is 9 PM ET) | Next |

## 12. Budget (rough, $150 of credits)

| Part | Estimate |
|---|---|
| Building and testing | $10–20 |
| AI-against-AI training (contributor mode) | $5–10 |
| Teacher checks and grading (Muse Wonder) | $20–30 |
| Human play and pictures | $10–15 |
| **Total** | **about $45–75** |

**Measured on Oct 28** (`npm run api:try`):
- one step: about $0.007–0.010 (two Muse Spark calls)
- one end-of-round review: about $0.04, mostly Muse Wonder
- so a full 30-step round costs about $0.30–0.35

AI-against-AI training should use contributor mode, which is about 12× cheaper per token.

## 13. Risks and backups

- **Steps are slow:** the game is turn-based, so a few seconds per step is fine. Otherwise, lower the reasoning effort and shorten the prompts.
- **Pictures are slow:** keep the map as the main view and show pictures only at key moments.
- **The charts show no learning:** run more rounds and improve the lesson prompts, then report honestly.
- **Some photos fail:** demo only with photos that have been tested.
- **The key arrives late:** the offline stand-ins keep all work moving.

## 14. Open questions

1. What does the submission need: video length, a public repo, a live link? The details page needs a login.
2. Which 3–5 real photos will the demo use?
3. Should git commits be made after each phase, or only when asked?
