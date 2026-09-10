#!/usr/bin/env bash
# ==============================================================================
# Cloud Run Sandboxes One-Click Deployment Script
# GitHub: https://github.com/tanaikech/cloud-run-sandbox-gas
# Author: tanaike (https://github.com/tanaikech)
# Compliant with Zero-Cost & Fail-Safe Architecture
# ==============================================================================
set -euo pipefail

# Color codes for terminal UI
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}======================================================${NC}"
echo -e "${CYAN}   Cloud Run Sandboxes Deployment                     ${NC}"
echo -e "${CYAN}======================================================${NC}"

# Configuration parameters with fallback defaults
SERVICE_NAME="${SERVICE_NAME:-cr-gas-sandbox}"
REGION="${REGION:-us-central1}"
ALLOW_UNAUTH="${ALLOW_UNAUTH:-true}"

# Step 1: Check gcloud CLI
if ! command -v gcloud &> /dev/null; then
    echo -e "${RED}[ERROR] Google Cloud SDK ('gcloud') is not installed or not in PATH.${NC}"
    echo "Please install Google Cloud SDK: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Step 2: Resolve Project ID
PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
if [ -z "${PROJECT_ID}" ] || [ "${PROJECT_ID}" = "(unset)" ]; then
    if [ -t 0 ]; then
        echo -e "${YELLOW}[WARN] No active GCP project detected via gcloud.${NC}"
        read -rp "Please enter your GCP Project ID: " PROJECT_ID
    fi
    if [ -z "${PROJECT_ID:-}" ] || [ "${PROJECT_ID:-}" = "(unset)" ]; then
        echo -e "${RED}[ERROR] No GCP active project specified.${NC}"
        echo "Please specify via: PROJECT_ID=your-project-id bash cloud_run/deploy.sh"
        echo "Or set globally:   gcloud config set project your-project-id"
        exit 1
    fi
fi

echo -e "${BLUE}Target Project :${NC} ${PROJECT_ID}"
echo -e "${BLUE}Target Region  :${NC} ${REGION}"
echo -e "${BLUE}Service Name   :${NC} ${SERVICE_NAME}"
echo -e "${BLUE}Auth Policy    :${NC} $([ "$ALLOW_UNAUTH" = "true" ] && echo "Public (--allow-unauthenticated)" || echo "Private (IAM Auth Required)")"
echo ""

# Set CLOUDSDK_BILLING_QUOTA_PROJECT for this script execution only
# (This completely preserves your global gcloud configuration intact without modification)
export CLOUDSDK_BILLING_QUOTA_PROJECT="${PROJECT_ID}"

# Step 3: Verify / Enable Cloud Run, Cloud Build, and Artifact Registry APIs
echo -e "${YELLOW}[1/4] Checking required GCP APIs...${NC}"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com --project="${PROJECT_ID}" --quiet

# Step 3.5: Ensure Compute Engine default service account has build permissions
# (GCP default policies now require explicit storage.objectViewer and artifactregistry.writer for Cloud Build)
echo -e "${YELLOW}[1.5/4] Verifying Cloud Build service account permissions...${NC}"
PROJECT_NUMBER=$(gcloud projects describe "${PROJECT_ID}" --format="value(projectNumber)" 2>/dev/null || true)
if [ -n "${PROJECT_NUMBER}" ]; then
    COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
    for role in "roles/storage.objectViewer" "roles/logging.logWriter" "roles/artifactregistry.writer"; do
        gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
            --member="serviceAccount:${COMPUTE_SA}" \
            --role="${role}" \
            --condition=None \
            --quiet &> /dev/null || true
    done
fi

# Step 4: Ensure gcloud beta components are ready
echo -e "${YELLOW}[2/4] Ensuring gcloud beta components...${NC}"
if ! gcloud beta --version &> /dev/null; then
    echo -e "${YELLOW}Installing or verifying gcloud beta component...${NC}"
    gcloud components install beta --quiet 2>/dev/null || {
        echo -e "${YELLOW}[NOTE] If using packaged gcloud (e.g. apt), install via: sudo apt-get install google-cloud-cli-beta${NC}"
    }
fi

# Step 5: Change directory to cloud_run directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

# Step 6: Deploy with Zero-Cost & Fail-Safe options
echo -e "${YELLOW}[3/4] Deploying to Cloud Run with --sandbox-launcher...${NC}"

AUTH_FLAG="--allow-unauthenticated"
if [ "${ALLOW_UNAUTH}" != "true" ]; then
    AUTH_FLAG="--no-allow-unauthenticated"
fi

# Deploy command applying all strict cost-control and isolation constraints:
# - execution-environment gen2 : Required for gVisor sandbox launcher
# - sandbox-launcher           : Injects /usr/local/gcp/bin/sandbox
# - min-instances 0            : Zero cost when idle (scales to 0)
# - max-instances 1            : Strictly prevents burst billing explosion
# - timeout 15s                : Quick fail-safe termination against infinite loops
# - memory 512Mi / cpu 1       : Ultra-low compute resource profile
gcloud beta run deploy "${SERVICE_NAME}" \
    --source=. \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --platform=managed \
    --execution-environment=gen2 \
    --sandbox-launcher \
    --min-instances=0 \
    --max-instances=1 \
    --timeout=15s \
    --memory=512Mi \
    --cpu=1 \
    ${AUTH_FLAG} \
    --quiet

# Step 7: Clean temporary build source bucket to maintain zero-garbage hygiene
GCS_TEMP_BUCKET="gs://run-sources-${PROJECT_ID}-${REGION}"
if gcloud storage ls "${GCS_TEMP_BUCKET}" &> /dev/null; then
    gcloud storage rm --recursive "${GCS_TEMP_BUCKET}" --quiet &> /dev/null || true
fi

# Step 8: Retrieve Service URL
echo -e "${YELLOW}[4/4] Retrieving service endpoint...${NC}"
SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --format='value(status.url)')

echo ""
echo -e "${GREEN}======================================================${NC}"
echo -e "${GREEN}   Deployment Successful!                             ${NC}"
echo -e "${GREEN}======================================================${NC}"
echo -e "${CYAN}Service URL:${NC} ${SERVICE_URL}"
echo ""
echo -e "${BLUE}Quick Smoke Test Commands:${NC}"
echo -e "1. Health Check:"
echo -e "   ${YELLOW}curl -s ${SERVICE_URL}/ | jq .${NC}"
echo ""
echo -e "2. Execute Python Expression (2**32):"
echo -e "   ${YELLOW}curl -s -X POST ${SERVICE_URL}/run \\${NC}"
echo -e "   ${YELLOW}     -H 'Content-Type: application/json' \\${NC}"
echo -e "   ${YELLOW}     -d '{\"code\": \"print(2**32)\"}' | jq .${NC}"
echo ""
echo -e "3. Probe Metadata Isolation (SSRF Test):"
echo -e "   ${YELLOW}curl -s -X POST ${SERVICE_URL}/test/metadata-isolation | jq .${NC}"
echo ""
echo -e "${GREEN}Done.${NC}"
