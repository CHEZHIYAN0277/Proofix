import asyncio
import json
import sys
from pathlib import Path

#: The interpreter every Python subprocess runs under.
#:
#: Was the bare string `"python"` at seven call sites — the probe, A3.5, the
#: three in scoped validation and the two mutmut calls. That resolves through
#: `PATH`, which is whatever the server process inherited and is *not* the
#: interpreter ProoFix itself is running under. On a machine where ProoFix runs
#: from a virtualenv and `PATH` leads to a system Python, the probe reported
#: `No module named 'pytest'` while ProoFix's own interpreter had pytest
#: installed — and the message it printed claimed to be describing "the
#: interpreter ProoFix would run its tests with", which was the one thing it was
#: not.
#:
#: `sys.executable` is that interpreter, by definition. Using it also keeps the
#: probe and reproduction honest with each other: the probe's whole value is
#: answering the question A3.5 will later ask, and two different interpreters
#: are two different questions.
#:
#: The fallback exists because `sys.executable` is documented as possibly empty
#: when Python is embedded.
PYTHON = sys.executable or "python3"


async def run_command(
    cmd: list[str],
    cwd: str | Path | None = None,
    timeout: int = 120,
    env: dict | None = None,
) -> tuple[int, str, str]:
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=str(cwd) if cwd else None,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
    except FileNotFoundError:
        return -1, "", f"command not found: {cmd[0]}"
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        return -1, "", "timeout"
    return (
        proc.returncode or 0,
        stdout.decode(errors="replace"),
        stderr.decode(errors="replace"),
    )


def parse_json_safe(text: str) -> dict | list:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}") + 1
        if start >= 0 and end > start:
            try:
                return json.loads(text[start:end])
            except json.JSONDecodeError:
                pass
    return {}
