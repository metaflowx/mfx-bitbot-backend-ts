import { Hono } from 'hono';
import { admin } from '../handlers';
import { isAdmin, protect } from '../middleware'

const adminRoutes = new Hono();

adminRoutes.post('/create', (c)=> admin.createAdmin(c));  // Create Admin (Only One)  // Login Admin
adminRoutes.put('/update', protect, isAdmin, (c)=> admin.updateAdmin(c));   // Update Admin Details

export default adminRoutes;