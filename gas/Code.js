/**
 * Code.js - Main Test Suite Runner & Logger for Cloud Run Sandboxes
 * GitHub: https://github.com/tanaikech/cloud-run-sandbox-gas
 * Author: tanaike (https://github.com/tanaikech)
 * ==============================================================================
 * Cloud Run Sandboxes Validation Suite
 * Master Orchestrator for Google Apps Script (GAS)
 * Features:
 * - Sequential execution of functional and security isolation test cases
 * - High-precision latency measurement (Cloud Run duration vs Network round-trip)
 * - Detailed, Markdown-formatted execution logging for direct article inclusion
 * - In-line fail-safe cleanup and standalone cleanupAllTestResources() function
 * ==============================================================================
 */

/**
 * Global Configuration & Helper to retrieve Cloud Run Service URL.
 * Private helper function (trailing underscore prevents listing in Apps Script editor dropdown).
 */
function getCloudRunUrl_() {
  var url = PropertiesService.getScriptProperties().getProperty("CLOUD_RUN_URL");
  if (!url) {
    throw new Error(
      "CLOUD_RUN_URL is not set in Script Properties.\n" +
      "Please navigate to Project Settings > Script Properties and set:\n" +
      "CLOUD_RUN_URL = https://<YOUR-SERVICE-NAME>-<PROJECT-HASH>-<REGION>.a.run.app"
    );
  }
  return url.replace(/\/+$/, "");
}

/**
 * Health Check Verification Function.
 * Runs a quick GET / request to verify service availability and sandbox binary status.
 */
function checkHealth() {
  var baseUrl = getCloudRunUrl_();
  var headers = CloudRunAuth_.getAuthHeaders_(baseUrl);

  var startTime = Date.now();
  var response = UrlFetchApp.fetch(baseUrl + "/", {
    method: "get",
    headers: headers,
    muteHttpExceptions: true
  });
  var elapsedMs = Date.now() - startTime;

  Logger.log("==================================================");
  Logger.log("CLOUD RUN SANDBOX HEALTH CHECK");
  Logger.log("==================================================");
  Logger.log("Endpoint   : " + baseUrl + "/");
  Logger.log("HTTP Code  : " + response.getResponseCode());
  Logger.log("Latency    : " + elapsedMs + " ms");
  Logger.log("Payload    : " + response.getContentText());
  Logger.log("==================================================");

  return JSON.parse(response.getContentText());
}

/**
 * Master Test Suite: Executes all defined test cases sequentially,
 * records performance metrics, and outputs formatted Markdown logs.
 */
function runAllTests() {
  var baseUrl = getCloudRunUrl_();
  var results = [];
  var overallStart = Date.now();

  Logger.log("\n================================================================================");
  Logger.log("STARTING CLOUD RUN SANDBOX TEST SUITE (GAS EXECUTION)");
  Logger.log("Target Base URL: " + baseUrl);
  Logger.log("Started At     : " + new Date().toISOString());
  Logger.log("================================================================================\n");

  try {
    for (var i = 0; i < CloudRunTestCases.length; i++) {
      var tc = CloudRunTestCases[i];
      Logger.log("Executing [" + tc.id + "] " + tc.name + "...");

      var reqStart = Date.now();
      var httpResponse = null;
      var networkLatencyMs = 0;
      var parsedResponse = null;
      var rawText = "";
      var executionError = null;

      try {
        var headers = CloudRunAuth_.getAuthHeaders_(baseUrl);
        var targetUrl = baseUrl + tc.endpoint;
        var hasPayload = (Object.keys(tc.payload).length > 0);

        var fetchOptions = {
          method: "post",
          headers: headers,
          muteHttpExceptions: true
        };

        if (hasPayload) {
          fetchOptions.payload = JSON.stringify(tc.payload);
        }

        httpResponse = UrlFetchApp.fetch(targetUrl, fetchOptions);
        networkLatencyMs = Date.now() - reqStart;
        rawText = httpResponse.getContentText();
        parsedResponse = JSON.parse(rawText);
      } catch (err) {
        networkLatencyMs = Date.now() - reqStart;
        executionError = err.message;
      }

      var validation = { passed: false, summary: "Execution failed" };
      if (httpResponse && parsedResponse) {
        try {
          validation = tc.validator(httpResponse, parsedResponse);
        } catch (valErr) {
          validation = { passed: false, summary: "Validator exception: " + valErr.message };
        }
      } else if (executionError) {
        validation = { passed: false, summary: "Request error: " + executionError };
      }

      var resultItem = {
        id: tc.id,
        name: tc.name,
        endpoint: tc.endpoint,
        httpCode: httpResponse ? httpResponse.getResponseCode() : -1,
        passed: validation.passed,
        summary: validation.summary,
        networkLatencyMs: networkLatencyMs,
        serverDurationMs: parsedResponse ? (parsedResponse.duration_ms || parsedResponse.execution_time_ms || 0) : 0,
        isSandboxed: parsedResponse ? Boolean(parsedResponse.is_sandboxed) : false,
        rawResponse: parsedResponse,
        rawText: rawText,
        error: executionError
      };

      results.push(resultItem);
      Utilities.sleep(300); // 300ms gentle pause between requests
    }

  } finally {
    // In-line safe cleanup of temporary cached authentication tokens
    PropertiesService.getScriptProperties().deleteProperty("CACHED_ID_TOKEN");
    PropertiesService.getScriptProperties().deleteProperty("CACHED_ID_TOKEN_EXPIRY");
  }

  var overallDurationSec = ((Date.now() - overallStart) / 1000).toFixed(2);

  // Generate and output the comprehensive Markdown report to Logger
  outputDetailedMarkdownReport_(results, overallDurationSec);

  return results;
}

