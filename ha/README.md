# Home Assistant Configuration for Sprout Track

These files are **snippets** to merge into your Home Assistant configuration. They are not standalone HA config files.

## Files

| File | Merge Into | Purpose |
|------|-----------|---------|
| `configuration.yaml` | `/homeassistant/configuration.yaml` | REST commands + pump timer |
| `scripts.yaml` | `/homeassistant/scripts.yaml` | Voice-callable scripts (LLM tools) |
| `automations.yaml` | `/homeassistant/automations.yaml` | Pump timer TTS notification |

## Setup

1. Replace `YOUR_DEVICE_TOKEN_HERE` in `configuration.yaml` with a token from Sprout Track Settings → Device Tokens
2. Merge each file into the corresponding HA config file
3. Restart HA: `ha core restart`
4. Expose all `sprout_track_*` scripts to Assist: Settings → Voice Assistants → Expose → + Expose entities
5. Configure Ollama conversation agent with the system prompt from `docs/ha-assistant-prompt.md`

## Deploy Script

```bash
# From repo root — copy scripts to HA:
scp ha/scripts.yaml root@192.168.1.22:/homeassistant/scripts.yaml
ssh root@192.168.1.22 "ha core restart"
```

> **Important:** After adding new scripts, you must expose them via the HA UI (step 4). File edits alone won't make scripts visible to the LLM.

## Available Scripts

| Script | Voice Trigger | Action |
|--------|--------------|--------|
| Log Bottle | "log a 4 oz bottle" | Creates bottle feed entry |
| Log Diaper | "dirty diaper" | Creates diaper entry |
| Log Nursing | "baby nursed on left side" | Creates nursing entry |
| Start Sleep | "baby is going to sleep" | Starts sleep session |
| End Sleep | "baby woke up" | Ends active sleep session |
| Log Bath | "baby had a bath" | Creates bath entry |
| Log Medicine | "gave Tylenol" | Creates medicine entry |
| Start Pump | "I'm starting to pump" | Starts pump + 15 min timer |
| End Pump | "done pumping, got 4 oz" | Ends pump session |
| Get Status | "when was the last feed?" | Queries baby status |
| Undo Last | "undo the last diaper" | Soft-deletes most recent entry |
| Edit Last | "change the last bottle to 5 oz" | Updates most recent entry |
