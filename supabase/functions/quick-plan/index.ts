import { handleQuickPlan } from "./service.ts";

Deno.serve((req) => handleQuickPlan(req));
