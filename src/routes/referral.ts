import { Hono } from 'hono';
import { referral } from '../handlers';
import { protect, isAdmin } from '../middleware';

const referralRoutes = new Hono();

referralRoutes.get('/read/one', protect, (c) => referral.referralDetail(c));
referralRoutes.get('/read/stats', protect, (c) => referral.getReferralStatsDetailed(c)); 
referralRoutes.get('/read/level', protect, (c) => referral.getReferralUsersByLevel(c)); // Get referral stats for the logged-in user

referralRoutes.put('/disableReferral/:id', protect, isAdmin, (c) => referral.disableReferral(c));  

export default referralRoutes;
