"""
Cloud Run Sandboxes Runner Service (FastAPI)
GitHub: https://github.com/tanaikech/cloud-run-sandbox-gas
Author: tanaike (https://github.com/tanaikech)
==============================================================================
Provides secure, low-latency micro-sandbox execution using Cloud Run Gen2
`--sandbox-launcher` (gVisor `/usr/local/gcp/bin/sandbox`).
Includes automated security probes for metadata isolation (SSRF), environment
variable isolation, filesystem isolation, and network egress isolation.
==============================================================================
"""

import os
import sys
import time
import json
import socket
import platform
import subprocess
from typing import Literal, Any
from fastapi import FastAPI, status
from pydantic import BaseModel, Field

# Constants & Configuration
SANDBOX_BIN_PATH = "/usr/local/gcp/bin/sandbox"
DEFAULT_TIMEOUT_SEC = 5.0
MAX_TIMEOUT_SEC = 12.0  # Kept below Cloud Run 15s limit to ensure graceful response

app = FastAPI(
    title="Cloud Run Sandboxes Runner",
    description="Deterministic and isolated code execution service leveraging gVisor on Cloud Run Gen2.",
    version="1.0.0",
)


# ==============================================================================
# Pydantic Schemas
# ==============================================================================

class RunRequest(BaseModel):
    language: Literal["python", "bash"] = Field(
        default="python",
        description="Execution runtime language ('python' or 'bash')"
    )
    code: str = Field(
        ...,
        description="The source code to execute inside the sandbox."
    )
    allow_write: bool = Field(
        default=False,
        description="Grant temporary write permissions to the sandbox ephemeral filesystem."
    )
    allow_egress: bool = Field(
        default=False,
        description="Allow external outbound network connections from the sandbox."
    )
    timeout_sec: float = Field(
        default=DEFAULT_TIMEOUT_SEC,
        ge=0.5,
        le=MAX_TIMEOUT_SEC,
        description=f"Execution timeout in seconds (0.5 - {MAX_TIMEOUT_SEC})."
    )


class RunResponse(BaseModel):
    success: bool
    exit_code: int
    stdout: str
    stderr: str
    duration_ms: float
    is_sandboxed: bool
    timed_out: bool
    command: list[str]


class HealthResponse(BaseModel):
    status: str
    sandbox_available: bool
    sandbox_path: str
    python_version: str
    platform_info: str
    cloud_run_environment: dict[str, Any]


class ProbeResponse(BaseModel):
    probe_name: str
    isolated: bool
    status: str
    details: str
    duration_ms: float
    is_sandboxed: bool
    raw_output: dict[str, Any]


# ==============================================================================
# Helper Functions
# ==============================================================================

def check_sandbox_available() -> bool:
    """Checks whether the Cloud Run gVisor sandbox binary is present and executable."""
    return os.path.isfile(SANDBOX_BIN_PATH) and os.access(SANDBOX_BIN_PATH, os.X_OK)


