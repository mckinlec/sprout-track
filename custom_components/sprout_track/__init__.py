"""The Sprout Track integration."""
from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, ServiceCall, SupportsResponse

from .const import DOMAIN
from .coordinator import SproutTrackCoordinator

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list[Platform] = [Platform.SENSOR, Platform.BINARY_SENSOR]


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Sprout Track from a config entry."""
    coordinator = SproutTrackCoordinator(hass, entry)
    await coordinator.async_config_entry_first_refresh()

    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN][entry.entry_id] = coordinator

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # Register services (only once)
    if not hass.services.has_service(DOMAIN, "log_bottle"):
        _register_services(hass)

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    if unload_ok := await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
        coordinator: SproutTrackCoordinator = hass.data[DOMAIN].pop(entry.entry_id)
        await coordinator.async_shutdown()

    return unload_ok


def _get_coordinator(hass: HomeAssistant) -> SproutTrackCoordinator:
    """Get the first available coordinator."""
    coordinators = hass.data.get(DOMAIN, {})
    if not coordinators:
        raise ValueError("No Sprout Track integration configured")
    return next(iter(coordinators.values()))


def _register_services(hass: HomeAssistant) -> None:
    """Register Sprout Track services."""

    async def handle_log_bottle(call: ServiceCall) -> None:
        coordinator = _get_coordinator(hass)
        payload: dict[str, Any] = {"action": "bottle"}
        if call.data.get("amount"):
            payload["amount"] = call.data["amount"]
        if call.data.get("unit"):
            payload["unit"] = call.data["unit"]
        if call.data.get("bottle_type"):
            payload["bottleType"] = call.data["bottle_type"]
        if call.data.get("baby_name"):
            payload["babyName"] = call.data["baby_name"]
        await coordinator.async_log_activity(payload)

    async def handle_log_nursing(call: ServiceCall) -> None:
        coordinator = _get_coordinator(hass)
        payload: dict[str, Any] = {"action": "breast"}
        if call.data.get("side"):
            payload["side"] = call.data["side"]
        if call.data.get("baby_name"):
            payload["babyName"] = call.data["baby_name"]
        await coordinator.async_log_activity(payload)

    async def handle_log_diaper(call: ServiceCall) -> None:
        coordinator = _get_coordinator(hass)
        payload: dict[str, Any] = {"action": "diaper"}
        if call.data.get("type"):
            payload["type"] = call.data["type"]
        if call.data.get("baby_name"):
            payload["babyName"] = call.data["baby_name"]
        await coordinator.async_log_activity(payload)

    async def handle_log_sleep_start(call: ServiceCall) -> None:
        coordinator = _get_coordinator(hass)
        payload: dict[str, Any] = {"action": "sleep"}
        if call.data.get("sleep_type"):
            payload["sleepType"] = call.data["sleep_type"]
        if call.data.get("baby_name"):
            payload["babyName"] = call.data["baby_name"]
        await coordinator.async_log_activity(payload)

    async def handle_log_sleep_end(call: ServiceCall) -> None:
        coordinator = _get_coordinator(hass)
        payload: dict[str, Any] = {"action": "wake"}
        if call.data.get("baby_name"):
            payload["babyName"] = call.data["baby_name"]
        await coordinator.async_log_activity(payload)

    async def handle_log_medicine(call: ServiceCall) -> None:
        coordinator = _get_coordinator(hass)
        payload: dict[str, Any] = {"action": "medicine", "medicine": call.data["medicine"]}
        if call.data.get("amount"):
            payload["amount"] = call.data["amount"]
        if call.data.get("unit"):
            payload["unit"] = call.data["unit"]
        if call.data.get("baby_name"):
            payload["babyName"] = call.data["baby_name"]
        await coordinator.async_log_activity(payload)

    async def handle_log_bath(call: ServiceCall) -> None:
        coordinator = _get_coordinator(hass)
        payload: dict[str, Any] = {"action": "bath"}
        if call.data.get("baby_name"):
            payload["babyName"] = call.data["baby_name"]
        await coordinator.async_log_activity(payload)

    # Register each service
    hass.services.async_register(
        DOMAIN, "log_bottle", handle_log_bottle,
        schema=vol.Schema({
            vol.Optional("amount"): vol.Coerce(float),
            vol.Optional("unit"): str,
            vol.Optional("bottle_type"): str,
            vol.Optional("baby_name"): str,
        }),
    )

    hass.services.async_register(
        DOMAIN, "log_nursing", handle_log_nursing,
        schema=vol.Schema({
            vol.Optional("side"): vol.In(["left", "right", "both"]),
            vol.Optional("baby_name"): str,
        }),
    )

    hass.services.async_register(
        DOMAIN, "log_diaper", handle_log_diaper,
        schema=vol.Schema({
            vol.Optional("type"): vol.In(["wet", "dirty", "both", "dry"]),
            vol.Optional("baby_name"): str,
        }),
    )

    hass.services.async_register(
        DOMAIN, "log_sleep_start", handle_log_sleep_start,
        schema=vol.Schema({
            vol.Optional("sleep_type"): vol.In(["nap", "night"]),
            vol.Optional("baby_name"): str,
        }),
    )

    hass.services.async_register(
        DOMAIN, "log_sleep_end", handle_log_sleep_end,
        schema=vol.Schema({
            vol.Optional("baby_name"): str,
        }),
    )

    hass.services.async_register(
        DOMAIN, "log_medicine", handle_log_medicine,
        schema=vol.Schema({
            vol.Required("medicine"): str,
            vol.Optional("amount"): vol.Coerce(float),
            vol.Optional("unit"): str,
            vol.Optional("baby_name"): str,
        }),
    )

    hass.services.async_register(
        DOMAIN, "log_bath", handle_log_bath,
        schema=vol.Schema({
            vol.Optional("baby_name"): str,
        }),
    )
