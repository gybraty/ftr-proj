#!/usr/bin/env bash
# Recreate the whole postgres stack (both StatefulSets + PVCs), then re-seed.
set -euo pipefail
cd "$(dirname "$0")/.."
N="kubectl -n university"
$N delete statefulset -l app=postgres --wait=true --ignore-not-found
$N delete pvc -l app=postgres --wait=true --ignore-not-found
$N delete pod -l app=postgres --wait=true --ignore-not-found
kubectl apply -f k8s/university/postgres.yaml
$N rollout status statefulset/postgres-primary --timeout=180s
$N rollout status statefulset/postgres-replica --timeout=180s
DATABASE_URL=postgres://ftr:ftr@127.0.0.1:30432/university pnpm --filter @ftr/scripts seed
