"""Sensor entities for Sprout Track."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from homeassistant.components.sensor import (
    SensorEntity,
    SensorDeviceClass,
    SensorStateClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import UnitOfMass, UnitOfLength, UnitOfTemperature
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .coordinator import SproutTrackCoordinator


def _time_ago(iso_time: str | None) -> str:
    """Convert ISO timestamp to human-readable 'X ago' string."""
    if not iso_time:
        return "unknown"
    try:
        dt = datetime.fromisoformat(iso_time.replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        diff = now - dt
        minutes = int(diff.total_seconds() / 60)
        if minutes < 1:
            return "just now"
        if minutes < 60:
            return f"{minutes}m ago"
        hours = minutes // 60
        if hours < 24:
            remaining = minutes % 60
            return f"{hours}h {remaining}m ago" if remaining else f"{hours}h ago"
        days = hours // 24
        return f"{days}d ago"
    except (ValueError, TypeError):
        return "unknown"


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up Sprout Track sensors from a config entry."""
    coordinator: SproutTrackCoordinator = hass.data[DOMAIN][entry.entry_id]
    entities: list[SensorEntity] = []

    for baby in coordinator.data.get("babies", []):
        baby_name = baby["name"]
        baby_id = baby["id"]

        entities.extend([
            SproutTrackLastFeedSensor(coordinator, entry, baby_id, baby_name),
            SproutTrackLastDiaperSensor(coordinator, entry, baby_id, baby_name),
            SproutTrackFeedsTodaySensor(coordinator, entry, baby_id, baby_name),
            SproutTrackDiapersTodaySensor(coordinator, entry, baby_id, baby_name),
            SproutTrackTotalBottleOzSensor(coordinator, entry, baby_id, baby_name),
            SproutTrackLastBathSensor(coordinator, entry, baby_id, baby_name),
            SproutTrackLastMedicineSensor(coordinator, entry, baby_id, baby_name),
            SproutTrackLastNoteSensor(coordinator, entry, baby_id, baby_name),
            SproutTrackLastPumpSensor(coordinator, entry, baby_id, baby_name),
            SproutTrackLastPlaySensor(coordinator, entry, baby_id, baby_name),
            SproutTrackMoodSensor(coordinator, entry, baby_id, baby_name),
            SproutTrackWeightSensor(coordinator, entry, baby_id, baby_name),
            SproutTrackHeightSensor(coordinator, entry, baby_id, baby_name),
            SproutTrackTemperatureSensor(coordinator, entry, baby_id, baby_name),
            SproutTrackHeadCircSensor(coordinator, entry, baby_id, baby_name),
            SproutTrackLastSleepSensor(coordinator, entry, baby_id, baby_name),
        ])

    async_add_entities(entities)


class SproutTrackBaseSensor(CoordinatorEntity[SproutTrackCoordinator], SensorEntity):
    """Base class for Sprout Track sensors."""

    _attr_has_entity_name = True

    def __init__(
        self,
        coordinator: SproutTrackCoordinator,
        entry: ConfigEntry,
        baby_id: str,
        baby_name: str,
        key: str,
    ) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator)
        self._baby_id = baby_id
        self._baby_name = baby_name
        self._attr_unique_id = f"{entry.entry_id}_{baby_id}_{key}"
        self._attr_device_info = {
            "identifiers": {(DOMAIN, f"{entry.entry_id}_{baby_id}")},
            "name": baby_name,
            "manufacturer": "Sprout Track",
            "model": "Baby Tracker",
            "entry_type": None,
        }

    def _get_baby_data(self) -> dict[str, Any] | None:
        """Get data for this baby from coordinator."""
        for baby in self.coordinator.data.get("babies", []):
            if baby["id"] == self._baby_id:
                return baby
        return None


# --- Feed sensors ---

class SproutTrackLastFeedSensor(SproutTrackBaseSensor):
    """Last feed sensor."""

    _attr_translation_key = "last_feed"
    _attr_icon = "mdi:baby-bottle-outline"

    def __init__(self, coordinator, entry, baby_id, baby_name):
        super().__init__(coordinator, entry, baby_id, baby_name, "last_feed")

    @property
    def native_value(self) -> str | None:
        baby = self._get_baby_data()
        if not baby or not baby.get("lastFeed"):
            return None
        return _time_ago(baby["lastFeed"]["time"])

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        baby = self._get_baby_data()
        if not baby or not baby.get("lastFeed"):
            return {}
        feed = baby["lastFeed"]
        return {
            "type": feed.get("type"),
            "amount": feed.get("amount"),
            "unit": feed.get("unit"),
            "side": feed.get("side"),
            "bottle_type": feed.get("bottleType"),
            "time": feed.get("time"),
        }


