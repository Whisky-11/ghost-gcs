# Graph Report - ghost-gcs  (2026-07-20)

## Corpus Check
- 77 files · ~108,188 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 752 nodes · 1190 edges · 47 communities (41 shown, 6 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 2 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `d3a76ac6`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]

## God Nodes (most connected - your core abstractions)
1. `VehicleLink` - 19 edges
2. `Mission` - 13 edges
3. `TelemetryState` - 13 edges
4. `initialState()` - 13 edges
5. `Execution order` - 12 edges
6. `TelemetryState` - 11 edges
7. `MissionItem` - 11 edges
8. `MissionItem` - 11 edges
9. `Execution order` - 11 edges
10. `LatLng` - 10 edges

## Surprising Connections (you probably didn't know these)
- `explainErrorText()` --calls--> `describeRpcError()`  [INFERRED]
  app/src/lib/alerts.ts → app/src/lib/controls.ts
- `main()` --calls--> `makeClaudeHeadless()`  [EXTRACTED]
  bridge/src/index.ts → bridge/src/ai/claude.ts
- `dispatch()` --calls--> `validateMission()`  [EXTRACTED]
  bridge/src/ws/server.ts → bridge/src/missions/model.ts
- `dispatch()` --calls--> `generateSurveyGrid()`  [EXTRACTED]
  bridge/src/ws/server.ts → bridge/src/missions/survey.ts
- `nominalState()` --calls--> `initialState()`  [EXTRACTED]
  bridge/src/watchdog/__tests__/rules.test.ts → bridge/src/state/telemetry.ts

## Communities (47 total, 6 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (42): AlertsPanel(), AlertsPanelProps, explainButtonStyle, ExplainState, IDLE, panelHeadingStyle, UseTelemetryResult, explainErrorText() (+34 more)

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (18): ConnectAbortedError, HeartbeatTimeoutError, SocketFactory, STREAM_RATES, VehicleLink, decode(), MessageClass, REGISTRY (+10 more)

### Community 2 - "Community 2"
Cohesion: 0.08
Nodes (30): EMPTY_MISSION, Home(), VehicleMap, GhostAiMethod, useTelemetry(), AttitudeIndicator(), AttitudeIndicatorProps, GROUND_RECT (+22 more)

### Community 3 - "Community 3"
Cohesion: 0.09
Nodes (35): ArmSlider(), ArmSliderProps, buttonStyle(), fieldLabelStyle, FlightControls(), FlightControlsProps, inputStyle, Toasts() (+27 more)

### Community 4 - "Community 4"
Cohesion: 0.08
Nodes (33): buildDebriefPrompt(), buildMissionDraftPrompt(), buildNarratePrompt(), computeFlightStats(), FlightStats, formatGeometry(), missionDraftItemSchema, MissionDraftPromptInput (+25 more)

### Community 5 - "Community 5"
Cohesion: 0.08
Nodes (29): candidateRows(), centroidOf(), distanceToSegmentDeg(), generateSurveyGrid(), isOnBoundary(), LatLng, LocalPoint, longestEdgeBearingRad() (+21 more)

### Community 6 - "Community 6"
Cohesion: 0.06
Nodes (30): alertSchema, alertSeveritySchema, AlertsMessage, alertsMessageSchema, _AlertWireShapeMatchesModel, AssertEqual, attitudeSchema, batterySchema (+22 more)

