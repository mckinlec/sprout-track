# Sprout Track — Home Assistant Setup Guide

Everything is in the [sprout-track GitHub repo](https://github.com/mckinlec/sprout-track). The app is already deployed at `192.168.1.2:3000`.

---

## Prerequisites

- Home Assistant with SSH or Samba add-on access
- A device token from Sprout Track (Settings → Device Tokens → Create)
- [HACS](https://hacs.xyz/) installed (optional, for auto-updates)
- [Extended OpenAI Conversation](https://github.com/jekalmin/extended_openai_conversation) installed (for voice/LLM commands)

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
   - **URL**: `http://192.168.1.2:3000`
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

## Part 2: Add Voice Commands via Extended OpenAI Conversation

This lets you say things like *"log 4 ounce bottle"* or *"dirty diaper"* to your HA assistant.

### Step 1: Add rest_command to `configuration.yaml`

```yaml
rest_command:
  sprout_track_log:
    url: "http://192.168.1.2:3000/api/voice/log"
    method: POST
    headers:
      Authorization: "Bearer YOUR_DEVICE_TOKEN_HERE"
      Content-Type: "application/json"
    payload: "{{ payload }}"
    content_type: "application/json"
```

> Replace `YOUR_DEVICE_TOKEN_HERE` with the same device token.

### Step 2: Add function to Extended OpenAI Conversation

1. Settings → Voice Assistants → Edit your assistant
2. Select "Extended OpenAI Conversation" as the conversation agent
3. Go to Options → Functions
4. Add this YAML:

```yaml
- spec:
    name: log_baby_activity
    description: >-
      Log a baby activity in Sprout Track. Use this when the user mentions
      feeding, diaper changes, sleep, waking up, bath, or giving medicine.

      Actions and their fields:
        bottle: amount (number), unit (oz/ml), bottleType (formula/breast_milk)
        breast/nursing: side (left/right/both)
        diaper: type (wet/dirty/both/dry)
        sleep/nap: sleepType (nap/night) — starts a sleep session
        wake/awake: ends the current sleep session
        medicine: medicine (name of medicine), amount (number), unit
        bath: no extra fields

      Only include fields the user mentions. babyName is optional (auto-selects if one baby).
    parameters:
      type: object
      properties:
        action:
          type: string
          enum: [bottle, breast, nursing, diaper, sleep, nap, wake, awake, medicine, bath]
          description: The type of baby activity to log
        amount:
          type: number
          description: Amount (ounces for bottle, dose for medicine)
        unit:
          type: string
          description: Unit of measurement (oz, ml)
        type:
          type: string
          enum: [wet, dirty, both, dry]
          description: Diaper type
        side:
          type: string
          enum: [left, right, both]
          description: Nursing side
        sleepType:
          type: string
          enum: [nap, night]
          description: Type of sleep
        bottleType:
          type: string
          description: Bottle content type (formula, breast_milk)
        medicine:
          type: string
          description: Name of the medicine
        babyName:
          type: string
          description: Baby's first name, only if user specifies
      required:
      - action
  function:
    type: script
    sequence:
    - service: rest_command.sprout_track_log
      data:
        payload: >-
          {{ dict(
            action=action,
            amount=amount|default(None),
            unit=unit|default(None),
            type=type|default(None),
            side=side|default(None),
            sleepType=sleepType|default(None),
            bottleType=bottleType|default(None),
            medicine=medicine|default(None),
            babyName=babyName|default(None)
          ) | to_json }}
      response_variable: _function_result
```

### Step 3: Restart HA and test

Say: *"Log a 4 ounce bottle"* — the LLM should call the function, which calls your API, and confirm what was logged.

---

## Part 3: Open WebUI (Alternative to HA Voice)

If using Open WebUI instead of HA for voice, create a Tool in Workspace → Tools:

```python
class Tools:
    def __init__(self):
        self.base_url = "http://192.168.1.2:3000"
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
- **"Cannot connect" during setup?** Check that `http://192.168.1.2:3000/api/ha/status` is reachable from HA. Test with `curl` from the HA SSH terminal.
- **Sensors show "unavailable"?** Check the device token hasn't been revoked in Sprout Track Settings.
- **Voice commands not working?** Verify the `rest_command` is loaded (Developer Tools → Services → search `rest_command.sprout_track_log`).
