/**
 * TestCases.js - Test Suite Definitions for Cloud Run Sandboxes
 * GitHub: https://github.com/tanaikech/cloud-run-sandbox-gas
 * Author: tanaike (https://github.com/tanaikech)
 * ==============================================================================
 * Defines complete test vectors for functional execution and security isolation:
 * - TC-01: Basic Python arithmetic calculation (2**32)
 * - TC-02: Syntax error handling and fault tolerance
 * - TC-03: Infinite loop DoS attack defense & timeout enforcement
 * - TC-04: GCP Metadata Server SSRF isolation (169.254.169.254)
 * - TC-05: Host environment variable masking & credential protection
 * - TC-06: Filesystem write restriction (allow_write=false vs true)
 * - TC-07: Outbound network egress blocking (allow_egress=false vs true)
 * - TC-08: Bash command execution in isolated subshell
 * ==============================================================================
 */

var CloudRunTestCases = [
  {
    id: "TC-01",
    name: "Basic Python Computation (2**32)",
    endpoint: "/run",
    payload: {
      language: "python",
      code: "print(2**32)",
      allow_write: false,
      allow_egress: false,
      timeout_sec: 5.0
    },
    validator: function (res, parsed) {
      var hasValidStdout = parsed && (typeof parsed.stdout === "string");
      var passed = (res.getResponseCode() === 200) &&
                   (parsed.success === true) &&
                   (parsed.exit_code === 0) &&
                   hasValidStdout &&
                   (parsed.stdout.trim() === "4294967296");
      return {
        passed: passed,
        summary: passed ? "Correct computation result returned (4294967296)" : "Unexpected computation output"
      };
    }
  },
  {
    id: "TC-02",
    name: "Syntax Error Handling & Crash Resistance",
    endpoint: "/run",
    payload: {
      language: "python",
      code: "print('unclosed string literal",
      allow_write: false,
      allow_egress: false,
      timeout_sec: 5.0
    },
    validator: function (res, parsed) {
      var hasValidStderr = parsed && (typeof parsed.stderr === "string");
      var passed = (res.getResponseCode() === 200) &&
                   (parsed.success === false) &&
                   (parsed.exit_code !== 0) &&
                   hasValidStderr &&
                   (parsed.stderr.indexOf("SyntaxError") !== -1 || parsed.stderr.indexOf("Syntax") !== -1);
      return {
        passed: passed,
        summary: passed ? "Container remained healthy, structured error JSON safely returned" : "Failed to handle syntax error gracefully"
      };
    }
  },
  {
    id: "TC-03",
    name: "Infinite Loop DoS Defense (Timeout Enforcement)",
    endpoint: "/run",
    payload: {
      language: "python",
      code: "import time\nwhile True:\n    pass",
      allow_write: false,
      allow_egress: false,
      timeout_sec: 2.0
    },
    validator: function (res, parsed) {
      var passed = (res.getResponseCode() === 200) &&
                   (parsed.success === false) &&
                   (parsed.timed_out === true);
      return {
        passed: passed,
        summary: passed ? "Process terminated cleanly after 2.0s without hanging server" : "Timeout enforcement failed"
      };
    }
  },
  {
    id: "TC-04",
    name: "Metadata Server SSRF Isolation (169.254.169.254)",
    endpoint: "/test/metadata-isolation",
    payload: {},
    validator: function (res, parsed) {
      var passed = (res.getResponseCode() === 200) && (parsed.isolated === true);
      return {
        passed: passed,
        summary: passed ? "Metadata server unreachable from sandbox (SSRF Blocked)" : "CRITICAL: Metadata token was accessible"
      };
    }
  },
  {
    id: "TC-05",
    name: "Host Environment Variable Shielding",
    endpoint: "/test/env-isolation",
    payload: {},
    validator: function (res, parsed) {
      var passed = (res.getResponseCode() === 200) && (parsed.isolated === true);
      return {
        passed: passed,
        summary: passed ? "Host GCP credentials and environment variables fully masked" : "CRITICAL: Host environment variables leaked"
      };
    }
  },
  {
    id: "TC-06",
    name: "Filesystem Write Protection (Ephemeral tmpfs)",
    endpoint: "/test/fs-isolation",
    payload: {},
    validator: function (res, parsed) {
      var passed = (res.getResponseCode() === 200) && (parsed.isolated === true);
      return {
        passed: passed,
        summary: passed ? "Read-only filesystem enforced by default; write permitted only with flag" : "Filesystem protection failed"
      };
    }
  },
  {
    id: "TC-07",
    name: "Outbound Network Egress Isolation",
    endpoint: "/test/egress-isolation",
    payload: {},
    validator: function (res, parsed) {
      var passed = (res.getResponseCode() === 200) && (parsed.isolated === true);
      return {
        passed: passed,
        summary: passed ? "Outbound network traffic blocked by default; enabled only with flag" : "Network egress protection failed"
      };
    }
  },
  {
    id: "TC-08",
    name: "Isolated Bash Subshell Command Execution",
    endpoint: "/run",
    payload: {
      language: "bash",
      code: "uname -a && id",
      allow_write: false,
      allow_egress: false,
      timeout_sec: 3.0
    },
    validator: function (res, parsed) {
      var hasValidStdout = parsed && (typeof parsed.stdout === "string");
      var passed = (res.getResponseCode() === 200) &&
                   (parsed.success === true) &&
                   (parsed.exit_code === 0) &&
                   hasValidStdout &&
                   (parsed.stdout.indexOf("Linux") !== -1);
      return {
        passed: passed,
        summary: passed ? "Bash subshell executed securely inside sandbox" : "Bash execution failed"
      };
    }
  }
];
