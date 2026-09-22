// Run hourly from a trusted scheduler after configuring the function secrets.
// This script sends notifications; tests must never invoke it with real secrets.
const base = process.env.SUPABASE_URL;
const secret = process.env.PLANNING_CRON_SECRET;
const gatewayKey = process.env.SUPABASE_ANON_KEY;
if (!base || !secret || !gatewayKey)
  throw new Error(
    "Set SUPABASE_URL, SUPABASE_ANON_KEY and PLANNING_CRON_SECRET.",
  );
let after = null;
let totals = { sent: 0, failed: 0 };
for (let page = 0; page < 1000; page++) {
  const response = await fetch(
    `${base.replace(/\/$/, "")}/functions/v1/planning-notifications`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: gatewayKey,
        Authorization: `Bearer ${gatewayKey}`,
        "x-planning-cron-secret": secret,
      },
      body: JSON.stringify({ after }),
      signal: AbortSignal.timeout(65000),
    },
  );
  if (!response.ok)
    throw new Error(
      `Notification page failed (${response.status}); inspect the server logs.`,
    );
  const result = await response.json();
  totals.sent += result.sent || 0;
  totals.failed += result.failed || 0;
  if (!result.nextAfter) {
    console.log(JSON.stringify(totals));
    break;
  }
  if (result.nextAfter === after)
    throw new Error("Notification cursor did not advance.");
  after = result.nextAfter;
  if (page === 999)
    throw new Error("Page limit reached; increase the job capacity.");
}
