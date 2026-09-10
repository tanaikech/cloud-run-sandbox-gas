# Google Apps Script (GAS) Setup Instructions

* **GitHub Repository**: [https://github.com/tanaikech/cloud-run-sandbox-gas](https://github.com/tanaikech/cloud-run-sandbox-gas)
* **Author**: `tanaike` ([https://github.com/tanaikech](https://github.com/tanaikech))

This guide provides a step-by-step walkthrough for configuring Google Apps Script (GAS) to communicate with and verify Google Cloud Run Sandboxes.

---

## Step 1: Create a New Google Apps Script Project

1. Open [script.google.com](https://script.google.com) in your web browser and click **New project**.
2. Click **Untitled project** in the upper left corner and rename it (e.g., `CloudRun-Sandbox-Test`).

---

## Step 2: Add Script Files to Your Project

Using the **+** icon next to **Files** in the left sidebar, add the following files and paste their respective contents from this repository:

1. **`Auth.gs`**:
   - Copy and paste the entire code from [`gas/Auth.js`](Auth.js).
2. **`TestCases.gs`**:
   - Copy and paste the entire code from [`gas/TestCases.js`](TestCases.js).
3. **`Code.gs`**:
   - Clear the default content in `Code.gs`, then copy and paste the entire code from [`gas/Code.js`](Code.js).
4. **`PracticalDemo.gs`** *(Optional - for Advanced Visualization Demo)*:
   - Create `PracticalDemo.gs` and copy the code from [`gas/PracticalDemo.js`](PracticalDemo.js).

---

## Step 3: Configure Project Manifest (`appsscript.json`)

1. Click **Project Settings** (gear icon) in the left navigation sidebar.
2. Check the box for **Show "appsscript.json" manifest file in editor**.
3. Return to the **Editor** (`<>` icon) in the left sidebar and open `appsscript.json`.
4. Ensure the file contains the required OAuth scopes for external network requests, Google Sheets creation, and Drive integration, matching [`gas/appsscript.json`](appsscript.json):
   ```json
   {
     "timeZone": "Asia/Tokyo",
     "dependencies": {},
     "exceptionLogging": "STACKDRIVER",
     "runtimeVersion": "V8",
     "oauthScopes": [
       "https://www.googleapis.com/auth/script.external_request",
       "https://www.googleapis.com/auth/spreadsheets",
       "https://www.googleapis.com/auth/drive"
     ]
   }
   ```

---

## Step 4: Configure Script Properties

1. Open **Project Settings** (gear icon) in the left sidebar.
2. Scroll to the **Script Properties** section at the bottom and click **Edit script properties**.
3. Click **Add script property** and add the following entry:

| Property Name | Value | Description |
| :--- | :--- | :--- |
| `CLOUD_RUN_URL` | `https://<YOUR-SERVICE-URL>` | Root URL of your deployed Cloud Run service (without trailing slash) |

> **Optional: Only Required for IAM Private Access Mode**:
> * **Property Name**: `SERVICE_ACCOUNT_KEY`
> * **Value**: The complete JSON string of your Google Cloud Service Account Key.
> * *Note*: If you deployed with `--allow-unauthenticated` (the default in `deploy.sh`), this property is not needed.

4. Click **Save script properties**.

---

## Step 5: Execute Tests and Inspect Logs

1. Return to the **Editor** (`<>` icon). In the function dropdown on the toolbar, select **`checkHealth`** and click **Run**.
   * On the first run, Google displays an authorization dialog. Click **Review permissions**, choose your Google account, and click **Allow**.
   * When successful, the execution log shows `HTTP 200`, `"status": "HEALTHY"`, and `"sandbox_available": true`.
2. Next, select **`runAllTests`** from the function dropdown and click **Run**.
   * All 8 test cases execute sequentially (basic computation, syntax error resilience, timeout enforcement, metadata SSRF block, env var shielding, filesystem write protection, egress isolation, and Bash subshell).
   * Upon completion, a structured Markdown report titled **"📊 CLOUD RUN SANDBOX × GAS VERIFICATION RUN REPORT"** appears in the execution log.
3. *(Optional)* Select **`runPracticalHeatmapDemo`** from the dropdown and click **Run**.
   * Creates a new Google Spreadsheet with student performance data.
   * Dispatches the dataset and a dynamic Matplotlib/Seaborn script to Cloud Run Sandboxes.
   * Computes the correlation matrix, renders a high-resolution heatmap PNG, converts it to a Blob, and embeds the image directly into the Google Sheet.
   * The execution log outputs the direct URL to the created Spreadsheet.

---

## Step 6: Cleanup Resources

When testing is complete, or if an execution is interrupted:
* Select **`cleanupAllTestResources`** from the toolbar function dropdown and click **Run**.
* Any cached authentication tokens and temporary session properties are purged cleanly.
