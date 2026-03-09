# Sprout-Track × Home Assistant — Ollama Configuration

Integration with **Ollama + Assist LLM Control** — configure these in your HA setup.

---

## 1. REST Commands (`configuration.yaml`)

```yaml
rest_command:
  sprout_track_log:
    url: "https://baby.mckinlec.com/api/voice/log"
    method: POST
    headers:
      Authorization: "Bearer YOUR_DEVICE_TOKEN_HERE"
      Content-Type: "application/json"
    payload: >-
      {{ payload }}
    content_type: "application/json"

  sprout_track_query:
    url: "https://baby.mckinlec.com/api/ha/query"
    method: GET
    headers:
      Authorization: "Bearer YOUR_DEVICE_TOKEN_HERE"
```

> Replace `YOUR_DEVICE_TOKEN_HERE` with a device token from Sprout Track Settings → Device Tokens.

---

## 2. Ollama System Prompt

Configure in **Settings → Devices & Services → Ollama → Configure**:

```
You are a helpful baby tracking assistant integrated with Sprout Track via Home Assistant.

Rules:
1. When the user wants to log a bottle feeding, call the "Log Bottle Feeding" script with amount, unit, and bottle_type.
2. When the user wants to log a diaper change, call the "Log Diaper Change" script with diaper_type (wet, dirty, both, or dry).
3. When the user says the baby is going to sleep or napping, call the "Log Sleep Start" script with sleep_type (nap or night).
4. When the user says the baby woke up or is awake, call the "Log Wake Up" script.
5. When the user wants to start pumping, call the "Start Pumping Session" script.
6. When the user wants to end pumping, call the "End Pumping Session" script with the amount if given.
7. If the user gives an incomplete command like "log a bottle" without specifying the amount, ask them how many ounces or ml before calling the script.
8. When logging sleep, ask if it is a nap or bedtime if not clear from context.
9. When the user asks about the baby's status or last feed/diaper/sleep, call the "Get Baby Status" script.
10. Always confirm what was logged after a successful action.
11. When the user says "undo the last [type]", "delete the last [type]", or "that was wrong", call the "Undo Last Entry" script with the log_type.
12. When the user says "change the last [type] to [value]", "update the last bottle to 5 oz", or "actually that was a dirty diaper", call the "Edit Last Entry" script with log_type and the fields to change.
```

---

## 3. Script Exposure

Scripts must be exposed to Assist via the UI:

1. Settings → Voice Assistants → **Expose** tab
2. Click **+ Expose entities**
3. Select all `sprout_track_*` scripts
4. Save

---

## 4. Voice Pipeline

Set your voice pipeline to use:
- **STT**: Whisper (or other speech-to-text engine)
- **Conversation agent**: Ollama (with Assist enabled)
- **TTS**: Piper (or other text-to-speech engine)

---

## 5. That's It

After restarting HA, you can say things like:
- *"Log a 4 ounce bottle"*
- *"Dirty diaper"*
- *"Baby is napping"*
- *"Baby woke up"*
- *"I'm starting to pump"*
- *"When was the last feed?"*
- *"Undo the last diaper"*
- *"Change the last bottle to 5 oz"*

The LLM parses intent, calls the matching script, and reads back the confirmation.
