"""LLM client adapter — routes to direct Anthropic SDK or Emergent, based on env.

This lets Begin work in two modes without changing every caller in `server.py`:

* If ANTHROPIC_API_KEY is set → talks directly to Anthropic using the official
  `anthropic` async SDK. This is the mode you want post-migration.
* Otherwise → falls back to the Emergent-managed LLM key + `emergentintegrations`,
  which is what currently powers the preview.

Every consumer imports the same names — `LlmChat`, `UserMessage`, `TextDelta`,
`StreamDone` — and doesn't care which backend serves the request.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import AsyncIterator, Optional, List, Any

# ---------- Public event types (mirror emergentintegrations for drop-in use) ----------


@dataclass
class UserMessage:
    text: str
    # `emergentintegrations` reads this attribute on every send; keep the field
    # so the fallback path doesn't AttributeError. `None` == no file attachments.
    file_contents: Optional[List[Any]] = None


@dataclass(frozen=True)
class TextDelta:
    content: str


@dataclass(frozen=True)
class StreamDone:
    pass


# ---------- Direct Anthropic implementation ----------


class _AnthropicChat:
    """Streams from Anthropic's messages API using the official async SDK.

    The public shape intentionally matches emergentintegrations' `LlmChat` so
    the rest of `server.py` doesn't need to know which backend is active.
    """

    def __init__(self, api_key: str, session_id: str, system_message: str):
        # Import here so the SDK is only required when this mode is active.
        from anthropic import AsyncAnthropic  # type: ignore

        self._client = AsyncAnthropic(api_key=api_key)
        self._session_id = session_id  # kept for parity; Anthropic is stateless per call
        self._system_message = system_message
        # Callers set via .with_model(provider, model); we ignore `provider` and
        # translate the model string when needed.
        self._model = "claude-sonnet-5"
        self._max_tokens = int(os.environ.get("ANTHROPIC_MAX_TOKENS", "4096"))

    def with_model(self, _provider: str, model: str) -> "_AnthropicChat":
        # Callers pass "anthropic/claude-sonnet-5"; Anthropic wants just "claude-sonnet-5".
        cleaned = model.split("/", 1)[-1] if "/" in model else model
        self._model = cleaned or self._model
        return self

    async def stream_message(self, message: UserMessage) -> AsyncIterator[object]:
        async with self._client.messages.stream(
            model=self._model,
            max_tokens=self._max_tokens,
            system=self._system_message,
            messages=[{"role": "user", "content": message.text}],
        ) as stream:
            async for chunk in stream.text_stream:
                if chunk:
                    yield TextDelta(chunk)
        yield StreamDone()


# ---------- Emergent-managed fallback ----------


def _make_emergent_chat(api_key: str, session_id: str, system_message: str):
    """Return an emergentintegrations LlmChat instance (current preview path)."""
    from emergentintegrations.llm.chat import LlmChat as _EmergentLlmChat  # type: ignore

    return _EmergentLlmChat(
        api_key=api_key,
        session_id=session_id,
        system_message=system_message,
    )


# ---------- Public factory ----------


def LlmChat(*, api_key: str, session_id: str, system_message: str):
    """Return a chat instance that supports .with_model(...).stream_message(...).

    Selection rules:
      1. If `ANTHROPIC_API_KEY` env var is set → direct Anthropic (post-migration).
      2. Else if the caller passed a non-empty `api_key` (typically EMERGENT_LLM_KEY)
         → emergentintegrations (preview behavior).
      3. Else → raise a clear ValueError so the caller gets an actionable error.
    """
    direct_key: Optional[str] = os.environ.get("ANTHROPIC_API_KEY")
    if direct_key:
        return _AnthropicChat(direct_key, session_id, system_message)
    if api_key:
        return _make_emergent_chat(api_key, session_id, system_message)
    raise ValueError(
        "No LLM credential available. Set ANTHROPIC_API_KEY (post-migration) "
        "or pass a valid Emergent LLM key."
    )


__all__ = ["LlmChat", "UserMessage", "TextDelta", "StreamDone"]
