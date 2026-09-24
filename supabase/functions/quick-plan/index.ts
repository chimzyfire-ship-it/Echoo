import { handleQuickPlan } from "./service.ts";
import { withMobileAccess } from '../_shared/mobile-access.ts';

Deno.serve(withMobileAccess(handleQuickPlan, 'routes'));
