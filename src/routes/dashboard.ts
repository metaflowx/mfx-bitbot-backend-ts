import { Hono } from 'hono';
import { dashboard } from '../handlers';
import { isAdmin, protect } from '../middleware';

const dashboardRoutes = new Hono();

dashboardRoutes.get('/', protect, isAdmin, (c) => dashboard.dashboard(c));

export default dashboardRoutes;
