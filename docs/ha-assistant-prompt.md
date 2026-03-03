# Sprout-Track × Home Assistant Setup

Integration with [Extended OpenAI Conversation](https://github.com/jekalmin/extended_openai_conversation) — paste the configs below into your HA setup.

---

## 1. Add REST Commands (`configuration.yaml`)

```yaml
rest_command:
  sprout_track_log:
    url: "https://baby.mckinlec.com/api/voice/log"
    method: POST
    headers:
      Authorization: "Bearer YOUR_DEVICE_TOKEN_HERE"
      Content-Type: "application/json"
    payload: "{{ payload }}"
    content_type: "application/json"
```

> Replace `YOUR_DEVICE_TOKEN_HERE` with a device token from sprout-track Settings → Device Tokens.

---

## 2. Add Function to Extended OpenAI Conversation

Go to **Settings → Voice Assistants → Edit Assistant → Options → Functions** and paste:

```yaml
- spec:
    name: log_baby_activity
    description: >-
      Log a baby activity in Sprout Track. Use this when the user mentions
      feeding, diaper changes, sleep, waking up, or giving medicine.

      Actions and their fields:
        bottle: amount (number), unit (oz/ml), bottleType (formula/breast_milk)
        breast/nursing: side (left/right/both)
        diaper: type (wet/dirty/both/dry)
        sleep/nap: sleepType (nap/night) — starts a sleep session
        wake/awake: ends the current sleep session
        medicine: medicine (name of medicine), amount (number), unit

      Only include fields the user mentions. babyName is optional (auto-selects if one baby).
    parameters:
      type: object
      properties:
        action:
          type: string
          enum: [bottle, breast, nursing, diaper, sleep, nap, wake, awake, medicine]
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

---

## 3. That's It

After restarting HA, you can say things like:
- *"Log a bottle, 4 ounces"*
- *"Dirty diaper"*
- *"Baby is napping"*
- *"Baby woke up"*
- *"Gave Tylenol"*

The LLM figures out the action + fields and calls your sprout-track API. The response message gets read back as confirmation.
