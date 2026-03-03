# Handoff: Sprout Track ↔ Home Assistant Integration

## Current State

The HA integration is **installed but not working** — there's an auth bug to fix.

### What's Done
- ✅ `POST /api/voice/log` — voice logging API (bottle, diaper, sleep, wake, medicine, bath) — **working, deployed**
- ✅ `GET /api/ha/status` — returns all baby sensor data — **deployed but returning 401**
- ✅ `custom_components/sprout_track/` — full HA integration (sensors, binary sensors, services) — **installed on HA at 192.168.1.22**
- ✅ `rest_command` added to HA `configuration.yaml`
- ✅ HA restarted

### What's Broken
**The `GET /api/ha/status` endpoint returns 401 for a valid device token.**

Tested with:
```
# Both return 401:
Invoke-RestMethod -Uri "https://baby.mckinlec.com/api/ha/status" -Headers @{Authorization="Bearer TOKEN"}
Invoke-RestMethod -Uri "http://192.168.1.2:3000/api/ha/status" -Headers @{Authorization="Bearer TOKEN"}
```

The device token used: `4768640bfea6e50bcd7107cf31e6d0050e8fc48d26a869f14d`

### What to Debug

The auth logic in [route.ts](file:///c:/coding/sprout-track/app/api/ha/status/route.ts) calls `validateDeviceToken()` from [auth.ts](file:///c:/coding/sprout-track/app/api/utils/auth.ts#L724-L771). This function:
1. Looks up the token in the `DeviceToken` table via `prisma.deviceToken.findUnique({ where: { token } })`
2. Checks `revokedAt` is null
3. Checks `expiresAt` hasn't passed

Likely causes:
- The token doesn't exist in the DB (user may have created it in a different environment)
- The token column might not be indexed/unique properly
- The `POST /api/voice/log` endpoint uses the **same** `validateDeviceToken()` — test if voice/log also returns 401 with this token to narrow it down

**Quick test to run:**
```powershell
# Test voice/log with the same token:
Invoke-RestMethod -Uri "http://192.168.1.2:3000/api/voice/log" -Method POST `
  -Headers @{Authorization="Bearer 4768640bfea6e50bcd7107cf31e6d0050e8fc48d26a869f14d"; "Content-Type"="application/json"} `
  -Body '{"action":"bottle","amount":1,"unit":"oz"}'
```
If this **also** fails → token issue (check DB). If this **works** → something specific to the GET endpoint.

---

## Access Info

| System | Address | Auth |
|--------|---------|------|
| Sprout Track app | `https://baby.mckinlec.com` or `http://192.168.1.2:3000` | Device tokens from Settings |
| Sprout Track server | `ssh mckinlec@192.168.1.2` | `8@0t2PtF^yTi82` |
| Home Assistant | `ssh root@192.168.1.22` (port 22) | `ry4@ifX#z@!dQl` |
| Docker container | `docker exec -it sprout-track sh` (on 192.168.1.2) | — |
| DB | SQLite at `/db/baby-tracker.db` inside the container | — |

> ⚠️ All passwords above are temporary.

---

## Key Files

### Sprout Track (Node.js / Next.js)
| File | Purpose |
|------|---------|
| [app/api/ha/status/route.ts](file:///c:/coding/sprout-track/app/api/ha/status/route.ts) | `GET` — returns all baby sensor data (the broken endpoint) |
| [app/api/voice/log/route.ts](file:///c:/coding/sprout-track/app/api/voice/log/route.ts) | `POST` — logs activities (working) |
| [app/api/utils/auth.ts](file:///c:/coding/sprout-track/app/api/utils/auth.ts) | `validateDeviceToken()` at line 724 |
| [prisma/schema.prisma](file:///c:/coding/sprout-track/prisma/schema.prisma) | DB schema — `DeviceToken` model, all log models |

### HA Integration (Python, on HA at /config/custom_components/sprout_track/)
| File | Purpose |
|------|---------|
| `__init__.py` | Entry point, registers 7 services (log_bottle, log_diaper, etc.) |
| `config_flow.py` | UI setup — validates by calling `GET /api/ha/status` |
| `coordinator.py` | Polls `/api/ha/status` every 60s |
| `sensor.py` | 16 sensor entities per baby |
| `binary_sensor.py` | Sleep on/off binary sensor per baby |
| `services.yaml` | Service definitions with field selectors |

### Docs
| File | Purpose |
|------|---------|
| [docs/ha-setup-guide.md](file:///c:/coding/sprout-track/docs/ha-setup-guide.md) | Full setup guide (sensors, voice, automations) |
| [docs/ha-assistant-prompt.md](file:///c:/coding/sprout-track/docs/ha-assistant-prompt.md) | Extended OpenAI Conversation config (rest_command + function spec) |

---

## Deploy Workflow

```powershell
# Build & deploy sprout-track changes:
docker build -t cmckinle/sprout-track:latest .
docker push cmckinle/sprout-track:latest
ssh mckinlec@192.168.1.2  # password: see above
  docker pull cmckinle/sprout-track:latest
  docker stop sprout-track; docker rm sprout-track
  docker run -d --name sprout-track --restart unless-stopped -p 3000:3000 -v sprout-track-db:/db -v sprout-track-env:/app/env -e NODE_ENV=production cmckinle/sprout-track:latest

# Update HA integration files:
scp custom_components/sprout_track/* root@192.168.1.22:/config/custom_components/sprout_track/
ssh root@192.168.1.22 "ha core restart"
```

---

## Once Auth is Fixed

1. Go to HA → **Settings → Devices & Services → Add Integration → "Sprout Track"**
2. Enter URL: `https://baby.mckinlec.com`, Device Token: a valid token
3. Sensors appear per baby — verify in Developer Tools → States
4. Replace `DEVICE_TOKEN_PLACEHOLDER` in `/config/configuration.yaml` on HA with the real token, restart HA
5. Set up Extended OpenAI Conversation for voice commands (see [ha-setup-guide.md](file:///c:/coding/sprout-track/docs/ha-setup-guide.md))
