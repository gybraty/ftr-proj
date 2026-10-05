# FTR: Fault-Tolerant University Information System

A course project: a small university information system (students, enrollments, payments, transcripts, timetables) running on a local multi-node Kubernetes (kind) cluster. Every fault-tolerance (FT) mechanism can be toggled per deployment via the `FT_MODE` environment variable, so the same workload can be run as a **baseline** (FT off) and as **FT** (FT on) under injected failures, and the two compared on availability, latency and error rate.

## Architecture

The system has two planes. The **university plane** (namespace `university`) holds the gateway, the four domain services and PostgreSQL (primary + replica). The **control plane** (namespace `control`) holds Prometheus; the host-side experiment runner (`experiments/run.ts`) drives load, failure injection and measurement from outside the cluster. Keeping them apart limits the blast radius: injected failures hit only the university plane, while metrics stay reachable to observe and recover it.

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | >= 20 |
| pnpm | >= 9 (via `corepack enable`) |
| Docker Desktop | recent; >= 20 GB free disk for images |
| kind | >= 0.23 (built with 0.33) |
| kubectl | matching the cluster |

## Quickstart

```bash
pnpm install
./scripts/up.sh    # ~3-5 min
```

`up.sh` creates the kind cluster `ftr` (1 control-plane + 3 workers) if missing, builds and loads the `ftr/*:dev` images, applies `k8s/`, waits for rollouts, seeds the database and runs a 7-check smoke test. It exits non-zero on failure.

Teardown: `./scripts/down.sh`

## Ports

| Port | What |
|------|------|
| 30080 | gateway (API entry point) |
| 30001 | student-service |
| 30002 | payment-service |
| 30003 | records-service |
| 30004 | timetable-service |
| 30432 | PostgreSQL primary |
| 30090 | Prometheus |

## Fault-tolerance mechanisms

Software (all toggled together by `FT_MODE=on|off` on each deployment, read via `libs/resilience/src/flags-client.ts`; the experiment runner flips it with `kubectl set env`):

| Mechanism | Effect | Where |
|------|--------|-------|
| `retry` | retry failed downstream calls with backoff | `libs/resilience/src/retry.ts` |
| `timeout` | bound downstream call time | `libs/resilience/src/timeout.ts` |
| `circuitBreaker` | fail fast on repeatedly failing dependencies | `libs/resilience/src/circuit-breaker.ts` |
| `idempotency` | repeated payments/enrollments are safe | `apps/payment-service/src/saga.ts`, `recovery.ts` |
| `checkpointing` | recover half-finished payment transactions | `apps/payment-service/src/saga.ts`, `recovery.ts` |
| `gracefulDegradation` | stale cache / queued writes when a dependency is down | `apps/timetable-service/src/timetable.service.ts` (stale cache), `apps/records-service` (202 queued) |
| `healthChecks` | health endpoints for readiness/liveness | `libs/resilience/src/health.controller.ts` |

Hardware/infrastructure:

| Mechanism | Where |
|-----------|-------|
| 1. Service replication: Deployment replicas 1 to 3 | `k8s/university/*.yaml` |
| 2. Database replication: Postgres primary + streaming replica, failover by promote + label flip | `k8s/university/postgres.yaml` |
| 3. Load balancing: k8s Service round-robin across replicas + API gateway | `k8s/university/*.yaml` |
| 4. Node redundancy: 3 kind workers, pods reschedule on node loss (10s tolerations) | `k8s/kind-config.yaml` |

Documented only: RAID and ECC (see report, hardware section).

## Experiments

Scenarios: `app-crash`, `db-failure`, `network-timeout`, `node-failure`, `corrupted-tx`, `high-load`; each runs with `ft: true|false`.

```bash
pnpm --filter @ftr/experiments exp matrix             # all scenarios, both modes (~1 h)
pnpm --filter @ftr/experiments exp app-crash ft       # one scenario, one mode (baseline|ft|both)
```

Each run resets the DB, sets `FT_MODE` and replica counts, warms up under load (30 rps), injects the fault, observes for 90-120 s, then checks payment-data consistency. Results land in `experiments/results/` as one JSON per run (full request/health records plus a summary with detection time, recovery time, availability, duplicates, inconsistencies).

## Repo map

| Path | Contents |
|------|----------|
| `apps/gateway` | API gateway |
| `apps/student-service`, `payment-service`, `records-service`, `timetable-service` | domain services |
| `libs/resilience` | retry, timeout, circuit breaker, chaos, metrics |
| `experiments/` | host-side experiment runner (`run.ts`) and results |
| `k8s/` | kind config and manifests (`university/`, `control/`) |
| `docker/` | Dockerfile |
| `scripts/` | `up.sh`, `down.sh`, `db-heal.sh`, DB seed and smoke |
| `docs/` | demo script |

## Troubleshooting

- **Code changes have no effect:** images are tagged `:dev` and loaded into kind; run `./scripts/down.sh && ./scripts/up.sh`.
- **Disk pressure / ImagePullBackOff / evictions:**
  ```bash
  docker builder prune -af
  for n in ftr-control-plane ftr-worker ftr-worker2 ftr-worker3; do docker exec $n crictl rmi --prune; done
  ```
- **Broken cluster:** `kind delete cluster --name ftr && ./scripts/up.sh`.

## Known limitations

- Single-machine kind cluster: "nodes" are containers sharing one host, so results show relative, not absolute, behavior.
- The payment gateway is mocked.
- Prometheus keeps 2 hours of data and is not persistent; it resets with the cluster.
