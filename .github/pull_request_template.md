## What changes

<!-- One or two sentences. Say what a buyer or agent can now do. -->

## Feature gate

Fill this in when the PR adds or changes a tool, a tool argument, an example or the README. Otherwise write "No contract change."

- [ ] **Concept.** It belongs to exactly one of: Intent, Source, World, Target, Look, Proof. Which one: ____
- [ ] **Buyer job.** In one line, without naming a competitor: "so my asset ____"
- [ ] **Default.** It has a default that works for most people, and a spec that leaves the field out still gets a good result. Default: ____
- [ ] **Unit and range.** The served schema has them, plus a one-line meaning written as an outcome.
- [ ] **Reach.** An agent can reach it through an intent value or through a warning's `fix.key`.
- [ ] **Proof.** Its effect shows up in a report metric, a warning code or the preview: ____
- [ ] **No duplicate.** Nothing else already sets this (World covers wind, sun, gravity, weather and events).
- [ ] **No dead knob.** It works today. It isn't an unbuilt stage, and it has more than one legal value.
- [ ] **Names.** It uses pyrofx, meshfx or geofx and `.spc.toml` terms, with old names accepted as aliases.
- [ ] **Errors.** Any new code uses the one shape: `{code, severity, message, key?, nearest?, range?, fix: {key, hint}}`.

## Checks

- [ ] Tests pass locally. Write down any failures that were already there.
- [ ] No version number written on the branch. Versions are assigned at merge.
- [ ] No secrets or keys in the diff, logs or screenshots.
