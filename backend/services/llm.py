import json
from typing import TypeVar

from anthropic import AsyncAnthropic
from mistralai import Mistral
from pydantic import BaseModel

from backend.config import Settings, get_settings

T = TypeVar("T", bound=BaseModel)


def _extract_json(text: str) -> str:
    start = text.find("{")
    end = text.rfind("}") + 1
    if start >= 0 and end > start:
        return text[start:end]
    return text


def _mistral_content(response) -> str:
    choice = response.choices[0]
    message = choice.message
    content = getattr(message, "content", None)
    if content is None and isinstance(message, dict):
        content = message.get("content")
    return content or ""


class LLMService:
    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()
        self._anthropic: AsyncAnthropic | None = None
        self._mistral: Mistral | None = None

    def _ensure_available(self) -> None:
        if self.settings.stub_mode or not self.settings.llm_configured():
            raise RuntimeError("LLM unavailable in stub mode — use agent stub paths")

    @property
    def _anthropic_client(self) -> AsyncAnthropic:
        if self._anthropic is None:
            self._anthropic = AsyncAnthropic(api_key=self.settings.anthropic_api_key)
        return self._anthropic

    @property
    def _mistral_client(self) -> Mistral:
        if self._mistral is None:
            self._mistral = Mistral(api_key=self.settings.mistral_api_key)
        return self._mistral

    async def structured(
        self,
        prompt: str,
        schema: type[T],
        system: str = "You are a security-focused code analysis assistant. Respond with valid JSON only.",
    ) -> T:
        self._ensure_available()
        schema_json = json.dumps(schema.model_json_schema(), indent=2)
        full_system = f"{system}\n\nRespond with JSON matching this schema:\n{schema_json}"
        if self.settings.llm_provider == "mistral":
            return await self._structured_mistral(prompt, schema, full_system)
        return await self._structured_anthropic(prompt, schema, full_system)

    async def _structured_anthropic(self, prompt: str, schema: type[T], system: str) -> T:
        response = await self._anthropic_client.messages.create(
            model=self.settings.anthropic_model,
            max_tokens=4096,
            system=system,
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.content[0].text
        return schema.model_validate_json(_extract_json(text))

    async def _structured_mistral(self, prompt: str, schema: type[T], system: str) -> T:
        response = await self._mistral_client.chat.complete_async(
            model=self.settings.mistral_model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            response_format={"type": "json_object"},
            max_tokens=4096,
        )
        text = _mistral_content(response)
        return schema.model_validate_json(_extract_json(text))

    async def text(self, prompt: str, system: str = "You are a helpful assistant.") -> str:
        self._ensure_available()
        if self.settings.llm_provider == "mistral":
            response = await self._mistral_client.chat.complete_async(
                model=self.settings.mistral_model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": prompt},
                ],
                max_tokens=4096,
            )
            return _mistral_content(response)
        response = await self._anthropic_client.messages.create(
            model=self.settings.anthropic_model,
            max_tokens=4096,
            system=system,
            messages=[{"role": "user", "content": prompt}],
        )
        return response.content[0].text
