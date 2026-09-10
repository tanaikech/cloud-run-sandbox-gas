"""
Local Unit & Probe Test Suite for Cloud Run Sandboxes Service
GitHub: https://github.com/tanaikech/cloud-run-sandbox-gas
Author: tanaike (https://github.com/tanaikech)
Compliant with Stage 3 Zero-Data Stress-Testing Support
"""
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_health():
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "HEALTHY"
    assert "sandbox_available" in data
    print("Health Test Passed:", data)

def test_run_python_basic():
    response = client.post(
        "/run",
        json={"language": "python", "code": "print(2**32)", "timeout_sec": 3.0}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["exit_code"] == 0
    assert "4294967296" in data["stdout"]
    print("Run Basic Python Test Passed:", data["duration_ms"], "ms")

def test_run_syntax_error():
    response = client.post(
        "/run",
        json={"language": "python", "code": "print('unclosed", "timeout_sec": 3.0}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is False
    assert data["exit_code"] != 0
    print("Syntax Error Test Passed:", data["stderr"].strip().splitlines()[-1])

def test_run_timeout():
    response = client.post(
        "/run",
        json={"language": "python", "code": "import time; time.sleep(5)", "timeout_sec": 1.0}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is False
    assert data["timed_out"] is True
    print("Timeout DoS Test Passed:", data["stderr"])

def test_probes():
    for probe in ["metadata-isolation", "env-isolation", "fs-isolation", "egress-isolation"]:
        res = client.post(f"/test/{probe}")
        assert res.status_code == 200
        data = res.json()
        print(f"Probe [{probe}] Status:", data["status"], f"({data['duration_ms']} ms)")

if __name__ == "__main__":
    test_health()
    test_run_python_basic()
    test_run_syntax_error()
    test_run_timeout()
    test_probes()
    print("\nAll Local Tests Completed Successfully!")
