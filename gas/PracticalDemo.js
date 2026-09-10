/**
 * Cloud Run Sandboxes for Google Apps Script - Practical Heatmap Demo
 * GitHub: https://github.com/tanaikech/cloud-run-sandbox-gas
 * Author: tanaike (https://github.com/tanaikech)
 * License: Apache-2.0
 *
 * Demonstrates:
 * 1. Creating a new Google Spreadsheet and populating it with multivariate sample data.
 * 2. Extracting numeric dataset from the active sheet.
 * 3. Sending the dataset and a dynamic Python Matplotlib/Seaborn visualization script to Cloud Run Sandboxes.
 *    (Note: This Python script can be developer-authored or dynamically generated via Gemini API).
 * 4. Micro-sandboxed execution inside gVisor to compute Pearson correlation matrix and render heatmap.
 * 5. Receiving the PNG image (Base64), converting to a Blob, and embedding it directly onto the Spreadsheet.
 */

/**
 * Executes the end-to-end practical demo:
 * Generates Spreadsheet data, renders correlation heatmap via Cloud Run Sandbox,
 * and inserts the resulting chart image directly back into the sheet.
 */
function runPracticalHeatmapDemo() {
  var baseUrl = PropertiesService.getScriptProperties().getProperty("CLOUD_RUN_URL");
  if (!baseUrl) {
    throw new Error(
      "CLOUD_RUN_URL is not set in Script Properties.\n" +
      "Please navigate to Project Settings > Script Properties and set:\n" +
      "CLOUD_RUN_URL = https://<YOUR-SERVICE-NAME>-<PROJECT-HASH>-<REGION>.a.run.app"
    );
  }
  baseUrl = baseUrl.replace(/\/+$/, "");

  Logger.log("================================================================================");
  Logger.log("STARTING PRACTICAL DEMO: SPREADSHEET HEATMAP VIA CLOUD RUN SANDBOX");
  Logger.log("Target Base URL: " + baseUrl);
  Logger.log("Started At     : " + new Date().toISOString());
  Logger.log("================================================================================");

  // ---------------------------------------------------------------------------
  // Step 1: Create a new Google Spreadsheet and populate with sample data
  // ---------------------------------------------------------------------------
  Logger.log("\n[Step 1/4] Creating new Google Spreadsheet with multivariate student metrics...");
  var dateStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  var ss = SpreadsheetApp.create("Cloud Run Sandbox - Correlation Heatmap Demo (" + dateStr + ")");
  var sheet = ss.getActiveSheet();
  sheet.setName("Academic Scores");

  // Sample dataset: 15 students across 5 academic disciplines
  var headers = ["Student ID", "Math", "Physics", "Chemistry", "English", "History"];
  var rawData = [
    ["S01", 95, 92, 88, 72, 68],
    ["S02", 88, 85, 82, 79, 74],
    ["S03", 72, 70, 75, 88, 91],
    ["S04", 60, 65, 62, 92, 95],
    ["S05", 82, 80, 85, 81, 78],
    ["S06", 91, 94, 89, 70, 65],
    ["S07", 68, 72, 70, 85, 89],
    ["S08", 77, 75, 79, 83, 80],
    ["S09", 85, 88, 84, 76, 72],
    ["S10", 62, 58, 64, 95, 98],
    ["S11", 99, 96, 94, 68, 62],
    ["S12", 74, 78, 80, 82, 84],
    ["S13", 83, 81, 86, 79, 75],
    ["S14", 66, 62, 68, 90, 93],
    ["S15", 90, 89, 87, 75, 71]
  ];

  var tableValues = [headers].concat(rawData);
  sheet.getRange(1, 1, tableValues.length, headers.length).setValues(tableValues);

  // Format headers and freeze top row
  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setBackground("#1a73e8").setFontColor("#ffffff").setFontWeight("bold");
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);

  Logger.log("Spreadsheet created: " + ss.getUrl());

  // ---------------------------------------------------------------------------
  // Step 2: Extract numeric table data from Sheet for Python processing
  // ---------------------------------------------------------------------------
  Logger.log("\n[Step 2/4] Reading data from Sheet and constructing JSON matrix payload...");
  var sheetData = sheet.getDataRange().getValues();
  var metricKeys = headers.slice(1); // ["Math", "Physics", "Chemistry", "English", "History"]
  var records = [];

  for (var r = 1; r < sheetData.length; r++) {
    var rowObj = {};
    for (var c = 1; c < headers.length; c++) {
      rowObj[headers[c]] = Number(sheetData[r][c]);
    }
    records.push(rowObj);
  }
  Logger.log("Extracted " + records.length + " rows across " + metricKeys.length + " variables.");

  // ---------------------------------------------------------------------------
  // Step 3: Construct Python visualization script and dispatch to Cloud Run
  // (Note: This script can be static or dynamically generated on-demand by Gemini API)
  // ---------------------------------------------------------------------------
  Logger.log("\n[Step 3/4] Dispatching payload to Cloud Run Sandboxes (POST /run)...");

  var pythonScript = [
    "import os",
    "os.environ['MPLCONFIGDIR'] = '/tmp/mpl'",
    "import io, json, base64",
    "import matplotlib",
    "matplotlib.use('Agg')",
    "import matplotlib.pyplot as plt",
    "import pandas as pd",
    "import seaborn as sns",
    "",
    "# Injected empirical dataset from Google Sheets",
    "records = " + JSON.stringify(records),
    "df = pd.DataFrame(records)",
    "",
    "# Calculate Pearson correlation matrix",
    "corr = df.corr()",
    "",
    "# Configure publication-grade styling",
    "plt.figure(figsize=(6.8, 5.2), dpi=150)",
    "sns.set_theme(style='white')",
    "cmap = sns.diverging_palette(230, 20, as_cmap=True)",
    "ax = sns.heatmap(corr, annot=True, fmt='.2f', cmap=cmap, vmin=-1.0, vmax=1.0,",
    "                 square=True, linewidths=0.6, cbar_kws={'shrink': 0.8})",
    "plt.title('Student Performance: Multivariate Correlation Heatmap', fontsize=11, fontweight='bold', pad=12)",
    "plt.tight_layout()",
    "",
    "# Encode plot to Base64 PNG buffer",
    "buf = io.BytesIO()",
    "plt.savefig(buf, format='png', dpi=150)",
    "plt.close()",
    "buf.seek(0)",
    "b64_png = base64.b64encode(buf.getvalue()).decode('utf-8')",
    "",
    "# Output structured JSON to stdout",
    "print(json.dumps({",
    "    'status': 'success',",
    "    'image_base64': b64_png,",
    "    'variables': list(df.columns),",
    "    'records_processed': len(df)",
    "}))"
  ].join("\n");

  var payload = {
    language: "python",
    code: pythonScript,
    timeout_sec: 10.0
  };

  var reqHeaders = CloudRunAuth_.getAuthHeaders_(baseUrl);
  reqHeaders["Content-Type"] = "application/json";

  var fetchStart = Date.now();
  var httpResponse = UrlFetchApp.fetch(baseUrl + "/run", {
    method: "post",
    headers: reqHeaders,
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var roundTripMs = Date.now() - fetchStart;

  if (httpResponse.getResponseCode() !== 200) {
    throw new Error("Cloud Run Sandboxes returned HTTP " + httpResponse.getResponseCode() + ": " + httpResponse.getContentText());
  }

  var responseJson = JSON.parse(httpResponse.getContentText());
  if (!responseJson.success || responseJson.exit_code !== 0) {
    throw new Error("Python execution error inside sandbox:\n" + responseJson.stderr);
  }

  var parsedOutput = JSON.parse(responseJson.stdout);
  Logger.log("Sandbox Server Time : " + responseJson.duration_ms + " ms");
  Logger.log("Network Round-Trip  : " + roundTripMs + " ms");
  Logger.log("Is Sandboxed (gVisor): " + responseJson.is_sandboxed);

  // ---------------------------------------------------------------------------
  // Step 4: Convert Base64 PNG to Blob and insert image onto Google Sheet
  // ---------------------------------------------------------------------------
  Logger.log("\n[Step 4/4] Converting Base64 output to Blob and embedding onto Google Sheet...");
  var imageBytes = Utilities.base64Decode(parsedOutput.image_base64);
  var chartBlob = Utilities.newBlob(imageBytes, "image/png", "correlation_heatmap.png");

  // Insert image at Column H (col 8), Row 2
  sheet.insertImage(chartBlob, 8, 2);

  // Add description label above the image
  sheet.getRange(1, 8).setValue("📊 Generated by Cloud Run Sandbox (Matplotlib + Seaborn)").setFontWeight("bold");

  Logger.log("================================================================================");
  Logger.log("DEMO COMPLETED SUCCESSFULLY!");
  Logger.log("Spreadsheet URL : " + ss.getUrl());
  Logger.log("Execution Time  : Server " + responseJson.duration_ms + " ms | Total " + roundTripMs + " ms");
  Logger.log("================================================================================");

  return {
    spreadsheetUrl: ss.getUrl(),
    serverDurationMs: responseJson.duration_ms,
    roundTripMs: roundTripMs,
    isSandboxed: responseJson.is_sandboxed
  };
}
