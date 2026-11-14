import { Router } from 'express';
import { adminMiddleware } from '../middleware/auth';
import usersRoutes from './admin/users';
import deviceRulesRoutes from './admin/deviceRules';
import decksRoutes from './admin/decks';
import dashboardRoutes from './admin/dashboard';
import securityRoutes from './admin/security';
import featureFlagsRoutes from './admin/featureFlags';

const router = Router();
router.use(adminMiddleware);

router.use(usersRoutes);
router.use(deviceRulesRoutes);
router.use(decksRoutes);
router.use(dashboardRoutes);
router.use(securityRoutes);
router.use(featureFlagsRoutes);

export { sendDeckToUser } from './admin/decks';

export default router;
