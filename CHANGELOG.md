# Changelog

All notable changes to Jarvis Central. Versions follow semver; see `CLAUDE.md` for what counts as what.

## Unreleased

## 0.1.0 — 2026-09-29
First public version, extracted from a personal setup.
- Website: Overview (deadlines, burn-up per project, pace vs needed, who it's waiting on, weekly throughput,
  rhythm heatmap, work ahead, time per project), Today (calendar + daily list + backlog, drag and drop), Week,
  a tab per project (checklist, weekly reviews, strategy documents), Reviews, Inbox; discussion threads on
  every review. Login with password + TOTP.
- Mac agent: inbox worker (discuss / build-a-PR), Sunday planner (estimates + deterministic packing around your
  calendar), Monday reviews (CEO/CMO/PO advisors per project, recap, how you work with Claude, Jarvis usage),
  project scaffolding (`CLAUDE.md` + `PRD.md`), first checklists from PRDs, doctor, security check.
- Calendars: read Google (secret iCal) and Apple (iCloud public links); write the week plan to Google (Apps
  Script) and Apple (subscription feed).
