# @applied-manifold/spatial-compiler

Your agent gets fully simulated, engine-ready 3D in seconds through one call, instead of AI writing simulation code from scratch.

Spatial Compiler works with any MCP client. Godot 4 is available today (a ready scene). three.js is available today (a sprite snippet that plays the packed RGBA sheet). Unity, Unreal Engine and Roblox are Soon.

This package is a local stdio MCP server that sends every call to Applied Manifold's hosted Spatial Compiler MCP at `https://mcp.spatialcompiler.dev`. Nothing compiles on your machine. Jobs are billed the same as when you use the hosted server directly.

[Get Free API Key](https://console.appliedmanifold.com)

More about Spatial Compiler: https://appliedmanifold.com

## Install and run

You need Node.js 18 or newer and an API key. [Get Free API Key](https://console.appliedmanifold.com)

```sh
SPATIAL_API_KEY=YOUR_KEY npx -y @applied-manifold/spatial-compiler
```

Your MCP client normally starts this command for you. Use one of the setups below.

## Client setup

### Claude Code

```sh
claude mcp add spatial-compiler -e SPATIAL_API_KEY=YOUR_KEY -- npx -y @applied-manifold/spatial-compiler
```

### Cursor

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

If you start the server without a key, it opens a browser sign in against the hosted service and remembers the session, so later runs start without asking. The session (including the refresh token) is saved in `~/.config/spatial-compiler/mcp-oauth.json` (or under `$XDG_CONFIG_HOME`) with file mode 0600.

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

With a key set, the server sends `Authorization: Bearer <key>` and does not use the browser sign in.

Logs go to stderr. stdout carries only the MCP stream.

Run `npx -y @applied-manifold/spatial-compiler --help` for a summary.

## License

Proprietary. Not open source. `UNLICENSED`. See [LICENSE](./LICENSE) and https://appliedmanifold.com/terms/
