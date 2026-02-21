#!/usr/bin/env bash
#
# One-time GCP setup for Oracle: Artifact Registry, Cloud Run Service + Job, Cloud Scheduler.
#
# Prerequisites:
#   - gcloud CLI installed and authenticated
#   - Docker installed
#   - .env file at repo root with: DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASS, ANTHROPIC_API_KEY
#
# Usage: ./deploy/setup.sh

set -euo pipefail

PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
REGION="us-central1"
REPO="oracle"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/oracle:latest"

echo "=== Oracle GCP Setup ==="
echo "Project: ${PROJECT_ID}"
echo "Region:  ${REGION}"
echo ""

# ---- Load env vars from .env ----
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "${SCRIPT_DIR}")"

load_env() {
  local env_file="$1"
  if [[ -f "${env_file}" ]]; then
    echo "Loading env from ${env_file}"
    set -a
    # shellcheck source=/dev/null
    source "${env_file}"
    set +a
  fi
}

load_env "${REPO_ROOT}/.env"
load_env "${REPO_ROOT}/pkgs/lightdash/.env"

# Verify required vars
for var in DB_HOST DB_USER DB_PASS ANTHROPIC_API_KEY; do
  if [[ -z "${!var:-}" ]]; then
    echo "ERROR: Missing required env var: ${var}"
    exit 1
  fi
done

DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-postgres}"

AUTH_PASSWORD="${AUTH_PASSWORD:-sia-hack-feb21}"
ENV_VARS="DB_HOST=${DB_HOST},DB_PORT=${DB_PORT},DB_NAME=${DB_NAME},DB_USER=${DB_USER},DB_PASS=${DB_PASS},ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY},AUTH_PASSWORD=${AUTH_PASSWORD}"

# ---- Step 1: Enable APIs ----
echo "[1/6] Enabling GCP APIs..."
gcloud services enable \
  artifactregistry.googleapis.com \
  run.googleapis.com \
  cloudscheduler.googleapis.com \
  cloudbuild.googleapis.com \
  --quiet

# ---- Step 2: Create Artifact Registry repo ----
echo "[2/6] Creating Artifact Registry repo..."
gcloud artifacts repositories create "${REPO}" \
  --repository-format=docker \
  --location="${REGION}" \
  --quiet 2>/dev/null || echo "  (repo already exists)"

# Configure docker auth
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

# ---- Step 3: Build and push ----
echo "[3/6] Building and pushing Docker image..."
cd "${REPO_ROOT}"
docker build --platform linux/amd64 -t "${IMAGE}" .
docker push "${IMAGE}"

# ---- Step 4: Deploy Cloud Run Service (agent) ----
echo "[4/6] Deploying Cloud Run Service (oracle-agent)..."
gcloud run deploy oracle-agent \
  --image="${IMAGE}" \
  --region="${REGION}" \
  --platform=managed \
  --memory=512Mi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=3 \
  --timeout=300 \
  --set-env-vars="${ENV_VARS}" \
  --allow-unauthenticated \
  --quiet

AGENT_URL=$(gcloud run services describe oracle-agent --region="${REGION}" --format='value(status.url)')
echo "  Agent URL: ${AGENT_URL}"

# ---- Step 5: Deploy Cloud Run Job (ingestion) ----
echo "[5/6] Deploying Cloud Run Job (oracle-ingestion)..."
gcloud run jobs create oracle-ingestion \
  --image="${IMAGE}" \
  --region="${REGION}" \
  --memory=512Mi \
  --cpu=1 \
  --task-timeout=600 \
  --set-env-vars="${ENV_VARS},SKIP_SNAPSHOTS=true" \
  --command="bun" \
  --args="run,pkgs/ingestion/src/ingest.ts" \
  --quiet 2>/dev/null || \
gcloud run jobs update oracle-ingestion \
  --image="${IMAGE}" \
  --region="${REGION}" \
  --memory=512Mi \
  --cpu=1 \
  --task-timeout=600 \
  --set-env-vars="${ENV_VARS},SKIP_SNAPSHOTS=true" \
  --command="bun" \
  --args="run,pkgs/ingestion/src/ingest.ts" \
  --quiet

# ---- Step 6: Create Cloud Scheduler ----
echo "[6/6] Creating Cloud Scheduler job..."
SA_EMAIL="$(gcloud iam service-accounts list --filter='displayName:Default compute' --format='value(email)' | head -1)"
if [[ -z "${SA_EMAIL}" ]]; then
  SA_EMAIL="${PROJECT_ID}@appspot.gserviceaccount.com"
fi

gcloud scheduler jobs create http oracle-ingestion-schedule \
  --location="${REGION}" \
  --schedule="*/5 * * * *" \
  --uri="https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${PROJECT_ID}/jobs/oracle-ingestion:run" \
  --http-method=POST \
  --oauth-service-account-email="${SA_EMAIL}" \
  --quiet 2>/dev/null || echo "  (scheduler job already exists)"

echo ""
echo "=== Setup Complete ==="
echo "Agent:      ${AGENT_URL}"
echo "Ingestion:  gcloud run jobs execute oracle-ingestion --region=${REGION}"
echo "Scheduler:  Every 5 minutes"
