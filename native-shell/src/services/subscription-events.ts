const listeners = new Set<() => void>();
export const subscriptionRequired = () => listeners.forEach(listener => listener());
export function onSubscriptionRequired(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
