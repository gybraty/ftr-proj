# Live demonstration script

Everything runs from the terminal: faults are injected with `curl` against the services' `/chaos` endpoints and with `kubectl`/`docker`; recovery is watched with `kubectl get pods -w` and a one-line request loop.

Timings below were measured in a dry-run against the live kind cluster (API level). The underlying mechanisms are unchanged by the terminal-driven rewrite, so they still hold.

## Setup (shell helpers, paste once)

```bash
cd <repo root>
NS="kubectl -n university"
TOKEN="x-chaos-token: dev-chaos-token"
DEPLOYS="deploy/gateway deploy/student-service deploy/payment-service deploy/records-service deploy/timetable-service"
ft()    { kubectl -n university set env $DEPLOYS FT_MODE=$1; }        # ft on | ft off
scale() { for d in $DEPLOYS; do kubectl -n university scale $d --replicas=$1; done; }
reset() { pnpm --filter @ftr/experiments exp reset; }
probe() { while true; do curl -s -o /dev/null -w "%{http_code} " "http://127.0.0.1:30080$1"; sleep 1; done; }
pays()  { kubectl -n university exec postgres-primary-0 -- psql -U ftr -d university \
          -c "SELECT id, student_id, amount, status FROM payment.payments ORDER BY id DESC LIMIT 5"; }
```

## Rules of thumb (read first)

- **`ft on|off` rolls every service pod.** After flipping it, wait until `$NS get pods` shows all pods Running (~30s): `$NS rollout status deploy/gateway` etc., or just watch. Skipping this makes the next fault land on a terminating pod and give misleading results.
- Between scenes run `reset` (truncates + reseeds data, clears chaos latency/fail-midway, restarts nothing). It does NOT change `FT_MODE` or replicas, so set those explicitly each scene.
- Never demo while the experiment matrix is running.

## Pre-demo checklist

1. `./scripts/up.sh` finished; `kubectl get nodes` shows 4 Ready nodes; `$NS get pods` all Running.
2. `ft on`, `scale 3` or `scale 1` as the first scene needs; wait for rollout.
3. `reset` once.
4. Docker disk: at least 15GB free (`df -h`, `docker system df`).

---

## Scene 1: Zero-downtime crash (FT ON, 3 replicas)

**Start:** `ft on && scale 3`, wait for pods Running, `reset`.
**Show:** terminal A: `probe /api/transcripts/1` (stream of `200`). Terminal B: `$NS get pods -w`.

1. Crash one records instance: `curl -X POST localhost:30003/chaos/crash -H "$TOKEN"`
2. Terminal B: one records pod restarts (restart counter +1 within ~15s).
3. Terminal A: the `200` stream never breaks (2 of 3 replicas keep serving).

**Narrate:** one instance dies, the Kubernetes Service load-balances to the other replicas, the gateway retries; users see nothing.
**Dry-run:** 30 consecutive transcript requests during the crash all returned 200; crashed pod back Running (restart count 1) in ~15s.
**Recover:** nothing needed. `reset` before the next scene.

## Scene 2: Baseline crash (FT OFF, 1 replica) — downtime visible

**Start:** `ft off && scale 1`, wait for pods Running, `reset`. Keep `probe /api/transcripts/1` running.