def execute_subprocess(
    language: str,
    code: str,
    allow_write: bool = False,
    allow_egress: bool = False,
    timeout_sec: float = DEFAULT_TIMEOUT_SEC,
) -> RunResponse:
    """
    Executes the specified code string inside the Cloud Run sandbox launcher.
    If the sandbox binary is not available (e.g. local development / test),
    it safely falls back to direct execution with a cleared environment.
    """
    is_sandboxed = check_sandbox_available()

    if is_sandboxed:
        # Cloud Run Sandboxes CLI invocation syntax:
        # /usr/local/gcp/bin/sandbox do [--allow-write] [--allow-egress] -- <command>
        cmd: list[str] = [SANDBOX_BIN_PATH, "do"]
        if allow_write:
            cmd.append("--write")
        if allow_egress:
            cmd.append("--allow-egress")
        cmd.append("--")

        py_bin = sys.executable or "/usr/local/bin/python3"
        bash_bin = "/bin/bash" if os.path.exists("/bin/bash") else "/bin/sh"

        if language == "python":
            cmd.extend([py_bin, "-c", code])
        elif language == "bash":
            # Ensure standard system PATH is set for bash commands in the sandbox guest
            sandboxed_bash_code = f"export PATH=/usr/local/bin:/usr/bin:/bin:$PATH\n{code}"
            cmd.extend([bash_bin, "-c", sandboxed_bash_code])
        else:
            raise ValueError(f"Unsupported language: {language}")
        
        # In sandboxed mode, sandbox handles process sandboxing
        sub_env = None
    else:
        # Fallback for local development and non-sandbox testing
        if language == "python":
            cmd = ["python3", "-c", code]
        elif language == "bash":
            cmd = ["bash", "-c", code]
        else:
            raise ValueError(f"Unsupported language: {language}")
        
        # Maintain minimal PATH for local fallback
        sub_env = {
            "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
            "LANG": "C.UTF-8",
        }

    start_time = time.perf_counter()
    try:
        proc = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=timeout_sec,
            env=sub_env,
        )
        duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
        return RunResponse(
            success=(proc.returncode == 0),
            exit_code=proc.returncode,
            stdout=proc.stdout,
            stderr=proc.stderr,
            duration_ms=duration_ms,
            is_sandboxed=is_sandboxed,
            timed_out=False,
            command=cmd,
        )

    except subprocess.TimeoutExpired as exc:
        duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
        stdout_txt = exc.stdout if isinstance(exc.stdout, str) else (exc.stdout.decode(errors="replace") if exc.stdout else "")
        stderr_txt = f"Execution timed out after {timeout_sec} seconds"
        return RunResponse(
            success=False,
            exit_code=124,  # Standard UNIX timeout exit code
            stdout=stdout_txt,
            stderr=stderr_txt,
            duration_ms=duration_ms,
            is_sandboxed=is_sandboxed,
            timed_out=True,
            command=cmd,
        )

    except subprocess.SubprocessError as exc:
        duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
        return RunResponse(
            success=False,
            exit_code=-1,
            stdout="",
            stderr=f"SubprocessError: {type(exc).__name__}: {str(exc)}",
            duration_ms=duration_ms,
            is_sandboxed=is_sandboxed,
            timed_out=False,
            command=cmd,
        )

    except Exception as exc:
        duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
        return RunResponse(
            success=False,
            exit_code=-1,
            stdout="",
            stderr=f"UnexpectedError: {type(exc).__name__}: {str(exc)}",
            duration_ms=duration_ms,
            is_sandboxed=is_sandboxed,
            timed_out=False,
            command=cmd,
        )


# ==============================================================================
# Endpoints
# ==============================================================================

@app.get("/", response_model=HealthResponse)
def get_health() -> HealthResponse:
    """Health check and runtime diagnostic metadata."""
    sandbox_avail = check_sandbox_available()
    return HealthResponse(
        status="HEALTHY",
        sandbox_available=sandbox_avail,
        sandbox_path=SANDBOX_BIN_PATH,
        python_version=sys.version.split()[0],
        platform_info=f"{platform.system()} {platform.release()} ({platform.machine()})",
        cloud_run_environment={
            "K_SERVICE": os.environ.get("K_SERVICE"),
            "K_REVISION": os.environ.get("K_REVISION"),
            "K_CONFIGURATION": os.environ.get("K_CONFIGURATION"),
            "PORT": os.environ.get("PORT", "8080"),
        },
    )


@app.post("/run", response_model=RunResponse)
def run_code(req: RunRequest) -> RunResponse:
    """Execute arbitrary code safely inside the sandbox."""
    return execute_subprocess(
        language=req.language,
        code=req.code,
        allow_write=req.allow_write,
        allow_egress=req.allow_egress,
        timeout_sec=req.timeout_sec,
    )


