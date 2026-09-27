# Administrators

Everything here is under **Administration**. Changes apply at once and are audited. Operations (backup, restore, upgrades, monitoring) are in [the runbook](../RUNBOOK.md).

## Before go-live
1. **Bulk import** practices and hospitals, then users, from CSV:
   - download each template;
   - press **Check** and fix the listed lines;
   - press **Import**.

   Hospitals need latitude, longitude and a geofence radius (large campuses 400–600 m).
2. **AD group mapping:** which AD group gives which role and department.
3. **Categories & routing:** which departments each category goes to, and the time limits per priority.
4. **Sites & hours** and **Public holidays** drive the working-hours clocks.
5. **Settings:**
   - `bleed_limits`
   - `escalation_thresholds`
   - `mfa_enforced_roles`
   - `report_daily_recipients` and `report_monthly_recipients`
   - `retention_days`
   - `skylims_mapping`
6. **Canned responses:** standard wording for your teams.

## Everyday
- **New local user:** Add a user and leave the password blank. They get an invitation e-mail to choose their own. To resend it, edit the user and tick **E-mail a link to set a new password**.
- **Locked out or lost phone:** edit the user and tick **Unlock account** or **Reset two-factor**.
- **Leaver:** untick **Active**. Their sessions end at once.
- **System status** must be green every day: worker, backup, audit chain, disk, SkyLIMS feed. **Audit trail** shows every change.
