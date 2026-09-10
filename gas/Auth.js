/**
 * Auth.js - OIDC ID Token & IAM Authentication Module for Cloud Run
 * GitHub: https://github.com/tanaikech/cloud-run-sandbox-gas
 * Author: tanaike (https://github.com/tanaikech)
 * ==============================================================================
 * Supports two operational modes:
 * Mode A: Public Access (Unauthenticated) - Returns null header
 * Mode B: Enterprise Private Access (IAM) - Generates RSA-SHA256 signed JWT
 *         and exchanges it for a Google-signed OIDC ID Token targeted at the
 *         Cloud Run Service URL (target_audience).
 * ==============================================================================
 */

var CloudRunAuth_ = (function () {

  /**
   * Generates Base64URL-encoded string without padding.
   */
  function base64UrlEncode_(strOrBytes) {
    var encoded = Utilities.base64EncodeWebSafe(strOrBytes);
    return encoded.replace(/=+$/, "");
  }

  /**
   * Retrieves an OIDC ID Token for the target Cloud Run service.
   * If SERVICE_ACCOUNT_KEY is not configured in Script Properties,
   * returns null (assuming the service is deployed with --allow-unauthenticated).
   *
   * @param {string} targetAudience - The target Cloud Run Service URL.
   * @return {string|null} The OIDC ID Token, or null if unauthenticated mode.
   */
  function getIdToken_(targetAudience) {
    var scriptProps = PropertiesService.getScriptProperties();
    var saKeyJson = scriptProps.getProperty("SERVICE_ACCOUNT_KEY");

    // Mode A: Public mode (no service account configured)
    if (!saKeyJson) {
      return null;
    }

    // Check cached token in Script Properties to avoid redundant token requests
    var cachedToken = scriptProps.getProperty("CACHED_ID_TOKEN");
    var cachedExpiry = scriptProps.getProperty("CACHED_ID_TOKEN_EXPIRY");
    var nowSec = Math.floor(Date.now() / 1000);

    if (cachedToken && cachedExpiry && (nowSec < parseInt(cachedExpiry, 10) - 120)) {
      return cachedToken;
    }

    // Parse Service Account JSON
    var sa;
    try {
      sa = JSON.parse(saKeyJson);
    } catch (e) {
      throw new Error("Invalid SERVICE_ACCOUNT_KEY JSON in Script Properties: " + e.message);
    }

    if (!sa.client_email || !sa.private_key) {
      throw new Error("SERVICE_ACCOUNT_KEY missing client_email or private_key.");
    }

    // Mode B: Generate signed JWT for OIDC ID Token exchange
    var iat = nowSec;
    var exp = iat + 3600; // 1 hour expiration

    var header = {
      alg: "RS256",
      typ: "JWT"
    };

    var payload = {
      iss: sa.client_email,
      sub: sa.client_email,
      aud: "https://oauth2.googleapis.com/token",
      iat: iat,
      exp: exp,
      target_audience: targetAudience
    };

    var headerEncoded = base64UrlEncode_(JSON.stringify(header));
    var payloadEncoded = base64UrlEncode_(JSON.stringify(payload));
    var signInput = headerEncoded + "." + payloadEncoded;

    // Normalize private key newlines if escaped
    var normalizedKey = sa.private_key.replace(/\\n/g, "\n");

    // Sign using Utilities.computeRsaSha256Signature
    var signatureBytes = Utilities.computeRsaSha256Signature(signInput, normalizedKey);
    var signatureEncoded = base64UrlEncode_(signatureBytes);

    var assertionJwt = signInput + "." + signatureEncoded;

    // Exchange assertion for Google-signed OIDC ID Token
    var tokenEndpoint = "https://oauth2.googleapis.com/token";
    var tokenPayload = {
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: assertionJwt
    };

    var response = UrlFetchApp.fetch(tokenEndpoint, {
      method: "post",
      contentType: "application/x-www-form-urlencoded",
      payload: tokenPayload,
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) {
      throw new Error("Failed to obtain OIDC ID Token (" + response.getResponseCode() + "): " + response.getContentText());
    }

    var tokenData = JSON.parse(response.getContentText());
    var idToken = tokenData.id_token;

    // Cache the ID token
    scriptProps.setProperty("CACHED_ID_TOKEN", idToken);
    scriptProps.setProperty("CACHED_ID_TOKEN_EXPIRY", exp.toString());

    return idToken;
  }

  /**
   * Builds the HTTP authorization headers object.
   *
   * @param {string} targetAudience - Cloud Run service URL.
   * @return {Object} Headers dictionary with Authorization if applicable.
   */
  function getAuthHeaders_(targetAudience) {
    var headers = {
      "Content-Type": "application/json",
      "User-Agent": "GAS-CloudRun-Sandbox-Runner/1.0"
    };

    var token = getIdToken_(targetAudience);
    if (token) {
      headers["Authorization"] = "Bearer " + token;
    }

    return headers;
  }

  return {
    getIdToken_: getIdToken_,
    getAuthHeaders_: getAuthHeaders_
  };

})();
