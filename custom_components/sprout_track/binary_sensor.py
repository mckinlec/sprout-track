"""Binary sensor entities for Sprout Track."""
from __future__ import annotations

from typing import Any

from homeassistant.components.binary_sensor import (
    BinarySensorDeviceClass,
    BinarySensorEntity,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .coordinator import SproutTrackCoordinator


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up Sprout Track binary sensors from a config entry."""
    coordinator: SproutTrackCoordinator = hass.data[DOMAIN][entry.entry_id]
    entities: list[BinarySensorEntity] = []

    for baby in coordinator.data.get("babies", []):
        entities.append(
            SproutTrackSleepingSensor(coordinator, entry, baby["id"], baby["name"])
        )

    async_add_entities(entities)


class SproutTrackSleepingSensor(CoordinatorEntity[SproutTrackCoordinator], BinarySensorEntity):
    """Binary sensor indicating if baby is sleeping."""

    _attr_has_entity_name = True
    _attr_translation_key = "sleeping"
    _attr_icon = "mdi:sleep"

    def __init__(
        self,
        coordinator: SproutTrackCoordinator,
        entry: ConfigEntry,
        baby_id: str,
        baby_name: str,
    ) -> None:
        """Initialize the binary sensor."""
        super().__init__(coordinator)
        self._baby_id = baby_id
        self._attr_unique_id = f"{entry.entry_id}_{baby_id}_sleeping"
        self._attr_device_info = {
            "identifiers": {(DOMAIN, f"{entry.entry_id}_{baby_id}")},
            "name": baby_name,
            "manufacturer": "Sprout Track",
            "model": "Baby Tracker",
        }

    def _get_baby_data(self) -> dict[str, Any] | None:
        for baby in self.coordinator.data.get("babies", []):
            if baby["id"] == self._baby_id:
                return baby
        return None

    @property
    def is_on(self) -> bool | None:
        baby = self._get_baby_data()
        if not baby:
            return None
        return baby.get("sleep", {}).get("sleeping", False)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        baby = self._get_baby_data()
        if not baby:
            return {}
        sleep = baby.get("sleep", {})
        attrs: dict[str, Any] = {}
        if sleep.get("sleeping"):
            attrs["type"] = sleep.get("type")
            attrs["start_time"] = sleep.get("startTime")
            mins = sleep.get("durationMinutes", 0)
            if mins:
                hours = mins // 60
                remaining = mins % 60
                attrs["duration"] = f"{hours}h {remaining}m" if hours else f"{remaining}m"
        return attrs
