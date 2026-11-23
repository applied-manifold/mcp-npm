# Spatial Compiler

Your agent gets fully simulated, engine-ready 3D in seconds, from one call.

You write a spec, or your agent does. Spatial Compiler compiles it on the hosted service and sends back assets you can drop into your game. pyrofx compiles fire and smoke. meshfx repairs and lightens meshes. geofx shapes ground and terrain. shadowfx bakes moving shadows. You do not wait for your agent to write simulation or shader code from scratch.

You get real simulation quality in seconds, not hours. The same spec gives you the same result. You see the price before you run. It works from any MCP client, including Claude Code, Cursor, and Codex, and over HTTP.

You can use the results in Godot, Unity, Unreal, and three.js.

Games are where this starts. The same call also serves robotics, ecommerce, and other 3D work that needs a fully simulated, engine-ready result.

This repository is the npm package [`@applied-manifold/spatial-compiler`](https://www.npmjs.com/package/@applied-manifold/spatial-compiler). It is a small connector that forwards MCP calls to [https://mcp.spatialcompiler.dev](https://mcp.spatialcompiler.dev). You can also point a client at that URL directly. Nothing compiles on your machine. Jobs are billed the same as when you use the hosted server directly.

This repository does not include Spatial Compiler or any compiler source.

[Get Free API Key](https://console.appliedmanifold.com)

More about Spatial Compiler: [https://appliedmanifold.com](https://appliedmanifold.com)

## Install and run

You need Node.js 18 or newer and an API key. [Get Free API Key](https://console.appliedmanifold.com)

```sh
SPATIAL_API_KEY=YOUR_KEY npx -y @applied-manifold/spatial-compiler
```

Your MCP client normally starts this command for you. Use one of the setups below. If you omit the key, the connector opens a browser sign-in and remembers the session.

### Claude Code

```sh
claude mcp add spatial-compiler -e SPATIAL_API_KEY=YOUR_KEY -- npx -y @applied-manifold/spatial-compiler
```

### Cursor (stdio via npm)

Add this to `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project):

```json
{
  "mcpServers": {
    "spatial-compiler": {
      "command": "npx",
      "args": ["-y", "@applied-manifold/spatial-compiler"],
      "env": {
        "SPATIAL_API_KEY": "YOUR_KEY"
      }
    }
  }
}
```

### Cursor or any client (hosted MCP, no npm)

```json
{
  "mcpServers": {
    "spatial-compiler": {
      "url": "https://mcp.spatialcompiler.dev"
    }
  }
}
```

The hosted server signs you in through [console.appliedmanifold.com](https://console.appliedmanifold.com) when the client supports OAuth.

### Codex

Add this to `~/.codex/config.toml`:

```toml
[mcp_servers.spatial-compiler]
command = "npx"
args = ["-y", "@applied-manifold/spatial-compiler"]
env = { SPATIAL_API_KEY = "YOUR_KEY" }
```

Or from a terminal:

```sh
codex mcp add spatial-compiler --env SPATIAL_API_KEY=YOUR_KEY -- npx -y @applied-manifold/spatial-compiler
```

Any other MCP client that can start a stdio server works the same way: run `npx -y @applied-manifold/spatial-compiler` with `SPATIAL_API_KEY` in its environment.

## Sign in without an API key

If you start the server without a key, it opens a browser sign-in against the hosted service and remembers the session, so later runs start without asking. The session (including the refresh token) is saved in `~/.config/spatial-compiler/mcp-oauth.json` (or under `$XDG_CONFIG_HOME`) with file mode 0600.

If your client cannot open a browser, sign in once from a terminal:

```sh
npx -y @applied-manifold/spatial-compiler login
```

To forget the saved session:

```sh
npx -y @applied-manifold/spatial-compiler logout
```

## Environment variables

| Variable | Purpose |
| --- | --- |
| `SPATIAL_API_KEY` | API key (`spck_live_...` or `spck_test_...`). Preferred, matches the public docs. |
| `SPATIAL_COMPILER_API_KEY` | Same, used when `SPATIAL_API_KEY` is not set. |
| `SPATIAL_COMPILER_MCP_URL` | Optional. Hosted MCP URL without a trailing slash. Default `https://mcp.spatialcompiler.dev`. |

With a key set, the server sends `Authorization: Bearer <key>` and does not use the browser sign-in.

Logs go to stderr. stdout carries only the MCP stream.

Run `npx -y @applied-manifold/spatial-compiler --help` for a summary.

## What the hosted server can do

The hosted service compiles fire and smoke with pyrofx, meshes with meshfx, ground and terrain with geofx, and moving shadows with shadowfx.

The hosted server lists `discover`, `add_input`, `estimate`, `submit`, `get_job`, and `cancel_job`. `estimate` is free. `submit` starts a paid job.

Ask your agent to write a spec, get a free price estimate, and run a job. You get back fully simulated, engine-ready 3D, plus a report your code can check. After a run, the bundled `verify-compiled-job` skill reads the receipt and inspects a framed still.

## Links

- Site: [https://appliedmanifold.com](https://appliedmanifold.com)
- Console and API keys: [https://console.appliedmanifold.com](https://console.appliedmanifold.com)
- Hosted MCP: [https://mcp.spatialcompiler.dev](https://mcp.spatialcompiler.dev)
- Agent docs: [https://appliedmanifold.com/docs/agents/](https://appliedmanifold.com/docs/agents/)
- MCP tools docs: [https://appliedmanifold.com/docs/mcp-tools/](https://appliedmanifold.com/docs/mcp-tools/)
- Modules: [https://appliedmanifold.com/modules/](https://appliedmanifold.com/modules/)
- Examples: [https://appliedmanifold.com/modules/pyrofx/](https://appliedmanifold.com/modules/pyrofx/)
- Terms: [https://appliedmanifold.com/terms/](https://appliedmanifold.com/terms/)
- Privacy: [https://appliedmanifold.com/privacy/](https://appliedmanifold.com/privacy/)

## License

MIT. Copyright 10356689 Canada Inc. (Applied Manifold). See [LICENSE](./LICENSE). This package does not include Spatial Compiler or any compiler source.
