import { Hono } from 'hono';
import { assets } from '../handlers';
import { isAdmin, protect } from '../middleware';

const assetsRoutes = new Hono();

assetsRoutes.post('/add', (c) => assets.addAsset(c)); 
assetsRoutes.put('/edit', protect, (c) => assets.editAsset(c)); 
assetsRoutes.delete('/delete/:id', protect, isAdmin, (c) => assets.deleteAsset(c));
assetsRoutes.get('/list', (c) => assets.getAssetList(c)); 
assetsRoutes.get('/', (c) => assets.getAssetById(c));

export default assetsRoutes;
