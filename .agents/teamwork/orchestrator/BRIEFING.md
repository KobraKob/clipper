# BRIEFING — 2026-11-06T10:24:00Z

## Mission
Orchestrate the complete redesign of the web application (fresh design system, responsive UI components, Framer Motion animations, verification).

## 🔒 My Identity
- Archetype: teamwork_orchestrator
- Roles: orchestrator, user_liaison, human_reporter, successor
- Working directory: c:\Users\badhu\OneDrive\Desktop\project-hire\clipping\.agents\teamwork\orchestrator
- Original parent: parent
- Original parent conversation ID: a38a39eb-40b1-412e-b213-b1174dc44ba4

## 🔒 My Workflow
- **Pattern**: Project
- **Scope document**: c:\Users\badhu\OneDrive\Desktop\project-hire\clipping\.agents\teamwork\PROJECT.md
1. **Decompose**: Decompose the redesign into survey, design system & tokens, responsive UI components & pages, framer-motion animations, and end-to-end verification.
2. **Dispatch & Execute**:
   - **Survey (Step 0)**: Dispatch 3 parallel Explorers to inspect existing web architecture, components, routes, styling, dependencies, tests, and build scripts.
   - **Decompose (Step 1)**: Aggregate survey findings into PROJECT.md with feature inventory, milestones, and interface contracts.
   - **Delegate (Step 2)**: Dispatch sub-orchestrators / workers per milestone with rigorous verification loops (Worker -> Reviewer -> Challenger -> Auditor -> Gate).
3. **On failure** (in this order):
   - Retry: nudge stuck agent or re-send task
   - Replace: spawn fresh agent with partial progress
   - Skip: proceed without (only if non-critical)
   - Redistribute: split stuck agent's remaining work
   - Redesign: re-partition decomposition
   - Escalate: report to parent (sub-orchestrators only, last resort)
4. **Succession**: at 16 spawns, write handoff.md, spawn successor
- **Work items**:
  1. Survey & Architecture Mapping [in-progress]
  2. PROJECT.md Creation & Milestones Decomposition [pending]
  3. Execution of Design System, UI Components, Motion Milestones [pending]
  4. Final Verification (Build, Lint, Tests, Audits) [pending]
- **Current phase**: 0 (Survey)
- **Current focus**: Monitoring 3 Explorers for survey completion

## 🔒 Key Constraints
- Never write, modify, or create source code files directly.
- Never run build/test commands yourself — require workers to do so.
- Never investigate or explore the problem at the code level — dispatch Explorers for technical investigation.
- File-editing tools only for metadata/state files (.md) in .agents/teamwork/
- If a Forensic Auditor reports INTEGRITY VIOLATION, milestone fails unconditionally.
- Never reuse a subagent after it has delivered its handoff — always spawn fresh

## Current Parent
- Conversation ID: a38a39eb-40b1-412e-b213-b1174dc44ba4
- Updated: not yet

## Key Decisions Made
- Dispatched 3 parallel Explorers for Phase 0 survey.
- Set up 10-minute heartbeat cron and safety timer.

## Team Roster
| Agent | Type | Work Item | Status | Conv ID |
|-------|------|-----------|--------|---------|
| explorer_survey_1 | teamwork_explorer | Tech Infrastructure Survey | in-progress | 66b32049-e901-4899-b548-ef5f9456d578 |
| explorer_survey_2 | teamwork_explorer | Design System & UI Components Survey | in-progress | edb8a828-9905-4f65-8330-58d9bfd2e340 |
| explorer_survey_3 | teamwork_explorer | Pages, Layout, Responsiveness & Tests Survey | in-progress | 15599f59-b42d-49e0-b9df-0f1b880f889f |

## Succession Status
- Succession required: no
- Spawn count: 3 / 16
- Pending subagents: 66b32049-e901-4899-b548-ef5f9456d578, edb8a828-9905-4f65-8330-58d9bfd2e340, 15599f59-b42d-49e0-b9df-0f1b880f889f
- Predecessor: none
- Successor: not yet spawned

## Active Timers
- Heartbeat cron: c26fdaf5-cbf4-451f-9692-52dbb8e44e8a/task-31
- Safety timer: c26fdaf5-cbf4-451f-9692-52dbb8e44e8a/task-33
- On succession: kill all timers before spawning successor
- On context truncation: handle timers as step 4 of the State Recovery section of your prompt says

## Artifact Index
- c:\Users\badhu\OneDrive\Desktop\project-hire\clipping\.agents\teamwork\ORIGINAL_REQUEST.md — Original User Request
- c:\Users\badhu\OneDrive\Desktop\project-hire\clipping\.agents\teamwork\orchestrator\DISPATCH.md — Dispatch log
- c:\Users\badhu\OneDrive\Desktop\project-hire\clipping\.agents\teamwork\orchestrator\progress.md — Progress tracker
- c:\Users\badhu\OneDrive\Desktop\project-hire\clipping\.agents\teamwork\orchestrator\plan.md — Execution plan
