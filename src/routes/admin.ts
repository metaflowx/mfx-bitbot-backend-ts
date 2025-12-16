import { Hono } from 'hono';
import { admin } from '../handlers';
import { isAdmin, protect } from '../middleware'

const adminRoutes = new Hono();

adminRoutes.post('/create', (c)=> admin.createAdmin(c));  // Create Admin (Only One)
adminRoutes.post('/login', (c)=> admin.loginAdmin(c));    // Login Admin
adminRoutes.get('/profile', protect, isAdmin, (c)=> admin.getAdmin(c));     // Get Admin Profile
adminRoutes.put('/update', protect, isAdmin, (c)=> admin.updateAdmin(c));   // Update Admin Details

export default adminRoutes;