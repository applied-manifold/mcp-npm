---
name: verify-compiled-job
description: Read a compact qa receipt after a Spatial Compiler check or bake, inspect a finished job, and review numbers plus a framed still. Visual quality stays unassessed until that still is opened.
---

# Verify a compiled job

Use this after a hosted MCP check, bake, or `get_job` on Spatial Compiler. Do not add a new tool. Use the existing tools: `estimate`, `submit`, `get_job`.

## Receipt

A finished job and a check both return a compact `qa` receipt:

- `verdict`: `pass`, `warn`, or `block`
- `blockers`: issues that must be fixed before a bake can pass
- findings grouped by code, each with one repair hint
- `metrics` from the spec or the measured report
- `visual_qa`: stays `not_assessed` until you open the framed still, then `available_for_review`. Never treat visual quality as a pass or fail from the receipt alone.

Ask for `detail` `compact` unless you need `lean` or `full`.

## Inspect

`submit` with `operation` set to `inspect` and a `job_id` is free and does not start a bake. It can measure, compare two jobs, isolate a part or frame, or return a framed still.

## How to check

Review the numbers and the framed still. Do not judge the work by watching the video.

Docs: https://appliedmanifold.com/docs/mcp-tools/#qa
