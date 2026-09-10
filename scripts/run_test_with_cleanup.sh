#!/usr/bin/env bash
# ==============================================================================
# End-to-End Test Execution with Fail-Safe Trap Cleanup
# GitHub: https://github.com/tanaikech/cloud-run-sandbox-gas
# Author: tanaike (https://github.com/tanaikech)
# Automatically cleans up all Cloud Run resources on exit, error, or Ctrl+C
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}================================================================${NC}"
echo -e "${CYAN}   Automated Test Runner with Fail-Safe Trap Cleanup            ${NC}"
echo -e "${CYAN}================================================================${NC}"

# Define cleanup function triggered on EXIT, INT, TERM, ERR
cleanup() {
    local exit_code=$?
    # Immediately disarm all traps to prevent recursive duplicate execution
    trap - EXIT INT TERM ERR
    echo ""
    echo -e "${YELLOW}----------------------------------------------------------------${NC}"
    echo -e "${YELLOW}[TRAP] Triggering fail-safe cleanup handler (Exit Code: ${exit_code})...${NC}"
    echo -e "${YELLOW}----------------------------------------------------------------${NC}"
    bash "${SCRIPT_DIR}/cleanup.sh" || true
    echo -e "${GREEN}[TRAP] Cleanup finished. All cloud and local resources released.${NC}"
    exit "${exit_code}"
}

# Register traps
trap cleanup EXIT INT TERM ERR

# Step 1: Run local smoke tests first
echo -e "\n${BLUE}[Phase A] Running local validation tests...${NC}"
if command -v python3 &> /dev/null; then
    python3 -c "import fastapi, uvicorn, pydantic" 2>/dev/null || {
        echo "Installing temporary local test dependencies..."
        pip install -q -r "${ROOT_DIR}/cloud_run/requirements.txt" httpx pytest || true
    }
    python3 "${ROOT_DIR}/cloud_run/test_local.py"
fi

# Step 2: Deploy Cloud Run Service
echo -e "\n${BLUE}[Phase B] Deploying temporary Cloud Run instance...${NC}"
bash "${ROOT_DIR}/cloud_run/deploy.sh"

# Step 3: Run verify_curl.sh against the deployed Cloud Run instance
echo -e "\n${BLUE}[Phase C] Running end-to-end curl verification tests...${NC}"
bash "${SCRIPT_DIR}/verify_curl.sh"

echo -e "\n${GREEN}All automated tests completed successfully!${NC}"
echo -e "Trap handler will now automatically delete the Cloud Run instance and images."
