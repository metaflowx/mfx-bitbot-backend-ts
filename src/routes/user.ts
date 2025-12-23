import { Hono } from 'hono';
import { user } from '../handlers'

import { isAdmin, protect } from '../middleware'

const userRoutes = new Hono();

userRoutes.post('/signup', (c)=> user.createUser(c));
userRoutes.post('/login', (c)=> user.loginUser(c));
userRoutes.get('/list',protect, isAdmin ,(c)=> user.getAllUsers(c));
userRoutes.put('/change/password', protect,(c)=> user.updatePassword(c));
userRoutes.get('/me', protect, (c)=> user.getUserById(c));
userRoutes.delete('/delete', protect, (c)=> user.deleteUser(c));
userRoutes.put('/changeUserStatus/:id', protect, isAdmin, (c)=> user.changeUserStatus(c));

export default userRoutes;