# Contributing

Thanks for improving Jarvis Central. It's a tool many people run on their own accounts, so changes must work for
anyone's projects, timezone and calendars.

1. Open an issue first for anything bigger than a fix. The Monday Jarvis review writes issues in this shape:
   problem (with evidence from real use), proposal, acceptance criteria, effort, breaking change?, migration?
2. Branch from `main`, keep the PR focused, and follow the rules in [`CLAUDE.md`](CLAUDE.md): generic code, no
   instance data, backwards-compatible config, additive database changes, API docs updated, CHANGELOG entry.
3. Run the checks listed there. Include a screenshot for UI changes, taken from a test instance with fake data.
4. Security-sensitive changes (auth, tokens, the worker's permissions, anything that sends data off the Mac)
   need a note in the PR on what changes in `docs/security.md`.
