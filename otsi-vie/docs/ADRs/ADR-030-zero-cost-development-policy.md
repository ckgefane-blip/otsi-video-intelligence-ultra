# ADR-030: Zero-cost development policy (permanent owner directive)

Status: accepted (owner directive 2026-10-27; recorded in `CLAUDE.md` §9). Supersedes any earlier note that suggested a purchase.

## Decision
Only free tools, software, models, frameworks, libraries, environments and infrastructure are used — open-source or genuinely free to use
for the intended commercial application. Local tools and existing hardware (Intel Core Ultra 7 155H, Intel Arc iGPU) are preferred.
No paid licence, subscription, commercial API plan, cloud GPU, paid infrastructure, auto-renewing trial or credit-based service is
recommended, purchased or activated, and the owner is never asked to buy anything. When a technology has a paid dependency, a free
alternative that keeps the approved functionality is researched and evaluated; features are not removed to avoid cost. When no free
solution exists, the limitation is documented and other work continues.

"Free of charge" and "legally cleared" are different: licence conditions (for example Cisco OpenH264's patent coverage, which its licence
limits to uses that receive no remuneration) are recorded for counsel (E3) and nothing is commercially activated without the owner.

## Effect on earlier decisions
| Earlier item | Now |
|---|---|
| E4 "buy a libx264 commercial licence" (MP4 review) | **Withdrawn** — not an option under this policy |
| H.264 / AAC patent-pool licences | Not purchasable under this policy. Paths: hardware encoders shipped with existing Intel/Windows components, Cisco's free OpenH264 binary, and royalty-free VP9/AV1 + Opus exports; counsel (free advice route to be chosen by the owner) assesses the H.264/AAC position |
| Detector / models | Already free: RT-DETRv2 (Apache-2.0), OpenVINO (Apache-2.0), PyTorch (BSD-3) |
| Billing (Block 13) | A payment provider's account is free to open but charges per transaction; integration is built behind `BillingProvider`, live activation stays an owner decision |
| Hosting / deployment (Block 15) | Plan for the owner's existing hardware and free, self-hosted software (MySQL Community, Node, Python, our LGPL FFmpeg); no paid cloud |
| Labelled football footage | Owner-held footage annotated with free tools (e.g. CVAT, Apache-2.0/MIT, self-hosted) instead of paid datasets or labelling services |

## Free components in use (all zero cost)
Node.js, pnpm, NestJS, Fastify, Next.js, React, Tailwind, zod, MySQL 8.4 Community, Python, OpenVINO, PyTorch CPU, transformers, SciPy,
pyarrow, our LGPL FFmpeg (oneVPL, libvpx, dav1d, SVT-AV1, Opus), Docker Desktop (owner's existing installation; its licence terms for the
owner's organisation size are an owner check), Playwright, Microsoft Defender (part of Windows), Cisco OpenH264 binary (free download).
