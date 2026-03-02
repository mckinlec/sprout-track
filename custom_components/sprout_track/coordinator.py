"""Data coordinator for Sprout Track."""
from __future__ import annotations

from datetime import timedelta
import logging
from typing import Any

import aiohttp

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_URL
from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import CONF_TOKEN, DEFAULT_SCAN_INTERVAL, DOMAIN

_LOGGER = logging.getLogger(__name__)


class SproutTrackCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Coordinator to poll Sprout Track API."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        """Initialize the coordinator."""
        self.url = entry.data[CONF_URL]
        self.token = entry.data[CONF_TOKEN]
        self._session: aiohttp.ClientSession | None = None

        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=timedelta(seconds=DEFAULT_SCAN_INTERVAL),
        )

    async def _async_update_data(self) -> dict[str, Any]:
        """Fetch data from the API."""
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()

        try:
            async with self._session.get(
                f"{self.url}/api/ha/status",
                headers={"Authorization": f"Bearer {self.token}"},
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                if resp.status == 401:
                    raise UpdateFailed("Device token is invalid or revoked")
                if resp.status != 200:
                    raise UpdateFailed(f"API returned status {resp.status}")

                data = await resp.json()
                if not data.get("success"):
                    raise UpdateFailed(data.get("error", "Unknown API error"))

                return data["data"]
        except aiohttp.ClientError as err:
            raise UpdateFailed(f"Connection error: {err}") from err
        except TimeoutError as err:
            raise UpdateFailed("Connection timed out") from err

    async def async_log_activity(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Call the voice/log API to log an activity."""
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()

        async with self._session.post(
            f"{self.url}/api/voice/log",
            headers={
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=aiohttp.ClientTimeout(total=10),
        ) as resp:
            data = await resp.json()
            if not data.get("success"):
                raise UpdateFailed(data.get("error", "Failed to log activity"))

            # Refresh data after logging
            await self.async_request_refresh()
            return data

    async def async_shutdown(self) -> None:
        """Close the session."""
        if self._session and not self._session.closed:
            await self._session.close()