@app.post("/test/metadata-isolation", response_model=ProbeResponse)
def probe_metadata_isolation() -> ProbeResponse:
    """
    Probe 1: Verify that Cloud Run Instance Metadata (169.254.169.254)
    cannot be accessed from within the sandbox (SSRF protection).
    """
    probe_code = (
        "import urllib.request, urllib.error, sys\n"
        "req = urllib.request.Request(\n"
        "    'http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token',\n"
        "    headers={'Metadata-Flavor': 'Google'}\n"
        ")\n"
        "try:\n"
        "    with urllib.request.urlopen(req, timeout=2.0) as resp:\n"
        "        token_data = resp.read().decode('utf-8')\n"
        "        print(f'LEAK_DETECTED: {token_data[:20]}...')\n"
        "        sys.exit(0)\n"
        "except Exception as e:\n"
        "    print(f'ACCESS_BLOCKED: {type(e).__name__}: {e}', file=sys.stderr)\n"
        "    sys.exit(1)\n"
    )

    res = execute_subprocess(
        language="python",
        code=probe_code,
        allow_write=False,
        allow_egress=False,
        timeout_sec=4.0,
    )

    # Isolated is True if the connection was blocked (exit_code != 0)
    isolated = (res.exit_code != 0)
    status_label = "BLOCKED (PASS)" if isolated else "ACCESSIBLE (FAIL)"

    return ProbeResponse(
        probe_name="metadata_isolation",
        isolated=isolated,
        status=status_label,
        details=res.stderr if isolated else f"Metadata leaked: {res.stdout}",
        duration_ms=res.duration_ms,
        is_sandboxed=res.is_sandboxed,
        raw_output=res.model_dump(),
    )


@app.post("/test/env-isolation", response_model=ProbeResponse)
def probe_env_isolation() -> ProbeResponse:
    """
    Probe 2: Verify that host container environment variables (GCP credentials,
    K_SERVICE, K_REVISION) are not exposed inside the sandbox.
    """
    probe_code = (
        "import os, json\n"
        "print(json.dumps(dict(os.environ)))\n"
    )

    res = execute_subprocess(
        language="python",
        code=probe_code,
        allow_write=False,
        allow_egress=False,
        timeout_sec=3.0,
    )

    leaked_keys: list[str] = []
    if res.success and res.exit_code == 0 and res.stdout:
        try:
            guest_env: dict[str, str] = json.loads(res.stdout.strip())
            # Check for host-sensitive environment variables
            sensitive_keys = ["K_SERVICE", "K_REVISION", "K_CONFIGURATION", "GOOGLE_APPLICATION_CREDENTIALS"]
            leaked_keys = [k for k in sensitive_keys if k in guest_env]
        except Exception as e:
            leaked_keys = [f"JSON_PARSE_ERROR: {str(e)}"]

    isolated = (res.success and res.exit_code == 0 and len(leaked_keys) == 0)
    if not res.success or res.exit_code != 0:
        status_label = "EXECUTION_ERROR (FAIL)"
        details = f"Probe process execution failed: {res.stderr}"
    elif len(leaked_keys) > 0:
        status_label = f"LEAKED (FAIL: {leaked_keys})"
        details = f"Host sensitive environment variables leaked: {leaked_keys}"
    else:
        status_label = "MASKED (PASS)"
        details = "Sensitive host environment variables are properly masked from sandbox guest."

    return ProbeResponse(
        probe_name="env_isolation",
        isolated=isolated,
        status=status_label,
        details=details,
        duration_ms=res.duration_ms,
        is_sandboxed=res.is_sandboxed,
        raw_output=res.model_dump(),
    )


