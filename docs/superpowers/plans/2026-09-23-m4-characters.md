# Flight 13 — Milestone 4: Characters and Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the placeholder mannequins with animated passengers whose heads follow where each
player is looking, who reach for their screen while using it (by day), point at the person they vote for,
stand up and walk the aisle when changing seats, slump when they die and stand zip-tied at the back when
restrained. You see your own body when you look down.

**Architecture:** A new *pose channel* rides beside the game state: each client sends its head yaw/pitch
and a "using the screen" flag to the host at up to ~8 Hz; the host relays everyone's poses to everyone a
few times a second, forcing the screen flag off at night so it cannot reveal who has an ability. Poses never
touch the Preact tree. In the 3D layer each character is a *virtual rig* (an `Object3D` bone hierarchy that
is never added to the scene); every body-part type is drawn for all characters by one shared
`InstancedMesh`, so 17 characters cost about 20 draw calls. Characters without pose data (bots, 2D players)
idle naturally.

**Decision:** procedural characters (no downloads). CC0 packs (Quaternius / KayKit) remain an optional
upgrade that needs the user's go-ahead before any asset files are downloaded.

**Tech Stack:** three 0.186 (Object3D rigs, InstancedMesh with instance colours), Vitest.

---

### Task 1: Pose channel (test-first)

**Files:** Modify `src/net/protocol.ts`, `src/net/host.ts`, `src/net/client.ts`, `src/app/sessions.ts`
(ticker 125 ms); Test `src/net/poses.test.ts`.

- `Pose = { yaw: number; pitch: number; lean: boolean }`.
- Client → host `{ t: 'pose', yaw, pitch, lean }` (no ack); parsed defensively: finite numbers, yaw clamped
  to ±π, pitch to ±1.3.
- Host keeps the latest pose per player and, on `tickNow`, broadcasts `{ t: 'poses', poses: { id: [yaw,
  pitch, lean0or1] } }` to every joined peer when something changed and ≥120 ms passed. During
  `night_move`/`night_act` every `lean` is sent as 0. Poses from peers without a player are ignored.
- `ClientSession.poses: Map<string, Pose>` updated from `poses` messages; `sendPose(pose)` fire-and-forget.

Tests: relays a pose to other clients; suppresses `lean` at night; ignores junk pose messages.

### Task 2: Character rig and instanced renderer

**File:** `src/world/scene/people.ts` — `People` (renderer) and `Actor` (one character):
bone hierarchy (hips, spine, chest, neck, head, shoulders/upper arms/forearms/hands, hips/thighs/shins/
feet); segment pieces (pelvis, torso, neck, head, 8 hair styles, eyes, arms, hands, legs, shoes) drawn by
shared `InstancedMesh`es with per-instance colours from the look palettes (sleeve length and body width
vary with the look); `Actor.update(dt, time)` blends seated ⇄ standing, walks paths with leg/arm swing,
eases head yaw/pitch toward the pose (chest follows 30 %), reaches toward the seatback screen while `lean`,
points at a target, slumps when dead (explosion victims scorched darker), stands with hands behind the back
when restrained (rear crew area). Your own actor hides its head.

### Task 3: Integration

Modify `src/world/Cabin3D.ts` (use `People`; read `client.poses` every frame; point voters at their vote
target from the public tally; send your pose through an `onPose` callback, throttled to 120 ms and only on
change) and `src/world/World.tsx` (wire `onPose` → `client.sendPose`, pass the client). Remove
`src/world/scene/avatars.ts`.

### Task 4: Verify and ship

Tests, type-check, build; two-tab browser check that one tab sees the other's head turn and reach; night
check that reaching is not shown; commit, merge, push.
