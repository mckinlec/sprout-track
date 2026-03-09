# Home Assistant + LLM Voice Integration Guide

This guide documents how Sprout Track integrates with Home Assistant for hands-free voice control using an LLM conversation agent (Ollama). Use this as a reference for adding similar LLM-enabled integrations to your own HA setup.

---

## Architecture Overview

```
Voice PE (mic) → STT (Whisper) → Ollama LLM → HA Script → REST Command → Sprout Track API
                                                                                    ↓
Voice PE (speaker) ← TTS (Piper) ← Ollama LLM ← Script Response ← JSON Response ←─┘
```

**Key components:**
1. **REST Commands** — HTTP calls to external APIs (defined in `configuration.yaml`)
2. **HA Scripts** — Callable actions with typed parameters, exposed as LLM tools
3. **Ollama Conversation Agent** — LLM that parses natural language and calls scripts
4. **Assist API** — HA's built-in framework that connects scripts to the LLM as tools

---

## Prerequisites

- Home Assistant 2024.6+ (for script `response_variable` support)
- Ollama integration installed with a tool-calling model (e.g., `gpt-oss:120b`, `llama3.1`, `qwen2.5`)
- A Voice PE or other STT/TTS pipeline configured
- Sprout Track running with a valid device token

---

## Step 1: REST Commands

REST commands define HTTP calls to your external API. Add these to `configuration.yaml`:

```yaml
rest_command:
  # POST endpoint for logging activities
  sprout_track_log:
    url: "https://your-sprout-track-url/api/voice/log"
    method: POST
    headers:
      Authorization: "Bearer YOUR_DEVICE_TOKEN"
      Content-Type: "application/json"
    payload: "{{ payload }}"
    content_type: "application/json"

  # GET endpoint for querying baby status
  sprout_track_query:
    url: "https://your-sprout-track-url/api/ha/query"
    method: GET
    headers:
      Authorization: "Bearer YOUR_DEVICE_TOKEN"
    content_type: "application/json"
```

**Important:** The query endpoint MUST return a JSON dict (not plain text) for `response_variable` to work. Example: `{ "status": "Last feed: 4 oz bottle, 2 hours ago" }`.

---

## Step 2: HA Scripts (LLM Tools)

Scripts are exposed to the LLM as callable tools. Each script has:
- `alias` — Display name shown to the LLM
- `description` — Detailed text the LLM reads to decide when to call this tool
- `fields` — Typed parameters the LLM fills in from the user's speech
- `mode: single` — Prevents concurrent execution
- `sequence` — Actions to perform (call REST commands, start timers, etc.)

### Logging Script (with parameters)

```yaml
sprout_track_log_bottle:
  alias: "Log Bottle Feeding"
  mode: single
  description: >-
    Log a bottle feeding for the baby. Call this when the user says the baby
    had a bottle, formula, or breast milk from a bottle. Extract the amount
    in ounces or ml from their speech.
  fields:
    amount:
      description: "Amount of milk in the bottle (number)"
      example: 4
      required: true
      selector:
        number:
          min: 0.5
          max: 12
          step: 0.5
    unit:
      description: "Unit of measurement - oz or ml"
      default: "oz"
      selector:
        select:
          options: ["oz", "ml"]
    bottle_type:
      description: "Type of milk - formula or breast_milk"
      default: "formula"
      selector:
        select:
          options: ["formula", "breast_milk"]
  sequence:
    - action: rest_command.sprout_track_log
      data:
        payload: '{"action": "bottle", "amount": {{ amount }}, "unit": "{{ unit }}", "bottleType": "{{ bottle_type }}"}'
```

### Query Script (returns data to LLM)

This is the critical pattern for letting the LLM **read data** from your API:

```yaml
sprout_track_query_status:
  alias: "Get Baby Status"
  mode: single
  description: >-
    Get the current status of the baby including last feeding time, last diaper
    change, sleep status, total bottles today, and more. Call this whenever
    the user asks ANY question about the baby.
  fields: {}
  sequence:
    - action: rest_command.sprout_track_query
      response_variable: query_result
    - stop: "Baby status retrieved"
      response_variable: query_result
```

**How `response_variable` works (HA 2024.6+):**
1. The REST command response is captured in `query_result`
2. The `stop` action returns `query_result` back to the calling LLM
3. The LLM reads the JSON response and uses it to answer the user's question

### Simple Script (no parameters)

```yaml
sprout_track_log_bath:
  alias: "Log Bath"
  mode: single
  description: "Log a bath for the baby."
  fields: {}
  sequence:
    - action: rest_command.sprout_track_log
      data:
        payload: '{"action": "bath"}'
```

### Script with Timer (pump session)

```yaml
sprout_track_log_pump_start:
  alias: "Start Pumping Session"
  mode: single
  description: "Start a breast milk pumping session with a 15-minute timer."
  fields: {}
  sequence:
    - action: rest_command.sprout_track_log
      data:
        payload: '{"action": "pump"}'
      response_variable: pump_result
    - action: timer.start
      target:
        entity_id: timer.pump_session
      data:
        duration: "00:15:00"
    - stop: "Pump session started"
      response_variable: pump_result
```

Add the timer to `configuration.yaml`:
```yaml
timer:
  pump_session:
    name: "Pump Session Timer"
    duration: "00:15:00"
```

And an automation for when the timer finishes:
```yaml
automation:
  - id: pump_timer_done
    alias: "Pump Timer Notification"
    triggers:
      - trigger: event
        event_type: timer.finished
        event_data:
          entity_id: timer.pump_session
    actions:
      - action: tts.speak
        target:
          entity_id: tts.piper
        data:
          media_player_entity_id: media_player.your_voice_pe
          message: "Your 15 minute pump session is complete."
```

