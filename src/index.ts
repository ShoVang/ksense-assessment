/* eslint-disable no-console */

const BASE_URL = "https://assessment.ksensetech.com/api";
const API_KEY = process.env.YOUR_API_KEY;

if (!API_KEY) {
  throw new Error("Missing YOUR_API_KEY env var.");
}

// -----------------------------
// Types
// -----------------------------
type Patient = {
  patient_id: string;
  name?: string;
  age?: number | string | null;
  gender?: string | null;
  blood_pressure?: string | null;
  temperature?: number | string | null;
  visit_date?: string | null;
  diagnosis?: string | null;
  medications?: string | null;
};

type PatientsResponse = {
  data: Patient[] | unknown; // API can be inconsistent
  pagination?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
    hasNext?: boolean;
    hasPrevious?: boolean;
  };
  metadata?: unknown;
};

// -----------------------------
// Helpers
// -----------------------------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function toFiniteNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function parseBloodPressure(bp: unknown): { sys: number; dia: number } | null {
  if (!isNonEmptyString(bp)) return null;
  const parts = bp.split("/");
  if (parts.length !== 2) return null;

  const sysStr = parts[0]?.trim();
  const diaStr = parts[1]?.trim();
  if (!sysStr || !diaStr) return null;

  const sys = toFiniteNumber(sysStr);
  const dia = toFiniteNumber(diaStr);
  if (sys === null || dia === null) return null;

  return { sys, dia };
}

// BP scoring: higher of systolic/diastolic category
function bloodPressureScore(bp: unknown): number {
  const parsed = parseBloodPressure(bp);
  if (!parsed) return 0;

  const { sys, dia } = parsed;

  // Systolic category points
  const sysPoints =
    sys < 120
      ? 1
      : sys >= 120 && sys <= 129
      ? 2
      : sys >= 130 && sys <= 139
      ? 3
      : 4; // >= 140

  // Diastolic category points (note: 80-89 => stage1 => 3, >=90 => stage2 => 4, <80 => normal/elevated => 1)
  const diaPoints = dia < 80 ? 1 : dia >= 80 && dia <= 89 ? 3 : 4;

  return Math.max(sysPoints, diaPoints);
}

function temperatureScore(temp: unknown): number {
  const t = toFiniteNumber(temp);
  if (t === null) return 0;

  if (t <= 99.5) return 0;
  if (t >= 99.6 && t <= 100.9) return 1;
  if (t >= 101.0) return 2;
  return 0;
}

function ageScore(age: unknown): number {
  const a = toFiniteNumber(age);
  if (a === null) return 0;
  return a > 65 ? 2 : 1; // <40 and 40-65 are both 1 point per spec
}

function hasDataQualityIssue(p: Patient): boolean {
  const bpInvalid = parseBloodPressure(p.blood_pressure) === null;
  const tempInvalid = toFiniteNumber(p.temperature) === null;
  const ageInvalid = toFiniteNumber(p.age) === null;
  return bpInvalid || tempInvalid || ageInvalid;
}

function isFeverPatient(p: Patient): boolean {
  const t = toFiniteNumber(p.temperature);
  return t !== null && t >= 99.6;
}

function totalRiskScore(p: Patient): number {
  return (
    bloodPressureScore(p.blood_pressure) +
    temperatureScore(p.temperature) +
    ageScore(p.age)
  );
}

// -----------------------------
// Robust fetch with retry/backoff
// -----------------------------
async function fetchWithRetry<T>(
  url: string,
  init: RequestInit,
  opts: { retries?: number; baseDelayMs?: number } = {}
): Promise<T> {
  const retries = opts.retries ?? 6;
  const baseDelayMs = opts.baseDelayMs ?? 250;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, init);

      if ([429, 500, 503].includes(res.status)) {
        if (attempt === retries) {
          const body = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status} after retries. Body: ${body}`);
        }
        const jitter = Math.floor(Math.random() * 150);
        const wait = baseDelayMs * Math.pow(2, attempt) + jitter;
        await sleep(wait);
        continue;
      }

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}. Body: ${body}`);
      }

      return (await res.json()) as T;
    } catch (err) {
      // Network errors, JSON parse errors, etc.
      if (attempt === retries) throw err;
      const jitter = Math.floor(Math.random() * 150);
      const wait = baseDelayMs * Math.pow(2, attempt) + jitter;
      await sleep(wait);
    }
  }

  // unreachable
  throw new Error("fetchWithRetry: unreachable");
}

// -----------------------------
// Fetch all patients (pagination)
// -----------------------------
async function fetchAllPatients(): Promise<Patient[]> {
  const all: Patient[] = [];
  let page = 1;
  const limit = 20; // max allowed, fewer pages = less rate limiting

  while (true) {
    const url = `${BASE_URL}/patients?page=${page}&limit=${limit}`;
    const resp = await fetchWithRetry<PatientsResponse>(url, {
      method: "GET",
      headers: {
        "x-api-key": API_KEY!,
        Accept: "application/json",
      },
    });

    // Handle inconsistent "data" formats
    const data = Array.isArray(resp.data) ? resp.data : [];
    // Filter to objects that look like patients
    if (data.length === 0) break; // 🔑 stop only when no data

    for (const item of data) {
      if (item && typeof item === "object" && "patient_id" in (item as any)) {
        all.push(item as Patient);
      }
    }

    page += 1;

    // Small pacing to reduce 429 risk (still okay with retries)
    await sleep(120);
  }

  return all;
}

// -----------------------------
// Submit results
// -----------------------------
type SubmissionBody = {
  high_risk_patients: string[];
  fever_patients: string[];
  data_quality_issues: string[];
};

async function submitAssessment(body: SubmissionBody) {
  const url = `${BASE_URL}/submit-assessment`;
  return fetchWithRetry<any>(
    url,
    {
      method: "POST",
      headers: {
        "x-api-key": API_KEY!,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    },
    { retries: 3, baseDelayMs: 400 }
  );
}

// -----------------------------
// Debugging function
// -----------------------------
// async function main() {
//     console.log("Fetching patients...");
//     const patients = await fetchAllPatients();
//     console.log(`Fetched ${patients.length} patients.`);
//     console.log("Sample patient:", patients[0]);
//   }

// -----------------------------
// Main function
// -----------------------------
async function main() {
  console.log("Fetching patients...");
  const patients = await fetchAllPatients();
  console.log(`Fetched ${patients.length} patients.`);

  const highRisk = new Set<string>();
  const fever = new Set<string>();
  const dataIssues = new Set<string>();

  for (const p of patients) {
    const id = p.patient_id;
    if (!id) continue;

    if (hasDataQualityIssue(p)) dataIssues.add(id);
    if (isFeverPatient(p)) fever.add(id);

    const total = totalRiskScore(p);
    if (total >= 4) highRisk.add(id);
  }

  const submission: SubmissionBody = {
    high_risk_patients: Array.from(highRisk).sort(),
    fever_patients: Array.from(fever).sort(),
    data_quality_issues: Array.from(dataIssues).sort(),
  };

  console.log("Submitting...");
  const result = await submitAssessment(submission);

  console.log("Submission response:");
  console.dir(result, { depth: 10 });
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