1. `curl -X POST localhost:30003/chaos/crash -H "$TOKEN"`
2. Probe stream turns to `502` (gateway can't reach records-service).
3. After ~8-10s the container restarts and the stream returns to `200`.

**Narrate:** same fault, no redundancy and no fault-tolerance mechanisms: outage until the container restarts.
**Dry-run:** gateway returned 502 for ~7-8s, direct service port refused connections, then 200.
**Recover:** none (self-heals). `reset`.

## Scene 3: Latency + circuit breaker (FT ON, 1 replica)

Use **one** records replica: with 3 replicas only one is slow, retries land on healthy pods and the breaker never opens (verified).

**Start:** `ft on && scale 1`, wait, `reset`. Breaker state: `curl -s localhost:30080/gateway/breakers` shows `records: CLOSED`.

1. Inject latency: `curl -X POST localhost:30003/chaos/latency -H "$TOKEN" -H 'content-type: application/json' -d '{"ms":5000}'`
2. Drive ~10 rps of transcripts: `for i in $(seq 1 100); do curl -s -o /dev/null -w "%{http_code} " localhost:30080/api/transcripts/1 & sleep 0.1; done`
3. First responses take ~9s then fail 502 (hang bounded by timeout + retry). After ~10s `gateway/breakers` shows `records: OPEN`.
4. From then on responses are **immediate 503s**, not 9s hangs (fail fast).
5. Clear: `curl -X POST localhost:30003/chaos/reset -H "$TOKEN"`
6. Breaker goes HALF_OPEN then **CLOSED** within ~6-10s (open window is 10s); transcripts work again.

**Narrate:** timeouts + retry bound the damage, the breaker stops hammering the sick service.
**Dry-run:** breaker CLOSED to OPEN at ~10s under 10 rps; OPEN responses 503 in ~5ms; after chaos reset CLOSED in ~6s.
**Recover:** done in step 5; `reset`.

## Scene 4: Corrupted payment (baseline) then saga recovery

**Start:** `ft off`, wait for rollout, `reset`.

1. Pay: `curl -X POST localhost:30080/api/payments -H 'content-type: application/json' -H "Idempotency-Key: demo-a" -d '{"studentId":1,"amount":500}'` — then `pays` shows one `completed` row.
2. Arm the fault: `curl -X POST localhost:30002/chaos/fail-midway -H "$TOKEN"`
3. Pay again: same curl with `Idempotency-Key: demo-b`, `"amount":700`. It fails (payment pod dies mid-transaction).
4. `pays`: the 700 row is stuck `debited` — money taken, tuition never credited. Narrate the inconsistency.
5. `ft on`, wait ~30s for rollout, then wait another ~30-45s without touching anything.
6. `pays`: the row flips to `completed`.

**Narrate:** with checkpointing the saga persists each step; the recovery job resumes from the last completed step and finishes the payment (rollback would compensate if it couldn't).
**Dry-run:** after FT on the row went `debited` to `completed` by ~31s. The fail-midway pay returns 502 and the payment pod restarts once.
**Recover:** `reset` (also clears the chaos flag).

## Scene 5: Duplicate payment

**Start:** `ft off`, wait, `reset`.

1. Pay twice with the **same** key (simulated client retry):
   ```bash
   for i in 1 2; do curl -s -X POST localhost:30080/api/payments -H 'content-type: application/json' \
     -H "Idempotency-Key: demo-dup" -d '{"studentId":2,"amount":300}' -w " %{http_code}\n"; done
   ```
2. `pays`: **two** rows (double charge). Both requests returned 201.
3. `ft on`, wait, `reset`, repeat step 1.
4. `pays`: **one** row; responses were 201 then 200 (idempotent replay returns the existing payment).

**Narrate:** same Idempotency-Key; without the idempotency mechanism the server executes both, with it the retry is a 200 replay.
**Recover:** `reset`.

## Scene 6: Node failure

**Start:** `ft on && scale 3`, wait, `reset`. Terminal B: `kubectl get nodes -w`; terminal C: `$NS get pods -o wide -w`.

1. Find a worker with no postgres pod (`$NS get pods -o wide | grep postgres`), then stop another one: `docker stop ftr-worker`
2. `probe /api/transcripts/1` keeps returning 200 (replicas on other nodes).
3. The node shows NotReady after ~45-50s; its pods are replaced on the surviving workers by ~60-70s (old ones linger as Terminating, expected). Narrate the 10s toleration configured on pods (default is 300s).
4. `docker start ftr-worker`: Ready again within ~10s; pods stay where they are.

**Dry-run:** stopped ftr-worker; transcripts 200 throughout (one blip right at the stop call); NotReady at ~50s; replacement pods Running on worker2/worker3 by ~60s; node Ready ~9s after start.
**Recover:** make sure the node is started, `reset` (it also ensures all nodes are up).

## Scene 7: Database failover

**Start:** `ft on`, `reset`. Keep `probe /api/timetables/1` running.

1. Kill the primary:
   ```bash
   kubectl -n university scale statefulset/postgres-primary --replicas=0
   kubectl -n university delete pod postgres-primary-0 --grace-period=0 --force --ignore-not-found
   ```
2. Probe stream: immediate 502s (timetable may briefly serve its stale cache first).
3. Promote the replica:
   ```bash
   kubectl -n university exec postgres-replica-0 -- su postgres -c "pg_ctl promote -D /var/lib/postgresql/data/pgdata"
   kubectl -n university label pod postgres-replica-0 db-active=true --overwrite
   ```
4. Reads recover within a few seconds; a new payment POST works within ~30s at most.
5. Heal to the original topology (~1 min): `bash scripts/db-heal.sh && kubectl -n university scale statefulset/postgres-primary --replicas=1`. Only after this is the system fully redundant again.

**Dry-run:** after kill: 502s for the whole window; after failover: requests resume within seconds; a payment POST returned 201; heal took ~70s.
**Recover:** `reset` (it also heals the DB if needed; can take minutes).

---

## After the demo

`ft on && scale 1`, chaos reset on every service (or just `reset`), then verify:
`GATEWAY_URL=http://127.0.0.1:30080 pnpm --filter @ftr/scripts smoke` prints 7/7.