/**
 * Outputs a beautifully structured Markdown report directly to GAS Logger
 * for seamless copy-pasting into the research discussion and Medium draft.
 * Private helper function (trailing underscore prevents listing in Apps Script editor dropdown).
 */
function outputDetailedMarkdownReport_(results, totalTimeSec) {
  var passCount = 0;
  var failCount = results.length;

  for (var i = 0; i < results.length; i++) {
    if (results[i].passed) passCount++;
  }
  failCount = results.length - passCount;

  var logLines = [];
  logLines.push("");
  logLines.push("### 📊 CLOUD RUN SANDBOX × GAS VERIFICATION RUN REPORT");
  logLines.push("");
  logLines.push("- **Total Tests Executed**: " + results.length);
  logLines.push("- **Passed**: " + passCount + " / " + results.length);
  logLines.push("- **Failed**: " + failCount + " / " + results.length);
  logLines.push("- **Total Execution Wall Time**: " + totalTimeSec + " seconds");
  logLines.push("- **Overall Verdict**: " + (failCount === 0 ? "✅ ALL TESTS PASSED" : "⚠️ SOME TESTS FAILED"));
  logLines.push("");
  logLines.push("| Test ID | Test Name | HTTP | Server Time | Network RTT | Sandbox Active | Status |");
  logLines.push("| :--- | :--- | :---: | :---: | :---: | :---: | :---: |");

  for (var j = 0; j < results.length; j++) {
    var r = results[j];
    var statusBadge = r.passed ? "✅ PASS" : "❌ FAIL";
    var sandboxBadge = r.isSandboxed ? "gVisor (True)" : "Host/Fallback";
    logLines.push(
      "| **" + r.id + "** | " + r.name + " | " +
      r.httpCode + " | " +
      r.serverDurationMs + " ms | " +
      r.networkLatencyMs + " ms | " +
      sandboxBadge + " | " +
      statusBadge + " |"
    );
  }

  logLines.push("");
  logLines.push("#### 📝 Detailed Execution Breakdown & Raw Outputs");
  logLines.push("");

  for (var k = 0; k < results.length; k++) {
    var item = results[k];
    logLines.push("```text");
    logLines.push("--------------------------------------------------------------------------------");
    logLines.push("[" + item.id + "] " + item.name);
    logLines.push("Endpoint       : " + item.endpoint);
    logLines.push("Verdict        : " + (item.passed ? "PASS" : "FAIL") + " - " + item.summary);
    logLines.push("Timing         : Server=" + item.serverDurationMs + "ms, RoundTrip=" + item.networkLatencyMs + "ms");
    logLines.push("Sandbox Active : " + item.isSandboxed);
    if (item.rawResponse) {
      if (item.rawResponse.stdout) {
        logLines.push("stdout         : " + item.rawResponse.stdout.trim());
      }
      if (item.rawResponse.stderr) {
        logLines.push("stderr         : " + item.rawResponse.stderr.trim());
      }
      if (item.rawResponse.details) {
        logLines.push("details        : " + item.rawResponse.details);
      }
    }
    if (item.error) {
      logLines.push("Fetch Error    : " + item.error);
      if (item.rawText) {
        logLines.push("Raw Response   : " + item.rawText.substring(0, 200).replace(/\r?\n/g, " "));
      }
    }
    logLines.push("--------------------------------------------------------------------------------");
    logLines.push("```");
    logLines.push("");
  }

  var finalOutput = logLines.join("\n");
  Logger.log(finalOutput);
}

/**
 * Standalone Fail-Safe Cleanup Function.
 * Can be run manually from the Apps Script editor toolbar at any time.
 * Purges all cached tokens, test timestamps, and temporary session keys.
 */
function cleanupAllTestResources() {
  Logger.log("==================================================");
  Logger.log("STARTING FAIL-SAFE CLEANUP OF GAS RESOURCES");
  Logger.log("==================================================");

  var scriptProps = PropertiesService.getScriptProperties();
  var keysToPurge = [
    "CACHED_ID_TOKEN",
    "CACHED_ID_TOKEN_EXPIRY",
    "TEMP_SESSION_ID",
    "LAST_TEST_TIMESTAMP"
  ];

  for (var i = 0; i < keysToPurge.length; i++) {
    var k = keysToPurge[i];
    if (scriptProps.getProperty(k)) {
      scriptProps.deleteProperty(k);
      Logger.log("Deleted Script Property: " + k);
    }
  }

  Logger.log("Cleanup complete. GAS environment is 100% clean.");
  Logger.log("==================================================");
}
