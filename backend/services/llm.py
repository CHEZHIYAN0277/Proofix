import json
from typing import TypeVar

from anthropic import AsyncAnthropic
from google import genai
from google.genai import types
from pydantic import BaseModel

from backend.config import Settings, get_settings

T = TypeVar("T", bound=BaseModel)


def _extract_json(text: str) -> str:
    start = text.find("{")
    end = text.rfind("}") + 1
    if start >= 0 and end > start:
        return text[start:end]
    return text


class LLMService:
    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()
        self._anthropic: AsyncAnthropic | None = None
        self._gemini: genai.Client | None = None

    def _ensure_available(self) -> None:
        if self.settings.stub_mode or not self.settings.llm_configured():
            raise RuntimeError("LLM unavailable in stub mode — use agent stub paths")

    @property
    def _anthropic_client(self) -> AsyncAnthropic:
        if self._anthropic is None:
            self._anthropic = AsyncAnthropic(api_key=self.settings.anthropic_api_key)
        return self._anthropic

    @property
    def _gemini_client(self) -> genai.Client:
        if self._gemini is None:
            self._gemini = genai.Client(api_key=self.settings.google_api_key)
        return self._gemini

    async def structured(
        self,
        prompt: str,
        schema: type[T],
        system: str = "You are a security-focused code analysis assistant. Respond with valid JSON only.",
    ) -> T:
        self._ensure_available()
        schema_json = json.dumps(schema.model_json_schema(), indent=2)
        full_system = f"{system}\n\nRespond with JSON matching this schema:\n{schema_json}"
        if self.settings.llm_provider == "gemini":
            return await self._structured_gemini(prompt, schema, full_system)
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

    async def _structured_gemini(self, prompt: str, schema: type[T], system: str) -> T:
        response = await self._gemini_client.aio.models.generate_content(
            model=self.settings.gemini_model,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=system,
                max_output_tokens=4096,
                response_mime_type="application/json",
                response_json_schema=schema.model_json_schema(),
            ),
        )
        text = response.text or ""
        return schema.model_validate_json(_extract_json(text))

    async def text(self, prompt: str, system: str = "You are a helpful assistant.") -> str:
        self._ensure_available()
        if self.settings.llm_provider == "gemini":
            response = await self._gemini_client.aio.models.generate_content(
                model=self.settings.gemini_model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=system,
                    max_output_tokens=4096,
                ),
            )
            return response.text or ""
        response = await self._anthropic_client.messages.create(
            model=self.settings.anthropic_model,
            max_tokens=4096,
            system=system,
            messages=[{"role": "user", "content": prompt}],
        )
        return response.content[0].text
