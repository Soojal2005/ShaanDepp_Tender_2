const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api/v1';

export async function fetchBackendHealth() {
  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) throw new Error('Backend unreachable');
  return res.json();
}

export async function fetchTendersFromApi(params = {}) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}/tenders?${qs}`);
  if (!res.ok) throw new Error('Failed to fetch tenders');
  return res.json();
}

export async function fetchCasesFromApi(role = 'subscriber', orgId = 101) {
  const res = await fetch(`${API_BASE}/cases`, {
    headers: {
      'x-user-role': role,
      'x-organization-id': String(orgId)
    }
  });
  if (!res.ok) throw new Error('Failed to fetch cases');
  return res.json();
}

export async function createCaseInApi(caseData, orgId = 101) {
  const res = await fetch(`${API_BASE}/cases`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-organization-id': String(orgId)
    },
    body: JSON.stringify(caseData)
  });
  if (!res.ok) throw new Error('Failed to create case');
  return res.json();
}

export async function submitLeadEnquiry(enquiryData) {
  const res = await fetch(`${API_BASE}/enquiries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(enquiryData)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to submit enquiry');
  }
  return res.json();
}

export async function runVerificationSuitesApi() {
  const res = await fetch(`${API_BASE}/admin/run-verification-suites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!res.ok) throw new Error('Verification runner failed');
  return res.json();
}

export async function retryEmailQueueItem(id, role = 'platform_admin') {
  const res = await fetch(`${API_BASE}/admin/email-queue/${id}/retry`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-role': role
    }
  });
  if (!res.ok) throw new Error('Failed to retry email delivery');
  return res.json();
}