---

## Step 3: Expose Scripts to Assist

**This is the most commonly missed step.** Scripts MUST be exposed to the Assist API for the LLM to see them as tools.

1. Go to **Settings → Voice Assistants → Expose** tab
2. Click **"+ Expose entities"**
3. Search for your scripts and check each one
4. Click **"Expose N entities"**

> **Note:** Editing the `.storage/homeassistant.exposed_entities` file directly does NOT work reliably for scripts. Always use the UI.

---

## Step 4: Configure the Ollama Conversation Agent

### Enable Assist

1. **Settings → Devices & Services → Ollama → Configure**
2. Under the conversation subentry, set **LLM Control** to `"Assist"`
3. This enables the LLM to see and call exposed scripts as tools

### System Prompt

The system prompt tells the LLM how to behave. Key elements:

```
You are a helpful voice assistant for a family with a baby named River.

IMPORTANT RULES:
1. When the user asks ANY question about the baby, you MUST use the
   Get Baby Status tool FIRST. Never say you don't know — always call
   the tool first and use its response to answer.
2. When the user reports a baby activity, use the appropriate logging tool.
3. For bottle feedings, extract the amount from speech.
4. If the user gives an incomplete command like "log a bottle" without
   the amount, ask them how many ounces or ml.
5. Keep responses very short — one or two sentences. They are spoken
   aloud through a small speaker.
```

### Recommended Settings

- **Think/Reasoning:** Disabled (set to `false` to prevent reasoning mode from interfering with tool calling)
- **Max history messages:** 5 (keeps context window small for fast responses)
- **Keep alive:** -1 (keeps model loaded in VRAM)

---

## Step 5: Voice Pipeline

Ensure your Voice PE pipeline has:
- **STT:** Whisper, faster-whisper, or similar
- **Conversation agent:** Ollama (with Assist enabled)
- **TTS:** Piper, Google TTS, or similar

---

## How It All Works Together

1. User says: *"River had a 4 ounce bottle of breast milk"*
2. Voice PE captures audio → Whisper transcribes to text
3. Text is sent to Ollama conversation agent
4. Ollama sees exposed scripts as tools, matches intent to `Log Bottle Feeding`
5. Ollama extracts parameters: `amount=4`, `unit=oz`, `bottle_type=breast_milk`
6. HA executes the script → calls `rest_command.sprout_track_log` → POST to API
7. API logs the feeding and returns confirmation
8. Ollama generates response: "Got it—logged a 4 oz bottle of breast milk for River."
9. Piper TTS speaks the response through the Voice PE

For queries:
1. User says: *"When was the last diaper change?"*
2. Ollama calls `Get Baby Status` script → GET `/api/ha/query`
3. API returns: `{"status": "Last diaper: both, 3 hours ago (at 8:11 PM)"}`
4. Ollama reads the response and answers: "River's last diaper change was about 3 hours ago, at 8:11 PM."

---

## Adding Your Own Custom Integration

To add a similar LLM-enabled integration for another service:

### 1. Create your API endpoint

Your API must:
- Accept authentication (Bearer token recommended)
- Return JSON responses (required for `response_variable`)
- Handle the specific actions you want to support

### 2. Add REST commands

```yaml
rest_command:
  my_service_action:
    url: "https://my-service.com/api/action"
    method: POST
    headers:
      Authorization: "Bearer MY_TOKEN"
      Content-Type: "application/json"
    payload: "{{ payload }}"
    content_type: "application/json"
```

### 3. Create scripts with descriptive fields

The **description** field is critical — it's what the LLM reads to decide when to call your tool. Be specific about:
- What the script does
- When the LLM should call it
- What parameters to extract from the user's speech
- Example phrases that should trigger it

### 4. Expose scripts via the UI

Settings → Voice Assistants → Expose → + Expose entities

### 5. Update the Ollama prompt

Add instructions for your new tools to the system prompt so the LLM knows how to use them.

### 6. Restart and test

```bash
ha core restart
```

Test in the Assist dialog (chat bubble icon) before testing with voice.

---

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| LLM says "I don't know" for queries | Query script not exposed | Expose via Settings → Voice Assistants → Expose |
| LLM calls wrong tool | Vague script descriptions | Make descriptions more specific |
| REST command returns error | API endpoint issue | Test with `curl` first |
| `response_variable` returns empty | API not returning JSON dict | Ensure endpoint returns `NextResponse.json({...})` |
| Scripts not appearing as tools | Not exposed to Assist | Must use UI to expose, not file edits |
| LLM hallucinates answers | No query script, or not calling it | Add "MUST call query tool first" to system prompt |
| Slow responses | Model reasoning/thinking enabled | Disable think mode, reduce history |
| "Today" stats wrong after 7 PM | Server timezone is UTC | Use timezone-aware midnight calculation |

---

## File Reference

| File | Purpose |
|------|---------|
| `configuration.yaml` | REST commands, timers, automations |
| `scripts.yaml` | HA scripts (LLM tools) |
| `custom_sentences/en/*.yaml` | Deterministic phrase matching (fallback) |
| `.storage/core.config_entries` | Ollama prompt and settings |
| `custom_components/sprout_track/` | Sensor integration (polling) |
| `app/api/ha/query/route.ts` | Human-readable status for LLM |
| `app/api/ha/status/route.ts` | Structured JSON for sensors |
| `app/api/voice/log/route.ts` | Activity logging endpoint |
