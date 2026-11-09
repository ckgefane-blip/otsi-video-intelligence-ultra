# Prescribed source repository tree
```text
otsi-vie/
  apps/web/                         # Next.js pages and component-level tests
    app/(public)/ ; app/(app)/dashboard; app/(app)/upload; app/(app)/videos/[id]/analyze
    app/(app)/videos/[id]/tactics; app/(app)/reels; app/(app)/studio
    app/(app)/reports; app/(app)/library; app/(app)/exports; app/admin
    components/{shell,player,tracking,timeline,spotlight,reports,billing,library,shared}
    lib/{api,auth,video-clock,coord-transform,query,design-tokens}
  apps/api/                         # NestJS modules
    src/modules/{auth,tenant,projects,matches,players,assets,uploads,videos,jobs,tracking,identity,events,tactics,reels,renders,reports,library,shares,rights,billing,admin,audit}
    src/core/{db,policies,outbox,errors,telemetry}
  services/cv/                      # Python inference workers
    vie_cv/{probe,decode,shots,detector,tracker,reid,ocr,identity,events,calibration,tactics,metrics,schemas}
  services/render/                  # Python+FFmpeg compositor
    vie_render/{timeline,coordinate_map,spotlight,compositor,audio,encode,qa,manifest}
  services/reports/                 # PDF/report worker
  packages/contracts/               # versioned TS zod + JSON Schema + OpenAPI
  packages/ui/                      # design tokens and primitives
  database/migrations/              # verified 001..N migrations, never hand-edit deployed versions
  infra/{terraform,helm,kubernetes,monitoring,runbooks}
  fixtures/{manifests,annotations}  # media licensed and hashed outside public source repo
  tests/{e2e,security,load,cv-golden,render-golden}
  docs/{architecture,ADRs,design,TRACEABILITY.md,BLOCKERS.md}
  .github/workflows/
  Makefile; package.json; pnpm-lock.yaml; pyproject.toml; uv.lock
```

## Ownership rules
Frontend makes requests through typed generated client. API has all tenant auth and entitlement decisions. Temporal workers consume only versioned/validated manifest and signed internal asset handles. MySQL is authoritative state and policy. External users never directly hit inference or rendering pods. Use model adapters for alternative detector/tracker models, provided acceptance metrics and license review pass.
