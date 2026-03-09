# Sprout Track — Home Assistant Setup Guide

## What is Sprout Track?

[Sprout Track](https://baby.mckinlec.com) is a baby activity tracker for logging bottles, nursing, diapers, sleep, baths, medicine, measurements, moods, play sessions, and more. It's used daily by parents and caretakers to keep track of a newborn's routine.

## Why Home Assistant?

Integrating Sprout Track with Home Assistant turns your baby data into a first-class part of your smart home:

- **At-a-glance dashboards** — see last feed, diaper count, and sleep status on wall-mounted tablets alongside your other HA cards
- **Hands-free logging** — say *"log 4 ounce bottle"* or *"dirty diaper"* through your voice assistant while your hands are full
- **Smart automations** — dim nursery lights when baby falls asleep, get notified when it's been too long since the last feed, or track patterns over time with HA's history graphs
- **Everything in one place** — no need to unlock your phone and open an app when HA is already running your home

The source code is in the [sprout-track GitHub repo](https://github.com/mckinlec/sprout-track). The app is live at [baby.mckinlec.com](https://baby.mckinlec.com).

---

## Prerequisites

- Home Assistant with SSH or Samba add-on access
- A device token from Sprout Track (Settings → Device Tokens → Create)
- [HACS](https://hacs.xyz/) installed (optional, for auto-updates)
- [Ollama](https://ollama.com/) running locally with a tool-calling model (e.g., `qwen2.5`, `llama3.1`)
- Ollama and Home Assistant LLM API integrations installed in HA

---

## Part 1: Install the Sprout Track Integration (Sensors + Services)

This gives you native HA sensors (last feed, diaper count, sleep status, etc.) and services (log_bottle, log_diaper, etc.) per baby.

### Step 1: Copy integration files to HA

**Option A — Samba share:**
```
\\HOMEASSISTANT\config\custom_components\sprout_track\
```
Copy the entire `custom_components/sprout_track/` folder from the repo into your HA config directory. You should end up with:
```
/config/custom_components/sprout_track/
├── __init__.py
├── binary_sensor.py
├── config_flow.py
├── const.py
├── coordinator.py
├── manifest.json
├── sensor.py
├── services.yaml
└── strings.json
```

**Option B — SSH:**
```bash
# SSH into HA (port may be 22222 for the SSH add-on)
ssh -p 22222 root@192.168.1.22

# Create the directory
mkdir -p /config/custom_components/sprout_track

# Then either git clone or SCP the files:
# From another machine:
scp -r -P 22222 custom_components/sprout_track/* root@192.168.1.22:/config/custom_components/sprout_track/
```

**Option C — HACS custom repo:**
1. Open HACS in HA sidebar
2. Three dots menu → Custom repositories
3. Add `https://github.com/mckinlec/sprout-track` as type "Integration"
4. Search for "Sprout Track" and install

### Step 2: Restart Home Assistant

Settings → System → Restart (or `ha core restart` via SSH)

### Step 3: Add the integration

1. Settings → Devices & Services → **Add Integration**
2. Search for **"Sprout Track"**
3. Enter:
   - **URL**: `https://baby.mckinlec.com`
   - **Device Token**: paste the token from Sprout Track Settings
4. Click Submit

### What you get

**Per baby, a device appears with these sensors:**

| Sensor | Example Value | Attributes |
|--------|------|------------|
| Last Feed | "45m ago" | type, amount, unit, side |
| Last Diaper | "20m ago" | type (wet/dirty/both) |
| Sleeping (binary) | on/off | type (nap/night), duration |
| Sleep | "Napping (1h 20m)" | start_time, last completed sleep |
| Feeds Today | 6 | — |
| Diapers Today | 4 | — |
| Total Bottle Oz Today | 18.5 | — |
| Last Bath | "2d ago" | time |
| Last Medicine | "Tylenol 3h ago" | name, amount, time |
| Last Note | note content | time |
| Last Pump | "1h ago" | amount, left/right, duration |
| Last Play | "Tummy Time 2h ago" | type, duration |
| Mood | "Happy" | time (icon changes per mood) |
| Weight | 14.2 | unit (lb/kg), date |
| Height | 25.5 | unit, date |
| Temperature | 98.6 | unit (°F/°C), date |
| Head Circumference | 16.2 | unit, date |

**Services available (Developer Tools → Services):**

| Service | Required Fields | Optional Fields |
|---------|----------------|-----------------|
| `sprout_track.log_bottle` | — | amount, unit, bottle_type, baby_name |
| `sprout_track.log_nursing` | — | side, baby_name |
| `sprout_track.log_diaper` | — | type, baby_name |
| `sprout_track.log_sleep_start` | — | sleep_type, baby_name |
| `sprout_track.log_sleep_end` | — | baby_name |
| `sprout_track.log_medicine` | medicine (name) | amount, unit, baby_name |
| `sprout_track.log_bath` | — | baby_name |

> `baby_name` is optional if you only have one baby — it auto-selects.

---

## Part 2: Add Voice Commands via Ollama + Assist LLM Control

This lets you say things like *"log 4 ounce bottle"* or *"dirty diaper"* to your HA assistant. The LLM sees HA scripts as callable tools and maps natural language to the right action.

### Step 1: Add REST commands to `configuration.yaml`

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

> Replace `YOUR_DEVICE_TOKEN_HERE` with the same device token.

### Step 2: Create HA scripts

Add scripts to `scripts.yaml` that wrap the REST commands. Each script becomes a tool the LLM can call. Example:

```yaml
sprout_track_log_bottle:
  alias: Log Bottle Feeding
  description: "Log a bottle feeding for the baby. Requires amount and unit."
  fields:
    amount:
      description: "Amount of the bottle"
      required: true
    unit:
      description: "Unit: oz or ml"
      required: true
    bottle_type:
      description: "Type: formula or breast_milk"
      required: false
  mode: single
  sequence:
    - action: rest_command.sprout_track_log
      data:
        payload: >-
          {"action":"bottle","amount":"{{ amount }}","unit":"{{ unit }}","bottleType":"{{ bottle_type | default('formula') }}"}
      response_variable: api_result
    - stop: "Bottle logged"
      response_variable: api_result

sprout_track_query_status:
  alias: Get Baby Status
  description: "Get the current status of the baby including last feed, diaper, sleep, and today's totals."
  fields: {}
  mode: single
  sequence:
    - action: rest_command.sprout_track_query
      response_variable: query_result
    - stop: "Status retrieved"
      response_variable: query_result
```

See [ha-integration-guide.md](ha-integration-guide.md) for the full set of scripts (diaper, sleep, wake, bath, pump, query).

### Step 3: Expose scripts to Assist

1. Settings → Voice Assistants → **Expose** tab
2. Click **+ Expose entities**
3. Find and select all `sprout_track_*` scripts
4. Save

> Scripts MUST be exposed via the UI — they won't be visible to the LLM otherwise.

### Step 4: Configure Ollama conversation agent

1. Settings → Devices & Services → **Ollama** → Configure
2. Set the system prompt to instruct the LLM on how to handle baby-related commands
3. Enable **Assist** (LLM Control) so it can call exposed scripts as tools

See [ha-integration-guide.md](ha-integration-guide.md#step-4-configure-the-ollama-conversation-agent) for the full Ollama prompt.

### Step 5: Restart HA and test

Say: *"Log a 4 ounce bottle"* — the LLM should call the script, which calls your API, and confirm what was logged.

---

## Part 3: Open WebUI (Alternative to HA Voice)

If using Open WebUI instead of HA for voice, create a Tool in Workspace → Tools:

```python
class Tools:
    def __init__(self):
        self.base_url = "https://baby.mckinlec.com"
        self.token = "YOUR_DEVICE_TOKEN_HERE"

    async def log_baby_activity(
        self,
        action: str,
        amount: float = None,
        unit: str = None,
        type: str = None,
        side: str = None,
        sleep_type: str = None,
        bottle_type: str = None,
        medicine: str = None,
        baby_name: str = None,
    ) -> str:
        """
        Log a baby activity. Actions: bottle, breast, diaper, sleep, nap, wake, medicine, bath.
        """
        import aiohttp
        payload = {"action": action}
        if amount: payload["amount"] = amount
        if unit: payload["unit"] = unit
        if type: payload["type"] = type
        if side: payload["side"] = side
        if sleep_type: payload["sleepType"] = sleep_type
        if bottle_type: payload["bottleType"] = bottle_type
        if medicine: payload["medicine"] = medicine
        if baby_name: payload["babyName"] = baby_name

        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.base_url}/api/voice/log",
                headers={
                    "Authorization": f"Bearer {self.token}",
                    "Content-Type": "application/json",
                },
                json=payload,
            ) as resp:
                data = await resp.json()
                return data.get("message", data.get("error", "Unknown response"))
```

---

## Automation Examples

Once the integration is set up, you can create automations like:

```yaml
# Dim lights when baby sleeps
automation:
  - alias: "Dim nursery when baby sleeps"
    trigger:
      - platform: state
        entity_id: binary_sensor.sprout_track_charlotte_sleeping
        to: "on"
    action:
      - service: light.turn_on
        target:
          entity_id: light.nursery
        data:
          brightness_pct: 10

# Notify when it's been too long since last feed
  - alias: "Feed reminder"
    trigger:
      - platform: template
        value_template: >
          {{ as_timestamp(now()) - as_timestamp(state_attr('sensor.sprout_track_charlotte_last_feed', 'time')) > 14400 }}
    action:
      - service: notify.mobile_app
        data:
          message: "It's been over 4 hours since the last feed"
```

---

## Troubleshooting

- **Integration not showing up?** Make sure `custom_components/sprout_track/` folder exists with all files, then restart HA.
- **"Cannot connect" during setup?** Check that `https://baby.mckinlec.com/api/ha/status` is reachable from HA. Test with `curl` from the HA SSH terminal.
- **Sensors show "unavailable"?** Check the device token hasn't been revoked in Sprout Track Settings.
- **Voice commands not working?** Verify the `rest_command` is loaded (Developer Tools → Services → search `rest_command.sprout_track_log`).
