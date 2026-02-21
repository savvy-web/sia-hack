#!/usr/bin/env bash
#
# Rebuild and redeploy Oracle after code changes.
# Re-uses existing Cloud Run Service + Job configuration.
#
# Usage: ./deploy/deploy.sh

set -euo pipefail

PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
REGION="us-central1"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/oracle/oracle:latest"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "${SCRIPT_DIR}")"

echo "=== Oracle Redeploy ==="
echo "Project: ${PROJECT_ID}"
echo ""

# Build and push
echo "[1/3] Building Docker image..."
cd "${REPO_ROOT}"
docker build --platform linux/amd64 -t "${IMAGE}" .

echo "[2/3] Pushing to Artifact Registry..."
docker push "${IMAGE}"

# Update both services
echo "[3/3] Updating Cloud Run..."
gcloud run deploy oracle-agent \
  --image="${IMAGE}" \
  --region="${REGION}" \
  --quiet &

gcloud run jobs update oracle-ingestion \
  --image="${IMAGE}" \
  --region="${REGION}" \
  --quiet &

wait

AGENT_URL=$(gcloud run services describe oracle-agent --region="${REGION}" --format='value(status.url)')
echo ""
echo "=== Deploy Complete ==="
echo "Agent: ${AGENT_URL}"
