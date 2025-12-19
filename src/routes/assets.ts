import { Hono } from 'hono';
import { assets } from '../handlers';
import { isAdmin, protect } from '../middleware';

const assetsRoutes = new Hono();

assetsRoutes.post('/create',protect, isAdmin, (c) => assets.addAsset(c)); 
assetsRoutes.put('/edit', protect,isAdmin, (c) => assets.editAsset(c)); 
assetsRoutes.delete('/remove', protect, isAdmin, (c) => assets.deleteAsset(c));
assetsRoutes.get('/read/list', (c) => assets.getAssetList(c)); 
assetsRoutes.get('/read/one', (c) => assets.getAssetById(c));

export default assetsRoutes;
