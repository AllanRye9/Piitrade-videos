import { Router, Response } from 'express';
import { AuthedRequest, requirePermission } from '../../middleware/requireAdmin';
import { audit } from '../../lib/core/audit';
import { changedSections, getSettingsRecord, saveSettings } from '../../lib/core/settings';

const router = Router();

// GET /api/admin/settings — the full settings document plus who last changed it.
router.get('/', requirePermission('settings.view'), async (_req: AuthedRequest, res: Response) => {
  res.json(await getSettingsRecord());
});

// PUT /api/admin/settings — a partial patch ({ maintenance: { enabled: true } } is enough); validated as a whole.
router.put('/', requirePermission('settings.edit'), async (req: AuthedRequest, res: Response) => {
  const { settings: before } = await getSettingsRecord();
  const after = await saveSettings(req.body, req.admin!.email);
  const changed = changedSections(before, after);
  if (changed.length) audit(req, 'settings.update', 'settings', 'site', changed.join(', '));
  res.json({ ...(await getSettingsRecord()), changed });
});

export default router;