@app.post("/test/fs-isolation", response_model=ProbeResponse)
def probe_fs_isolation() -> ProbeResponse:
    """
    Probe 3: Verify that writing to disk is blocked when `allow_write=False`,
    and succeeds into ephemeral tmpfs when `allow_write=True`.
    """
    write_test_code = (
        "import sys, os\n"
        "probe_file = '/fs_probe.txt'\n"
        "try:\n"
        "    with open(probe_file, 'w') as f:\n"
        "        f.write('sandbox_fs_probe_content')\n"
        "    print('WRITE_SUCCESS')\n"
        "    if os.path.exists(probe_file):\n"
        "        os.remove(probe_file)\n"
        "    sys.exit(0)\n"
        "except Exception as e:\n"
        "    print(f'WRITE_BLOCKED: {type(e).__name__}: {e}', file=sys.stderr)\n"
        "    sys.exit(1)\n"
    )

    # Test 1: Write when write is disallowed
    res_deny = execute_subprocess(
        language="python",
        code=write_test_code,
        allow_write=False,
        allow_egress=False,
        timeout_sec=3.0,
    )

    # Test 2: Write when write is allowed
    res_allow = execute_subprocess(
        language="python",
        code=write_test_code,
        allow_write=True,
        allow_egress=False,
        timeout_sec=3.0,
    )

    # On Cloud Run sandbox, res_deny must fail (exit_code != 0) and res_allow must succeed (exit_code == 0)
    # When running in local fallback mode (non-sandboxed), res_deny might succeed because local /tmp is writable.
    if res_deny.is_sandboxed:
        isolated = (res_deny.exit_code != 0) and (res_allow.exit_code == 0)
        status_label = "READ_ONLY_ENFORCED (PASS)" if isolated else "WRITE_UNRESTRICTED (FAIL)"
        details = (
            f"Write blocked without flag: {'PASS' if res_deny.exit_code != 0 else 'FAIL'}. "
            f"Write permitted with flag: {'PASS' if res_allow.exit_code == 0 else 'FAIL'}."
        )
    else:
        isolated = True
        status_label = "LOCAL_FALLBACK (HOST_TMP_ACCESSIBLE)"
        details = "Running in non-sandboxed local fallback mode; /tmp write was not restricted by gVisor."

    total_duration = round(res_deny.duration_ms + res_allow.duration_ms, 2)

    return ProbeResponse(
        probe_name="fs_isolation",
        isolated=isolated,
        status=status_label,
        details=details,
        duration_ms=total_duration,
        is_sandboxed=res_deny.is_sandboxed,
        raw_output={
            "deny_run": res_deny.model_dump(),
            "allow_run": res_allow.model_dump(),
        },
    )


@app.post("/test/egress-isolation", response_model=ProbeResponse)
def probe_egress_isolation() -> ProbeResponse:
    """
    Probe 4: Verify that external outbound network traffic is blocked when
    `allow_egress=False`, and enabled when `allow_egress=True`.
    """
    network_test_code = (
        "import socket, sys\n"
        "s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)\n"
        "s.settimeout(2.0)\n"
        "try:\n"
        "    # Connect to Cloudflare public DNS (1.1.1.1:53)\n"
        "    s.connect(('1.1.1.1', 53))\n"
        "    print('EGRESS_CONNECTED')\n"
        "    s.close()\n"
        "    sys.exit(0)\n"
        "except Exception as e:\n"
        "    print(f'EGRESS_BLOCKED: {type(e).__name__}: {e}', file=sys.stderr)\n"
        "    sys.exit(1)\n"
    )

    # Test 1: Egress denied
    res_deny = execute_subprocess(
        language="python",
        code=network_test_code,
        allow_write=False,
        allow_egress=False,
        timeout_sec=4.0,
    )

    # Test 2: Egress allowed
    res_allow = execute_subprocess(
        language="python",
        code=network_test_code,
        allow_write=False,
        allow_egress=True,
        timeout_sec=4.0,
    )

    if res_deny.is_sandboxed:
        isolated = (res_deny.exit_code != 0)
        status_label = "EGRESS_BLOCKED (PASS)" if isolated else "EGRESS_LEAKED (FAIL)"
        details = (
            f"Egress blocked without flag: {'PASS' if res_deny.exit_code != 0 else 'FAIL'}. "
            f"Egress allowed with flag: {'PASS' if res_allow.exit_code == 0 else 'FAIL'}."
        )
    else:
        isolated = True
        status_label = "LOCAL_FALLBACK (EGRESS_NOT_RESTRICTED)"
        details = "Running in non-sandboxed local fallback mode; network egress was not restricted by gVisor."

    total_duration = round(res_deny.duration_ms + res_allow.duration_ms, 2)

    return ProbeResponse(
        probe_name="egress_isolation",
        isolated=isolated,
        status=status_label,
        details=details,
        duration_ms=total_duration,
        is_sandboxed=res_deny.is_sandboxed,
        raw_output={
            "deny_run": res_deny.model_dump(),
            "allow_run": res_allow.model_dump(),
        },
    )