class SproutTrackFeedsTodaySensor(SproutTrackBaseSensor):
    """Feeds today count sensor."""

    _attr_translation_key = "feeds_today"
    _attr_icon = "mdi:counter"
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(self, coordinator, entry, baby_id, baby_name):
        super().__init__(coordinator, entry, baby_id, baby_name, "feeds_today")

    @property
    def native_value(self) -> int | None:
        baby = self._get_baby_data()
        if not baby:
            return None
        return baby.get("todayStats", {}).get("feedCount", 0)


class SproutTrackTotalBottleOzSensor(SproutTrackBaseSensor):
    """Total bottle oz today sensor."""

    _attr_translation_key = "total_bottle_oz"
    _attr_icon = "mdi:cup-water"
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_native_unit_of_measurement = "oz"

    def __init__(self, coordinator, entry, baby_id, baby_name):
        super().__init__(coordinator, entry, baby_id, baby_name, "total_bottle_oz")

    @property
    def native_value(self) -> float | None:
        baby = self._get_baby_data()
        if not baby:
            return None
        return baby.get("todayStats", {}).get("totalBottleOz", 0)


# --- Diaper sensors ---

class SproutTrackLastDiaperSensor(SproutTrackBaseSensor):
    """Last diaper change sensor."""

    _attr_translation_key = "last_diaper"
    _attr_icon = "mdi:emoticon-poop"

    def __init__(self, coordinator, entry, baby_id, baby_name):
        super().__init__(coordinator, entry, baby_id, baby_name, "last_diaper")

    @property
    def native_value(self) -> str | None:
        baby = self._get_baby_data()
        if not baby or not baby.get("lastDiaper"):
            return None
        return _time_ago(baby["lastDiaper"]["time"])

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        baby = self._get_baby_data()
        if not baby or not baby.get("lastDiaper"):
            return {}
        diaper = baby["lastDiaper"]
        return {
            "type": diaper.get("type"),
            "time": diaper.get("time"),
        }


class SproutTrackDiapersTodaySensor(SproutTrackBaseSensor):
    """Diapers today count sensor."""

    _attr_translation_key = "diapers_today"
    _attr_icon = "mdi:counter"
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(self, coordinator, entry, baby_id, baby_name):
        super().__init__(coordinator, entry, baby_id, baby_name, "diapers_today")

    @property
    def native_value(self) -> int | None:
        baby = self._get_baby_data()
        if not baby:
            return None
        return baby.get("todayStats", {}).get("diaperCount", 0)


# --- Sleep sensor ---

class SproutTrackLastSleepSensor(SproutTrackBaseSensor):
    """Last sleep / current sleep status sensor."""

    _attr_translation_key = "last_feed"  # we override name manually
    _attr_icon = "mdi:sleep"

    def __init__(self, coordinator, entry, baby_id, baby_name):
        super().__init__(coordinator, entry, baby_id, baby_name, "sleep_status")
        self._attr_name = "Sleep"

    @property
    def native_value(self) -> str | None:
        baby = self._get_baby_data()
        if not baby:
            return None
        sleep = baby.get("sleep", {})
        if sleep.get("sleeping"):
            mins = sleep.get("durationMinutes", 0)
            hours = mins // 60
            remaining = mins % 60
            duration = f"{hours}h {remaining}m" if hours else f"{remaining}m"
            sleep_type = "Napping" if sleep.get("type") == "NAP" else "Sleeping"
            return f"{sleep_type} ({duration})"
        return "Awake"

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        baby = self._get_baby_data()
        if not baby:
            return {}
        sleep = baby.get("sleep", {})
        attrs = {
            "sleeping": sleep.get("sleeping", False),
            "type": sleep.get("type"),
            "start_time": sleep.get("startTime"),
            "duration_minutes": sleep.get("durationMinutes"),
        }
        if sleep.get("lastCompleted"):
            lc = sleep["lastCompleted"]
            attrs["last_sleep_start"] = lc.get("startTime")
            attrs["last_sleep_end"] = lc.get("endTime")
            attrs["last_sleep_duration"] = lc.get("durationMinutes")
            attrs["last_sleep_type"] = lc.get("type")
        return attrs


# --- Bath sensor ---

class SproutTrackLastBathSensor(SproutTrackBaseSensor):
    """Last bath sensor."""

    _attr_translation_key = "last_bath"
    _attr_icon = "mdi:bathtub-outline"

    def __init__(self, coordinator, entry, baby_id, baby_name):
        super().__init__(coordinator, entry, baby_id, baby_name, "last_bath")

    @property
    def native_value(self) -> str | None:
        baby = self._get_baby_data()
        if not baby or not baby.get("lastBath"):
            return None
        return _time_ago(baby["lastBath"]["time"])

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        baby = self._get_baby_data()
        if not baby or not baby.get("lastBath"):
            return {}
        return {"time": baby["lastBath"]["time"]}


