#!/usr/bin/env bash
# ==============================================================================
# Cloud Run Sandboxes Complete Purge & Cleanup Script
# GitHub: https://github.com/tanaikech/cloud-run-sandbox-gas
# Author: tanaike (https://github.com/tanaikech)
# Compliant with Zero-Cost & Clean State Architecture
# ==============================================================================
set -uo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}======================================================${NC}"
echo -e "${CYAN}   Cloud Run Sandboxes Complete Cleanup               ${NC}"
echo -e "${CYAN}======================================================${NC}"

SERVICE_NAME="${SERVICE_NAME:-cr-gas-sandbox}"
REGION="${REGION:-us-central1}"
PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"

if [ -z "${PROJECT_ID}" ] || [ "${PROJECT_ID}" = "(unset)" ]; then
    if [ -t 0 ]; then
        echo -e "${YELLOW}[WARN] No active GCP project detected via gcloud.${NC}"
        read -rp "Please enter your GCP Project ID: " PROJECT_ID
    else
        echo -e "${RED}[ERROR] No active GCP project found and standard input is non-interactive.${NC}"
        echo "Please set PROJECT_ID environment variable: export PROJECT_ID=<YOUR_PROJECT_ID>"
        exit 1
    fi
fi

echo -e "${BLUE}Target Project :${NC} ${PROJECT_ID}"
echo -e "${BLUE}Target Region  :${NC} ${REGION}"
echo -e "${BLUE}Service Name   :${NC} ${SERVICE_NAME}"
echo ""

# Set CLOUDSDK_BILLING_QUOTA_PROJECT for this script only (preserves global config)
export CLOUDSDK_BILLING_QUOTA_PROJECT="${PROJECT_ID}"

# ------------------------------------------------------------------------------
# 1. Delete Cloud Run Service
# ------------------------------------------------------------------------------
echo -e "${YELLOW}[1/3] Checking and deleting Cloud Run service...${NC}"
if gcloud run services describe "${SERVICE_NAME}" --project="${PROJECT_ID}" --region="${REGION}" &> /dev/null; then
    echo "Deleting Cloud Run service '${SERVICE_NAME}'..."
    gcloud run services delete "${SERVICE_NAME}" \
        --project="${PROJECT_ID}" \
        --region="${REGION}" \
        --quiet
    echo -e "${GREEN}Cloud Run service '${SERVICE_NAME}' deleted successfully.${NC}"
else
    echo "Cloud Run service '${SERVICE_NAME}' does not exist. (Skipping)"
fi

# ------------------------------------------------------------------------------
# 2. Delete Container Images from Artifact Registry
# ------------------------------------------------------------------------------
echo -e "${YELLOW}[2/3] Checking and purging Artifact Registry container images...${NC}"
REPO_NAME="cloud-run-source-deploy"
IMAGE_PATH="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/${SERVICE_NAME}"

if command -v gcloud &> /dev/null; then
    echo "Searching for images under '${IMAGE_PATH}'..."
    # Attempt to delete the container images if present
    IMAGE_DIGESTS=$(gcloud artifacts docker images list "${IMAGE_PATH}" --format="value(DIGEST)" 2>/dev/null || true)
    if [ -n "${IMAGE_DIGESTS}" ]; then
        for digest in ${IMAGE_DIGESTS}; do
            echo "Deleting container image: ${IMAGE_PATH}@${digest}"
            gcloud artifacts docker images delete "${IMAGE_PATH}@${digest}" --delete-tags --quiet || true
        done
        echo -e "${GREEN}Artifact Registry images purged successfully.${NC}"
    else
        echo "No images found under '${IMAGE_PATH}'. (Skipping)"
    fi

    # Check and delete the repository itself to leave zero remnants
    if gcloud artifacts repositories describe "${REPO_NAME}" --location="${REGION}" --project="${PROJECT_ID}" &> /dev/null; then
        echo "Deleting Artifact Registry repository '${REPO_NAME}'..."
        gcloud artifacts repositories delete "${REPO_NAME}" --location="${REGION}" --project="${PROJECT_ID}" --quiet || true
        echo -e "${GREEN}Artifact Registry repository '${REPO_NAME}' deleted.${NC}"
    fi
fi

# ------------------------------------------------------------------------------
# 2.5 Delete Cloud Storage Build Cache Buckets (run-sources-*)
# ------------------------------------------------------------------------------
echo -e "${YELLOW}[2.5/3] Checking and purging temporary Cloud Storage build buckets...${NC}"
GCS_BUCKET="gs://run-sources-${PROJECT_ID}-${REGION}"
if gcloud storage ls "${GCS_BUCKET}" &> /dev/null; then
    echo "Purging temporary source bucket '${GCS_BUCKET}'..."
    gcloud storage rm --recursive "${GCS_BUCKET}" --quiet || true
    echo -e "${GREEN}Cloud Storage bucket '${GCS_BUCKET}' purged successfully.${NC}"
else
    echo "No temporary build bucket '${GCS_BUCKET}' found. (Skipping)"
fi


# ------------------------------------------------------------------------------
# 3. Clean local temporary files & caches
# ------------------------------------------------------------------------------
echo -e "${YELLOW}[3/3] Cleaning local temporary files and python caches...${NC}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

find "${ROOT_DIR}" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
find "${ROOT_DIR}" -type f -name "*.pyc" -delete 2>/dev/null || true
find "${ROOT_DIR}" -type d -name ".pytest_cache" -exec rm -rf {} + 2>/dev/null || true

echo -e "${GREEN}======================================================${NC}"
echo -e "${GREEN}   Cleanup Complete! Environment is 100% Clean.       ${NC}"
echo -e "${GREEN}======================================================${NC}"
