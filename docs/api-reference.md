# Studio API Reference

## POST /api/generate

Main pipeline endpoint. Streams SSE events as 4 agents execute.

**Request:**
```json
{ "prompt": "Spur gear 20 teeth module 2 pitch diameter 40mm" }
```

**SSE Events:**
| Event Type | Data | Description |
|---|---|---|
| `phase` | `{ phase: "parsing" }` | Pipeline phase change |
| `intent` | `{ data: IntentJSON }` | Nemotron parsed intent |
| `agent_done` | `{ agent, tokens, cost }` | Agent completion metrics |
| `tree` | `{ data: DesignTree }` | Parametric dependency graph |
| `code` | `{ data: "python..." }` | Build123d Python code |
| `scores` | `{ data: ScoreResult }` | Quality scores |
| `agent_log` | `{ agent, message }` | Log entry |
| `error` | `{ message }` | Error occurred |

## POST /api/compile

Compiles Build123d Python code to binary STL.

**Request:**
```json
{ "code": "from build123d import *\nresult = Box(10,10,10)" }
```

**Response:** Binary STL (application/octet-stream)

## POST /api/analyze-image

Analyzes an image and returns a design prompt via DIR pipeline.

**Request:**
```json
{ "imageBase64": "base64string...", "mimeType": "image/jpeg" }
```

**Response:**
```json
{
  "description": "Create a gear mechanism. Target diameter: 80mm...",
  "dir": { "family": "gear_mechanism" },
  "model": "nvidia/nemotron-nano-12b-v2-vl"
}
```

## POST /api/edit-node

Natural language editing of a single node.

**Request:**
```json
{
  "instruction": "make it thicker",
  "node": { "id": "body", "op": "cylinder", "params": {} },
  "fullTree": "DesignTree"
}
```

**Response:**
```json
{ "params": { "height": 20 } }
```

## POST /api/generate-code

Generates Build123d code from a design tree (used after node edits).

**Request:**
```json
{ "tree": "DesignTree" }
```

**Response:**
```json
{ "code": "from build123d import *\n..." }
```
