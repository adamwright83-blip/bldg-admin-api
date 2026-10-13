#!/usr/bin/env python3
"""Start a local acceptance command with one in-memory model credential.

Run this under an explicit Railway service/environment `railway run`.
The parent environment may contain production credentials; the executed child
receives only the allowlisted model key and an explicitly local database URL.
Never prints or writes credentials.
"""
import os
import sys
from urllib.parse import urlparse

if len(sys.argv) < 2:
    raise SystemExit("Pass the local acceptance command and its arguments.")

database_url = os.environ.get("CLAIRE_ACCEPTANCE_DB_URL", "")
parsed = urlparse(database_url)
if parsed.scheme not in ("mysql", "mysql2") or parsed.hostname not in (
    "127.0.0.1", "localhost", "::1"
):
    raise SystemExit("CLAIRE_ACCEPTANCE_DB_URL must point at local MySQL.")
if not parsed.path.strip("/"):
    raise SystemExit("CLAIRE_ACCEPTANCE_DB_URL must name an isolated database.")

model_key = os.environ.get("ANTHROPIC_API_KEY", "")
if not model_key.strip():
    raise SystemExit("ANTHROPIC_API_KEY is not available to the parent process.")

child_env = {
    key: os.environ[key]
    for key in ("PATH", "HOME", "TMPDIR")
    if key in os.environ
}
child_env.update({
    "ANTHROPIC_API_KEY": model_key,
    "ANTHROPIC_MODEL": "claude-sonnet-4-6",
    "ANTHROPIC_MODEL_CLAIRE": "claude-sonnet-4-6",
    "DATABASE_URL": database_url,
    "NODE_ENV": "test",
    "OWNER_OPEN_ID": "adam-admin",
    "CLAIRE_BRAIN_V2_LIVE": "1",
    "CLAIRE_BRAIN_V2_SHADOW": "0",
    "CLAIRE_VOICE_RECORDING_ENABLED": "false",
    "CLAIRE_TWILIO_CONVERSATION_RELAY": "false",
    "CLAIRE_XAI_TTS_ENABLED": "false",
})
# An application that loads dotenv must not restore excluded credentials.
# The acceptance harness must also replace every outbound communication adapter.
os.execvpe(sys.argv[1], sys.argv[1:], child_env)