# --- Medicine sensor ---

class SproutTrackLastMedicineSensor(SproutTrackBaseSensor):
    """Last medicine sensor."""

    _attr_translation_key = "last_medicine"
    _attr_icon = "mdi:pill"

    def __init__(self, coordinator, entry, baby_id, baby_name):
        super().__init__(coordinator, entry, baby_id, baby_name, "last_medicine")

    @property
    def native_value(self) -> str | None:
        baby = self._get_baby_data()
        if not baby or not baby.get("lastMedicine"):
            return None
        med = baby["lastMedicine"]
        return f"{med['name']} {_time_ago(med['time'])}"

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        baby = self._get_baby_data()
        if not baby or not baby.get("lastMedicine"):
            return {}
        med = baby["lastMedicine"]
        return {
            "name": med.get("name"),
            "amount": med.get("amount"),
            "unit": med.get("unit"),
            "time": med.get("time"),
        }


# --- Note sensor ---

class SproutTrackLastNoteSensor(SproutTrackBaseSensor):
    """Last note sensor."""

    _attr_translation_key = "last_note"
    _attr_icon = "mdi:note-text-outline"

    def __init__(self, coordinator, entry, baby_id, baby_name):
        super().__init__(coordinator, entry, baby_id, baby_name, "last_note")

    @property
    def native_value(self) -> str | None:
        baby = self._get_baby_data()
        if not baby or not baby.get("lastNote"):
            return None
        note = baby["lastNote"]
        content = note.get("content", "")
        # Truncate for state value (HA has 255 char limit)
        return content[:250] if content else _time_ago(note["time"])

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        baby = self._get_baby_data()
        if not baby or not baby.get("lastNote"):
            return {}
        note = baby["lastNote"]
        return {
            "content": note.get("content"),
            "time": note.get("time"),
        }


# --- Pump sensor ---

class SproutTrackLastPumpSensor(SproutTrackBaseSensor):
    """Last pump session sensor."""

    _attr_translation_key = "last_pump"
    _attr_icon = "mdi:water-pump"

    def __init__(self, coordinator, entry, baby_id, baby_name):
        super().__init__(coordinator, entry, baby_id, baby_name, "last_pump")

    @property
    def native_value(self) -> str | None:
        baby = self._get_baby_data()
        if not baby or not baby.get("lastPump"):
            return None
        return _time_ago(baby["lastPump"]["time"])

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        baby = self._get_baby_data()
        if not baby or not baby.get("lastPump"):
            return {}
        pump = baby["lastPump"]
        return {
            "amount": pump.get("amount"),
            "unit": pump.get("unit"),
            "side": pump.get("side"),
            "duration_minutes": pump.get("durationMinutes"),
            "time": pump.get("time"),
        }


# --- Play sensor ---

class SproutTrackLastPlaySensor(SproutTrackBaseSensor):
    """Last play session sensor."""

    _attr_translation_key = "last_play"
    _attr_icon = "mdi:puzzle-outline"

    def __init__(self, coordinator, entry, baby_id, baby_name):
        super().__init__(coordinator, entry, baby_id, baby_name, "last_play")

    @property
    def native_value(self) -> str | None:
        baby = self._get_baby_data()
        if not baby or not baby.get("lastPlay"):
            return None
        play = baby["lastPlay"]
        play_type = (play.get("type") or "play").replace("_", " ").title()
        return f"{play_type} {_time_ago(play['startTime'])}"

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        baby = self._get_baby_data()
        if not baby or not baby.get("lastPlay"):
            return {}
        play = baby["lastPlay"]
        return {
            "type": play.get("type"),
            "start_time": play.get("startTime"),
            "end_time": play.get("endTime"),
            "duration_minutes": play.get("durationMinutes"),
            "milestone": play.get("milestone"),
        }


# --- Mood sensor ---

class SproutTrackMoodSensor(SproutTrackBaseSensor):
    """Current mood sensor."""

    _attr_translation_key = "mood"
    _attr_icon = "mdi:emoticon-outline"

    def __init__(self, coordinator, entry, baby_id, baby_name):
        super().__init__(coordinator, entry, baby_id, baby_name, "mood")

    @property
    def native_value(self) -> str | None:
        baby = self._get_baby_data()
        if not baby or not baby.get("lastMood"):
            return None
        return baby["lastMood"]["mood"].title()

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        baby = self._get_baby_data()
        if not baby or not baby.get("lastMood"):
            return {}
        return {"time": baby["lastMood"]["time"]}

    @property
    def icon(self) -> str:
        baby = self._get_baby_data()
        if baby and baby.get("lastMood"):
            mood = baby["lastMood"]["mood"]
            mood_icons = {
                "HAPPY": "mdi:emoticon-happy-outline",
                "CALM": "mdi:emoticon-neutral-outline",
                "FUSSY": "mdi:emoticon-sad-outline",
                "CRYING": "mdi:emoticon-cry-outline",
            }
            return mood_icons.get(mood, "mdi:emoticon-outline")
        return "mdi:emoticon-outline"


