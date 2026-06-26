from unittest.mock import AsyncMock, MagicMock

import pytest
from pydantic import BaseModel

from backend.config import Settings
from backend.services.llm import LLMService


class SampleOutput(BaseModel):
    answer: str


@pytest.mark.asyncio
async def test_structured_gemini_uses_json_schema():
    settings = Settings(
        stub_mode=False,
        llm_provider="gemini",
        google_api_key="test-key",
        gemini_model="gemini-2.0-flash",
    )
    service = LLMService(settings)

    mock_response = MagicMock()
    mock_response.text = '{"answer": "ok"}'

    mock_aio = MagicMock()
    mock_aio.models.generate_content = AsyncMock(return_value=mock_response)

    service._gemini = MagicMock(aio=mock_aio)
    result = await service.structured("prompt", SampleOutput)

    assert result.answer == "ok"
    mock_aio.models.generate_content.assert_awaited_once()
    kwargs = mock_aio.models.generate_content.await_args.kwargs
    assert kwargs["model"] == "gemini-2.0-flash"
    assert kwargs["config"].response_mime_type == "application/json"


@pytest.mark.asyncio
async def test_structured_anthropic_extracts_json():
    settings = Settings(
        stub_mode=False,
        llm_provider="anthropic",
        anthropic_api_key="test-key",
    )
    service = LLMService(settings)

    mock_block = MagicMock()
    mock_block.text = 'Here is JSON:\n{"answer": "from-claude"}'
    mock_response = MagicMock()
    mock_response.content = [mock_block]

    mock_client = MagicMock()
    mock_client.messages.create = AsyncMock(return_value=mock_response)

    service._anthropic = mock_client
    result = await service.structured("prompt", SampleOutput)

    assert result.answer == "from-claude"


def test_llm_configured_respects_provider():
    assert Settings(llm_provider="gemini", google_api_key="x").llm_configured() is True
    assert Settings(llm_provider="gemini", google_api_key="").llm_configured() is False
    assert Settings(llm_provider="anthropic", anthropic_api_key="x").llm_configured() is True


@pytest.mark.asyncio
async def test_structured_raises_in_stub_mode():
    service = LLMService(Settings(stub_mode=True, llm_provider="gemini", google_api_key="x"))
    with pytest.raises(RuntimeError, match="stub mode"):
        await service.structured("prompt", SampleOutput)
