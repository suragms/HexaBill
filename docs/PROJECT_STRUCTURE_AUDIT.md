# HexaBill Project Structure Audit

**Date:** March 8, 2025  
**Purpose:** Identify redundant, obsolete, and duplicate files. Recommend consolidation.

---

## Summary

| Category | Count | Recommendation |
|----------|-------|----------------|
| Root .md files | 15+ | Consolidate, archive superseded |
| Duplicate files | 2 | Merge DEPLOY_CHECKLIST vs DEPLOYMENT_CHECKLIST |
| Superseded by docs/ | 2+ | Move to docs/archive or delete |
| Planning (keep) | 4 | Keep, optional for roadmap |
| Migration/one-off | 2 | Move to docs/ or archive |
| Obsolete | 1 | Update or remove |
| Backend tenant-specific | 2 | Move to docs/migrations/ |

---

## Root .md Files (15+)

### Duplicate – Consolidate

| File | Issue | Action |
|------|-------|--------|
| DEPLOY_CHECKLIST.md | Duplicate of DEPLOYMENT_CHECKLIST | Merge into one; delete the other |
| DEPLOYMENT_CHECKLIST.md | Duplicate | Keep this name; merge content from DEPLOY_CHECKLIST |

### Superseded by docs/ – Archive or Remove

| File | Issue | Action |
|------|-------|--------|
| HEXABILL_CODEBASE_DEEP_ANALYSIS.md | Superseded by docs/HEXABILL_ULTIMATE_DEEP_ANALYSIS.md | Move to docs/archive/ or delete |
| FEATURES_AND_IMPROVEMENTS_AUDIT.md | Superseded by docs/ | Move to docs/archive/ |

### Planning – Keep (Optional)

| File | Purpose | Action |
|------|---------|--------|
| HEXABILL_ERP_REDESIGN_PLAN.md | Redesign roadmap | Keep |
| HEXABILL_VC_LEVEL_ANALYSIS.md | VC-level analysis | Keep |
| MARKETING_FLOW_AND_FEATURE_PROMPTS.md | Marketing prompts | Keep |
| MARKETING_PAGE_SPEC.md | Page spec | Keep |

### Migration / One-Off – Move to docs/

| File | Purpose | Action |
|------|---------|--------|
| RENDER_RUN_MIGRATION_NOW.md | Render migration run | Move to docs/archive/ or docs/migrations/ |
| MIGRATION_INSTRUCTIONS.md | Migration steps | Move to docs/archive/ or docs/ |

### Obsolete – Update or Remove

| File | Issue | Action |
|------|-------|--------|
| NOT_BUILT.md | Many items now built | Update or remove |

### Core – Keep

| File | Purpose |
|------|---------|
| README.md | Project overview |
| DATABASE_SCHEMA.md | Schema reference |
| OWNER_WORKFLOW.md | Owner workflow |
| SECURITY (in backend) | Security notes |

---

## Backend Files

| Path | Issue | Action |
|------|-------|--------|
| backend/data/README-ZAYOGA-MIGRATION.md | Tenant-specific migration | Move to docs/migrations/ |
| backend/data/ZAYOGA_RECONCILIATION.md | Tenant-specific | Move to docs/migrations/ |
| backend/HexaBill.Api/logs/ | Runtime logs | Ensure in .gitignore |

---

## Folder Structure Summary

| Area | File Count | Notes |
|------|------------|-------|
| frontend/hexabill-ui/src | 116 files | No major clutter |
| backend (HexaBill.Api) | 217 .cs files | Modular (Modules/*) |
| docs/ | 6+ files | Primary source for analysis |

---

## Recommendations

1. **Create `docs/archive/`** – For superseded analysis files
2. **Consolidate deploy checklists** – One file: DEPLOYMENT_CHECKLIST.md
3. **Move tenant migrations** – backend/data/*-ZAYOGA*.md → docs/migrations/
4. **Update NOT_BUILT.md** – Mark completed items, or remove
5. **Keep** – README, DATABASE_SCHEMA, OWNER_WORKFLOW, SECURITY

## Optional: Move Superseded Files to docs/archive/

To archive superseded analysis files:

1. Create `docs/archive/` directory
2. Move: HEXABILL_CODEBASE_DEEP_ANALYSIS.md, FEATURES_AND_IMPROVEMENTS_AUDIT.md → docs/archive/
3. Move migration files: RENDER_RUN_MIGRATION_NOW.md, MIGRATION_INSTRUCTIONS.md → docs/archive/
4. Consolidate: DEPLOY_CHECKLIST.md content → DEPLOYMENT_CHECKLIST.md, delete DEPLOY_CHECKLIST.md

This keeps the root clean and docs/ as the single source of truth.

---

*Audit generated as part of HexaBill Ultimate Deep Analysis expansion.*
