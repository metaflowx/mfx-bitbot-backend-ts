import { Hono } from 'hono';
import { investment } from '../handlers';
import { isAdmin, protect } from '../middleware';

const investmentRoutes = new Hono();

investmentRoutes.get('/read/list',protect, (c) => investment.getInvestmentList(c)); // Public - Get All investment List
investmentRoutes.post('/invest', protect, (c) => investment.invest(c));
investmentRoutes.post('/redeem', protect, (c) => investment.redeem(c));
investmentRoutes.post('/read/stats', protect, (c) => investment.stats(c));

export default investmentRoutes;
