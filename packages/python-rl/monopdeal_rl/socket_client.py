"""Socket.IO client wrapper for the MonopDeal game server."""

from __future__ import annotations

import logging
import threading
from typing import Any

import socketio

logger = logging.getLogger(__name__)


class GameSocketClient:
    """Thin synchronous wrapper around the async Socket.IO protocol.

    Stores the latest ``game:state`` and ``game:hand`` payloads and exposes a
    version-based blocking mechanism so callers can wait for *new* state
    without race conditions.
    """

    def __init__(self) -> None:
        self.sio = socketio.Client(logger=False, engineio_logger=False)
        self.sid: str | None = None

        self.game_state: dict[str, Any] | None = None
        self.hand: list[dict[str, Any]] = []
        self.room_id: str | None = None
        self.game_over = False

        self._state_version = 0
        self._state_cond = threading.Condition()
        self._room_created_event = threading.Event()
        self._error: str | None = None

        self._register_handlers()

    # ------------------------------------------------------------------
    # Internal event handlers
    # ------------------------------------------------------------------

    def _register_handlers(self) -> None:
        sio = self.sio

        @sio.event
        def connect() -> None:
            self.sid = sio.get_sid("/") or sio.sid
            logger.debug("Connected: sid=%s", self.sid)

        @sio.event
        def disconnect() -> None:
            logger.debug("Disconnected")

        @sio.on("room:created")
        def on_room_created(data: dict) -> None:
            self.room_id = data.get("id")
            host_id = data.get("hostId")
            if host_id:
                self.sid = host_id
            self._room_created_event.set()

        @sio.on("game:state")
        def on_game_state(data: dict) -> None:
            with self._state_cond:
                self.game_state = data
                if data.get("phase") == "finished":
                    self.game_over = True
                self._state_version += 1
                self._state_cond.notify_all()

        @sio.on("game:hand")
        def on_game_hand(data: list) -> None:
            with self._state_cond:
                self.hand = data
                self._state_version += 1
                self._state_cond.notify_all()

        @sio.on("error")
        def on_error(msg: str) -> None:
            self._error = msg
            logger.debug("Server error: %s", msg)
            with self._state_cond:
                self._state_version += 1
                self._state_cond.notify_all()

        @sio.on("game:notification")
        def on_notification(_msg: str) -> None:
            pass

        @sio.on("room:updated")
        def on_room_updated(_data: dict) -> None:
            pass

    # ------------------------------------------------------------------
    # Connection
    # ------------------------------------------------------------------

    def connect(self, url: str, timeout: float = 5.0) -> None:
        self.sio.connect(url, transports=["websocket", "polling"], wait_timeout=timeout)
        self.sid = self.sio.get_sid("/") or self.sio.sid

    def disconnect(self) -> None:
        if self.sio.connected:
            self.sio.disconnect()
        self._reset_state()

    def _reset_state(self) -> None:
        self.game_state = None
        self.hand = []
        self.room_id = None
        self.game_over = False
        self._error = None
        with self._state_cond:
            self._state_version = 0
        self._room_created_event.clear()

    # ------------------------------------------------------------------
    # Room management
    # ------------------------------------------------------------------

    def create_ai_room(
        self,
        bot_count: int = 1,
        difficulty: str = "medium",
        fast: bool = True,
        player_name: str = "RL-Agent",
        room_name: str = "training",
        timeout: float = 10.0,
    ) -> str:
        """Create a room with AI bots and auto-start the game.

        Returns the room ID.
        """
        self._room_created_event.clear()
        self.sio.emit("room:create-ai", {
            "playerName": player_name,
            "roomName": room_name,
            "botCount": bot_count,
            "difficulty": difficulty,
            "fast": fast,
        })
        if not self._room_created_event.wait(timeout=timeout):
            raise TimeoutError("Timed out waiting for room creation")
        assert self.room_id is not None
        return self.room_id

    # ------------------------------------------------------------------
    # Game action emissions
    # ------------------------------------------------------------------

    def emit_draw(self) -> None:
        self.sio.emit("game:draw")

    def emit_play_card(self, card_id: str, **opts: Any) -> None:
        data: dict[str, Any] = {"cardId": card_id}
        if opts.get("as_money"):
            data["asMoney"] = True
        if opts.get("color"):
            data["color"] = opts["color"]
        if opts.get("target_player_id"):
            data["targetPlayerId"] = opts["target_player_id"]
        if opts.get("target_card_id"):
            data["targetCardId"] = opts["target_card_id"]
        if opts.get("offered_card_id"):
            data["offeredCardId"] = opts["offered_card_id"]
        if opts.get("target_set_color"):
            data["targetSetColor"] = opts["target_set_color"]
        if opts.get("double_the_rent_card_ids"):
            data["doubleTheRentCardIds"] = opts["double_the_rent_card_ids"]
        self.sio.emit("game:play-card", data)

    def emit_end_turn(self) -> None:
        self.sio.emit("game:end-turn")

    def emit_respond(self, accept: bool, payment_card_ids: list[str] | None = None) -> None:
        data: dict[str, Any] = {"accept": accept}
        if accept and payment_card_ids:
            data["paymentCardIds"] = payment_card_ids
        self.sio.emit("game:respond", data)

    def emit_discard(self, card_ids: list[str]) -> None:
        self.sio.emit("game:discard", {"cardIds": card_ids})

    # ------------------------------------------------------------------
    # Synchronisation helpers
    # ------------------------------------------------------------------

    @property
    def state_version(self) -> int:
        """Current version counter (incremented on every state/hand/error event)."""
        return self._state_version

    def wait_for_version(self, min_version: int, timeout: float = 30.0) -> dict[str, Any] | None:
        """Block until ``_state_version >= min_version``."""
        with self._state_cond:
            if not self._state_cond.wait_for(
                lambda: self._state_version >= min_version, timeout=timeout,
            ):
                raise TimeoutError("Timed out waiting for game state")
        return self.game_state

    def wait_for_new_state(self, timeout: float = 30.0) -> dict[str, Any] | None:
        """Block until a *new* ``game:state`` or ``game:hand`` event arrives.

        Uses a version counter so we never miss events that arrive between
        calls (the old clear/wait pattern was racy).
        """
        with self._state_cond:
            current = self._state_version
            if not self._state_cond.wait_for(
                lambda: self._state_version > current, timeout=timeout,
            ):
                raise TimeoutError("Timed out waiting for game state")
        return self.game_state

    def consume_error(self) -> str | None:
        err = self._error
        self._error = None
        return err

    @property
    def my_id(self) -> str:
        assert self.sid is not None, "Not connected"
        return self.sid

    def is_my_turn(self) -> bool:
        if self.game_state is None:
            return False
        players = self.game_state.get("players", [])
        idx = self.game_state.get("currentPlayerIndex", -1)
        if 0 <= idx < len(players):
            return players[idx].get("id") == self.my_id
        return False

    def is_pending_for_me(self) -> bool:
        if self.game_state is None:
            return False
        pa = self.game_state.get("pendingAction")
        if pa is None:
            return False
        if pa.get("jsnChain", {}).get("awaitingCounterFrom") == self.my_id:
            return True
        targets = pa.get("targetPlayerIds", [])
        responded = pa.get("respondedPlayerIds", [])
        return self.my_id in targets and self.my_id not in responded