### Community 7 - "Community 7"
Cohesion: 0.08
Nodes (25): Carry-note before ANY run, code:bash (pkill -f 'tsx.*bridge/src/index.ts'; pkill -f 'tsx watch'), code:bash (GHOST_AI_SMOKE=1 pnpm --filter bridge test claude.smoke), code:block11 (stdout | ... askJson performs one real `claude -p` call and ), code:block2 ([bridge] connecting to SITL at 127.0.0.1:5760...), code:block3 ([initial] connected=true vehicleType=copter armed=false mode), code:block4 (docker stop ghost-sitl                # copter container dow), code:block5 ([bridge] vehicle link disconnected — reconnecting) (+17 more)

### Community 8 - "Community 8"
Cohesion: 0.12
Nodes (21): addWaypoint(), createEmptyMission(), MissionEditorAction, missionEditorReducer(), MissionEditorState, removeWaypoint(), reorderWaypoint(), reseq() (+13 more)

### Community 9 - "Community 9"
Cohesion: 0.09
Nodes (22): code:ts (export type MissionItemCommand = 'WAYPOINT' | 'TAKEOFF' | 'R), code:ts (export interface LatLng { lat: number; lng: number }), code:ts (export interface MissionUploadDeps { link: Pick<VehicleLink,), code:ts (export type AlertSeverity = 'info' | 'warn' | 'critical'), code:ts (export interface SpawnResult { code: number; stdout: string;), code:ts (export const missionDraftSchema: ZodType<{ items: MissionIte), code:ts (// client→server RPCs (extend method union): 'uploadMission'), Execution order (+14 more)

### Community 10 - "Community 10"
Cohesion: 0.09
Nodes (22): code:ts (import { describe, it, expect } from 'vitest'), code:dockerfile (FROM ubuntu:22.04), code:bash (#!/bin/bash), code:ts (import { connect } from 'node:net'), code:ts (// registry.ts), code:ts (export interface TelemetryState {), code:ts (export class CommandError extends Error { constructor(public), code:ts (// server→client, ~5Hz + immediate on connect:) (+14 more)

### Community 11 - "Community 11"
Cohesion: 0.2
Nodes (15): buttonStyle(), MissionControls(), MissionControlsProps, clearDisabledReason(), hasUploadableMission(), MissionControlAvailability, missionExceedsMax(), startDisabledReason() (+7 more)

### Community 12 - "Community 12"
Cohesion: 0.13
Nodes (17): draftGeometryFromEditor(), GhostAction, GhostDraftData, ghostReducer(), GhostRequest, GhostRequestKind, GhostState, initialGhostState (+9 more)

### Community 13 - "Community 13"
Cohesion: 0.11
Nodes (15): assertion, count, downloadLink, downloadPromise, downloadProtocol, FakeLink, item, ITEMS (+7 more)

### Community 14 - "Community 14"
Cohesion: 0.12
Nodes (9): CommandDeps, CommandError, COPTER_MODE_IDS, ROVER_MODE_IDS, TelemetryState, assertion, commands, FakeLink (+1 more)

### Community 15 - "Community 15"
Cohesion: 0.12
Nodes (18): armedState, att, data, disarmed, first, gpi, gps, heartbeat() (+10 more)

### Community 16 - "Community 16"
Cohesion: 0.14
Nodes (12): GhostDraftOverlayProps, missionToLineCoordinates(), AlertsMessage, Attitude, Home, MissionItem, Position, RpcResult (+4 more)

### Community 17 - "Community 17"
Cohesion: 0.25
Nodes (13): makeCommands(), makeMissionProtocol(), log(), main(), sleep(), connectWithRetry(), main(), initialState() (+5 more)

### Community 18 - "Community 18"
Cohesion: 0.13
Nodes (10): ai, alerts, invalidMission, polygon, reply, sampleMission, WsAi, WsCommands (+2 more)

### Community 19 - "Community 19"
Cohesion: 0.13
Nodes (14): code:ts (// model.ts), code:ts (export class MissionError extends Error { constructor(public), code:ts (// TelemetryState gains: mission: { count: number; currentSe), code:ts (export interface Alert { severity: 'info'|'warn'|'crit'; cod), code:ts (export class AiError extends Error { constructor(public code), Execution order, GHOST GCS — P1 Missions + Advisory Implementation Plan, Global Constraints (+6 more)

### Community 20 - "Community 20"
Cohesion: 0.2
Nodes (12): ALT_BOUNDED_COMMANDS, Mission, MissionItemCommand, missionWarnings(), TERMINAL_COMMANDS, validateMission(), validateSeqContiguity(), item() (+4 more)

### Community 21 - "Community 21"
Cohesion: 0.15
Nodes (12): calls, claude, d1, d2, Deferred, okResult(), p1, p2 (+4 more)

### Community 22 - "Community 22"
Cohesion: 0.15
Nodes (12): 1. Kuwait import barrier is real and RF-specific: CITRA controls customs release of ALL imported communications d…, 2. The Holybro X500 V2 kit is the reference MAVLink-capable DIY quad: sold as a PX4 Development Kit in four varia…, 3. The Pixhawk 6C (and the X500 kits built on it) ships with PX4 preinstalled and is fully ArduPilot-compatible (…, 4. ArduPilot Rover is a first-class platform for the GHOST GCS rover phase: the official firmware supports conven…, 5. DJI-to-MAVLink bridging exists but only for the legacy generation: RosettaDrone is an open-source Android fram…, 6. DJI's official SDK path is narrow and excludes almost all consumer drones: Mobile SDK V5 provides programmatic…, 7. For a turnkey branded MAVLink drone, the ModalAI Starling 2 is the verified option: an NDAA-compliant SLAM dev…, 8. Simulation removes the hardware dependency entirely, which is the decisive fact for a Kuwait resident: ArduPil… (+4 more)

### Community 23 - "Community 23"
Cohesion: 0.15
Nodes (12): AI copilot contract, Architecture, code:block1 (ArduPilot SITL (docker / native macOS build) ──UDP 14550──┐), Falcon GCS — Design Spec, Goals / Non-goals, Phases, Risks / open items, Safety invariants (binding on every phase) (+4 more)

### Community 24 - "Community 24"
Cohesion: 0.15
Nodes (12): ArduPilot SITL container, Build time, code:bash (sim/run.sh copter   # arducopter, model=quad), code:bash (docker build -t ghost-sitl sim/), code:bash (docker tag falcon-sitl ghost-sitl), code:bash (sim/run.sh copter &                                    # boo), code:bash (docker stop ghost-sitl   # (or docker rm -f, if it's not --r), code:bash (git clone --recurse-submodules https://github.com/ArduPilot/) (+4 more)

### Community 25 - "Community 25"
Cohesion: 0.18
Nodes (10): buttonStyle, disabledButtonStyle(), GhostPanel(), GhostPanelProps, headerRowStyle, headingStyle, panelStyle, responseBoxStyle (+2 more)

### Community 26 - "Community 26"
Cohesion: 0.2
Nodes (8): MissionOverlayProps, FALLBACK_CENTER, VEHICLE_ARROW_SVG, VehicleMapProps, initialMissionEditorState, polygonToLineCoordinates(), LatLng, Mission

### Community 27 - "Community 27"
Cohesion: 0.17
Nodes (10): alert, alerts, alertsAgain, critAlert, critAlerts, entry, prev, state (+2 more)

### Community 28 - "Community 28"
Cohesion: 0.2
Nodes (8): ClaudeCliResult, ClaudeError, ClaudeHeadless, extractJsonBlock(), Spawner, SpawnResult, tryJsonParse(), tryValidate()

### Community 29 - "Community 29"
Cohesion: 0.2
Nodes (10): headingStyle, inputStyle, MissionEditor(), MissionEditorProps, modeButtonStyle(), panelStyle, rowStyle, smallButtonStyle (+2 more)

### Community 30 - "Community 30"
Cohesion: 0.18
Nodes (5): COMMAND_IDS, COMMAND_NAMES, DecodedMessage, MissionError, MissionUploadDeps

### Community 31 - "Community 31"
Cohesion: 0.36
Nodes (9): AlertSeverity, evalBatteryLow(), evalBatteryVsHome(), evalGpsDegraded(), evalLinkStale(), evalStatusTextErrors(), evaluateWatchdog(), haversineM() (+1 more)

### Community 32 - "Community 32"
Cohesion: 0.32
Nodes (7): COPTER_MAV_TYPES, COPTER_MODES, modeName(), reduce(), ROVER_MAV_TYPES, ROVER_MODES, vehicleTypeFromMavType()

### Community 33 - "Community 33"
Cohesion: 0.25
Nodes (7): code:bash (pkill -f 'tsx.*bridge/src/index.ts'; pkill -f 'tsx watch'), code:bash (pnpm install       # once), code:bash (GHOST_AI_SMOKE=1 pnpm --filter bridge test claude.smoke), Development, GHOST GCS, Licenses, Running it

### Community 35 - "Community 35"
Cohesion: 0.4
Nodes (3): MissionItem, result, rpcRequestSchema

### Community 36 - "Community 36"
Cohesion: 0.4
Nodes (4): createDefaultSpawner(), makeClaudeHeadless(), claude, schema

### Community 37 - "Community 37"
Cohesion: 0.4
Nodes (4): code:bash (pnpm --filter app dev     # http://localhost:3000 — needs br), Dev, GHOST GCS — app, Layout

### Community 38 - "Community 38"
Cohesion: 0.5
Nodes (3): hb, reader, socket

## Knowledge Gaps
- **347 isolated node(s):** `eslintConfig`, `nextConfig`, `metadata`, `VehicleMap`, `EMPTY_MISSION` (+342 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `VehicleLink` connect `Community 1` to `Community 0`, `Community 17`, `Community 30`, `Community 14`?**
  _High betweenness centrality (0.331) - this node is a cross-community bridge._
- **Why does `TelemetryState` connect `Community 11` to `Community 0`, `Community 16`, `Community 26`, `Community 3`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **What connects `eslintConfig`, `nextConfig`, `metadata` to the rest of the system?**
  _347 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.09 - nodes in this community are weakly interconnected._