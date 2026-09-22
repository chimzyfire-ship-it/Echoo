import type { QuickPlan, QuickPlanCostEstimate } from '@/src/models';

// Pure formatting so estimates read honestly: "Free" only for real zeros,
// "$X–$Y est." windows otherwise, and null stays null — never $0.
export function formatCostEstimate(estimate: QuickPlanCostEstimate | null | undefined): string | null {
  if (!estimate) return null;
  if (estimate.min <= 0 && estimate.max <= 0) return 'Free';
  if (estimate.min === estimate.max) return `~$${estimate.min}`;
  return `$${estimate.min}–$${estimate.max}`;
}

export function formatStopCost(stop: { priceLabel: string; costEstimate?: QuickPlanCostEstimate | null }): string {
  const estimate = formatCostEstimate(stop.costEstimate);
  if (!estimate) return stop.priceLabel || 'Price not listed';
  return `${estimate} est. · ${stop.priceLabel}`;
}

export function formatPlanBudget(plan: QuickPlan): string {
  const estimate = plan.budgetEstimate;
  if (!estimate) return 'Outing cost unknown. Check menus and admission prices.';
  const range = formatCostEstimate(estimate);
  if (!range) return 'Outing cost unknown. Check menus and admission prices.';
  const suffix = estimate.unknownCount > 0
    ? `; ${estimate.unknownCount} place${estimate.unknownCount === 1 ? '' : 's'} still unpriced`
    : '';
  const label = estimate.unknownCount > 0 ? 'Known costs only' : 'Outing estimate';
  if (range === 'Free') return `${label}: Free${suffix}`;
  return `${label}: ${range} per person${suffix}`;
}
