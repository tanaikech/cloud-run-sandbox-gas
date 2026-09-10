#!/usr/bin/env bash
# ==============================================================================
# verify_curl.sh - Quick CLI Smoke & Probe Verification
# GitHub: https://github.com/tanaikech/cloud-run-sandbox-gas
# Author: tanaike (https://github.com/tanaikech)
# ==============================================================================
set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-cr-gas-sandbox}"
REGION="${REGION:-us-central1}"
PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}Retrieving Cloud Run endpoint...${NC}"
SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --format='value(status.url)')

echo -e "${BLUE}Testing Service URL:${NC} ${SERVICE_URL}\n"

echo -e "${YELLOW}=== Test 1: Health Check (GET /) ===${NC}"
curl -s -w "\nHTTP Code: %{http_code} | Total Time: %{time_total}s\n" "${SERVICE_URL}/"

echo -e "\n${YELLOW}=== Test 2: Python Code Execution (2**32) ===${NC}"
curl -s -X POST "${SERVICE_URL}/run" \
    -H "Content-Type: application/json" \
    -d '{"language": "python", "code": "print(2**32)", "timeout_sec": 5.0}' \
    -w "\nHTTP Code: %{http_code} | Total Time: %{time_total}s\n"

echo -e "\n${YELLOW}=== Test 3: Metadata Server SSRF Isolation Probe ===${NC}"
curl -s -X POST "${SERVICE_URL}/test/metadata-isolation" \
    -w "\nHTTP Code: %{http_code} | Total Time: %{time_total}s\n"

echo -e "\n${YELLOW}=== Test 4: Environment Variable Masking Probe ===${NC}"
curl -s -X POST "${SERVICE_URL}/test/env-isolation" \
    -w "\nHTTP Code: %{http_code} | Total Time: %{time_total}s\n"

echo -e "\n${YELLOW}=== Test 5: Filesystem Isolation Probe ===${NC}"
curl -s -X POST "${SERVICE_URL}/test/fs-isolation" \
    -w "\nHTTP Code: %{http_code} | Total Time: %{time_total}s\n"

echo -e "\n${YELLOW}=== Test 6: Network Egress Isolation Probe ===${NC}"
curl -s -X POST "${SERVICE_URL}/test/egress-isolation" \
    -w "\nHTTP Code: %{http_code} | Total Time: %{time_total}s\n"

echo -e "\n${GREEN}Smoke verification complete.${NC}"
