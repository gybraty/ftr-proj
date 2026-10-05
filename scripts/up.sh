#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

APPS=(gateway student-service payment-service records-service timetable-service)

kind get clusters | grep -qx ftr || kind create cluster --config k8s/kind-config.yaml

# Build images only for apps that exist
for app in "${APPS[@]}"; do
  docker build -f docker/node-service.Dockerfile --build-arg APP="$app" -t "ftr/$app:dev" .
done

# Load images with simple loop
for app in "${APPS[@]}"; do
  [ -d "apps/$app" ] && kind load docker-image "ftr/$app:dev" --name ftr
done

kubectl apply -f k8s/namespaces.yaml
kubectl -n university create secret generic chaos-token --from-literal=token="${CHAOS_TOKEN:-dev-chaos-token}" --dry-run=client -o yaml | kubectl apply -f -
kubectl -n control create secret generic chaos-token --from-literal=token="${CHAOS_TOKEN:-dev-chaos-token}" --dry-run=client -o yaml | kubectl apply -f -

# Apply manifests only if directories exist
[ -d k8s/university ] && kubectl apply -R -f k8s/university
[ -d k8s/control ] && kubectl apply -R -f k8s/control

# Wait for rollouts, guarding on resource existence
if kubectl -n university get statefulset/postgres-primary >/dev/null 2>&1; then
  kubectl -n university rollout status statefulset/postgres-primary --timeout=180s
fi
if kubectl -n university get statefulset/postgres-replica >/dev/null 2>&1; then
  kubectl -n university rollout status statefulset/postgres-replica --timeout=180s
fi
for app in "${APPS[@]}"; do
  kubectl -n university rollout status "deploy/$app" --timeout=120s
done

# Seed and smoke - skip if postgres not present
if ! kubectl -n university get statefulset/postgres-primary >/dev/null 2>&1; then
  echo "no postgres yet — skipping seed/smoke"
  exit 0
fi

DATABASE_URL=postgres://ftr:ftr@127.0.0.1:30432/university pnpm --filter @ftr/scripts seed
GATEWAY_URL=http://127.0.0.1:30080 pnpm --filter @ftr/scripts smoke
echo "FTR cluster up."
