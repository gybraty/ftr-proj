import axios, { AxiosError } from 'axios';
import * as assert from 'assert';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3000';
const ax = axios.create({ baseURL: GATEWAY_URL, validateStatus: () => true });

interface CheckResult {
  name: string;
  passed: boolean;
  error?: string;
}

const checks: CheckResult[] = [];

async function check(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    checks.push({ name, passed: true });
    console.log(`✓ ${name}`);
  } catch (e: any) {
    checks.push({ name, passed: false, error: e.message });
    console.log(`✗ ${name}: ${e.message}`);
  }
}

async function smoke() {
  let studentId: number;

  // 1. POST /api/students → 201
  await check('POST /api/students → 201', async () => {
    const email = `smoke+${Date.now()}@uni.test`;
    const res = await ax.post('/api/students', { name: 'Smoke Test', email });
    assert.strictEqual(res.status, 201, `Expected 201, got ${res.status}`);
    assert.ok(res.data.id, 'Response should have id');
    studentId = res.data.id;
  });

  // 2. POST /api/enrollments (that student, course 9) → 201
  await check('POST /api/enrollments (course 9) → 201', async () => {
    const res = await ax.post('/api/enrollments', { studentId, courseId: 9 });
    assert.strictEqual(res.status, 201, `Expected 201, got ${res.status}`);
  });

  // 3. Same again → 409
  await check('Duplicate enrollment → 409', async () => {
    const res = await ax.post('/api/enrollments', { studentId, courseId: 9 });
    assert.strictEqual(res.status, 409, `Expected 409, got ${res.status}`);
  });

  // 4. Payment idempotency: POST with key K -> 201; repeat with K -> 200 same payment id
  await check('Payment idempotency: POST then repeat -> 201 then 200 same id', async () => {
    const headers = { 'Idempotency-Key': `smoke-${Date.now()}-${Math.random().toString(36).slice(2)}` };
    const res1 = await ax.post('/api/payments', { studentId, amount: 500 }, { headers });
    assert.strictEqual(res1.status, 201, `Expected 201 for first request, got ${res1.status}`);
    assert.ok(res1.data.id, 'Response should have payment id');
    const res2 = await ax.post('/api/payments', { studentId, amount: 500 }, { headers });
    assert.strictEqual(res2.status, 200, `Expected 200 for repeat, got ${res2.status}`);
    assert.strictEqual(res2.data.id, res1.data.id, 'Should return same payment id');
  });

  // 5. GET /api/transcripts/1 → 200, body has numeric gpa
  await check('GET /api/transcripts/1 → 200 with gpa', async () => {
    const res = await ax.get('/api/transcripts/1');
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    assert.ok(typeof res.data.gpa === 'number', 'Response should have numeric gpa');
  });

  // 6. GET /api/timetables/1 → 200, non-empty array
  await check('GET /api/timetables/1 → 200 non-empty', async () => {
    const res = await ax.get('/api/timetables/1');
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    assert.ok(Array.isArray(res.data), 'Response should be an array');
    assert.ok(res.data.length > 0, 'Timetable array should not be empty');
  });

  // 7. GET /health on gateway → 200
  await check('GET /health → 200', async () => {
    const res = await ax.get('/health');
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
  });

  // Summary
  const passed = checks.filter(c => c.passed).length;
  const total = checks.length;
  console.log(`\n${passed}/${total} checks passed`);

  if (passed < total) {
    const failed = checks.filter(c => !c.passed);
    console.log('\nFailed checks:');
    failed.forEach(c => console.log(`  - ${c.name}: ${c.error}`));
    process.exit(1);
  }

  process.exit(0);
}

smoke().catch((e) => {
  console.error('Smoke test failed:', e);
  process.exit(1);
});
