import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { AuditQuery } from "@otsi-vie/contracts";
import { AuthGuard, CurrentPrincipal, Principal, Roles } from "../../core/auth";
import { AuditService } from "./audit.service";

@Controller("v1/audit-events")
@UseGuards(AuthGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Roles("OWNER", "ADMIN")
  list(@Query() query: unknown, @CurrentPrincipal() p: Principal) {
    return this.audit.list(AuditQuery.parse(query), p);
  }
}
