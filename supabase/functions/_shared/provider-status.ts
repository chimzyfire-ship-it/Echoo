// Only fixed diagnostic codes cross the API boundary. Never expose Google's
// raw error text, project identifiers, credentials, or the user's query.
export type ProviderFailure = "billing_disabled" | "api_disabled" | "key_rejected" | "quota_exceeded" | "timeout" | "not_configured" | "unavailable";

export async function providerFailure(response: Response): Promise<ProviderFailure> {
  const body = await response.json().catch(() => null);
  const reasons = (Array.isArray(body?.error?.details) ? body.error.details : [])
    .map((item: any) => String(item?.reason || "")).join(" ");
  const message = String(body?.error?.message || "");
  if (/BILLING_DISABLED|BILLING_NOT_ACTIVE/.test(reasons) || /billing.*(?:disabled|not enabled)|enable billing/i.test(message)) return "billing_disabled";
  if (/SERVICE_DISABLED|API_DISABLED/.test(reasons)) return "api_disabled";
  if (response.status === 429 || /QUOTA|RATE_LIMIT/.test(reasons)) return "quota_exceeded";
  if ([401, 403].includes(response.status) || /API_KEY/.test(reasons)) return "key_rejected";
  return "unavailable";
}