# --- Measurement sensors ---

class SproutTrackWeightSensor(SproutTrackBaseSensor):
    """Weight sensor."""

    _attr_translation_key = "weight"
    _attr_icon = "mdi:scale-bathroom"
    _attr_device_class = SensorDeviceClass.WEIGHT
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(self, coordinator, entry, baby_id, baby_name):
        super().__init__(coordinator, entry, baby_id, baby_name, "weight")

    @property
    def native_value(self) -> float | None:
        baby = self._get_baby_data()
        if not baby:
            return None
        weight = baby.get("measurements", {}).get("weight")
        return weight["value"] if weight else None

    @property
    def native_unit_of_measurement(self) -> str | None:
        baby = self._get_baby_data()
        if not baby:
            return None
        weight = baby.get("measurements", {}).get("weight")
        if weight:
            unit = weight.get("unit", "").lower()
            if unit in ("lb", "lbs"):
                return UnitOfMass.POUNDS
            if unit == "kg":
                return UnitOfMass.KILOGRAMS
            return unit
        return None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        baby = self._get_baby_data()
        if not baby:
            return {}
        weight = baby.get("measurements", {}).get("weight")
        return {"date": weight["date"]} if weight else {}


class SproutTrackHeightSensor(SproutTrackBaseSensor):
    """Height sensor."""

    _attr_translation_key = "height"
    _attr_icon = "mdi:human-male-height"
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(self, coordinator, entry, baby_id, baby_name):
        super().__init__(coordinator, entry, baby_id, baby_name, "height")

    @property
    def native_value(self) -> float | None:
        baby = self._get_baby_data()
        if not baby:
            return None
        height = baby.get("measurements", {}).get("height")
        return height["value"] if height else None

    @property
    def native_unit_of_measurement(self) -> str | None:
        baby = self._get_baby_data()
        if not baby:
            return None
        height = baby.get("measurements", {}).get("height")
        return height.get("unit") if height else None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        baby = self._get_baby_data()
        if not baby:
            return {}
        height = baby.get("measurements", {}).get("height")
        return {"date": height["date"]} if height else {}


class SproutTrackTemperatureSensor(SproutTrackBaseSensor):
    """Temperature sensor."""

    _attr_translation_key = "temperature"
    _attr_icon = "mdi:thermometer"
    _attr_device_class = SensorDeviceClass.TEMPERATURE
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(self, coordinator, entry, baby_id, baby_name):
        super().__init__(coordinator, entry, baby_id, baby_name, "temperature")

    @property
    def native_value(self) -> float | None:
        baby = self._get_baby_data()
        if not baby:
            return None
        temp = baby.get("measurements", {}).get("temperature")
        return temp["value"] if temp else None

    @property
    def native_unit_of_measurement(self) -> str | None:
        baby = self._get_baby_data()
        if not baby:
            return None
        temp = baby.get("measurements", {}).get("temperature")
        if temp:
            unit = temp.get("unit", "").upper()
            if unit == "F":
                return UnitOfTemperature.FAHRENHEIT
            if unit == "C":
                return UnitOfTemperature.CELSIUS
            return unit
        return None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        baby = self._get_baby_data()
        if not baby:
            return {}
        temp = baby.get("measurements", {}).get("temperature")
        return {"date": temp["date"]} if temp else {}


class SproutTrackHeadCircSensor(SproutTrackBaseSensor):
    """Head circumference sensor."""

    _attr_translation_key = "head_circumference"
    _attr_icon = "mdi:head-outline"
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(self, coordinator, entry, baby_id, baby_name):
        super().__init__(coordinator, entry, baby_id, baby_name, "head_circumference")

    @property
    def native_value(self) -> float | None:
        baby = self._get_baby_data()
        if not baby:
            return None
        hc = baby.get("measurements", {}).get("headCircumference")
        return hc["value"] if hc else None

    @property
    def native_unit_of_measurement(self) -> str | None:
        baby = self._get_baby_data()
        if not baby:
            return None
        hc = baby.get("measurements", {}).get("headCircumference")
        return hc.get("unit") if hc else None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        baby = self._get_baby_data()
        if not baby:
            return {}
        hc = baby.get("measurements", {}).get("headCircumference")
        return {"date": hc["date"]} if hc else {}
