import { Hono } from 'hono';
import { wallet } from '../handlers';
import { protect, isAdmin } from '../middleware';

const walletRoutes = new Hono();

walletRoutes.get('/read/one',protect,(c)=> wallet.userWallet(c))
walletRoutes.put('/update',protect, isAdmin, (c)=> wallet.updateWalletBalanceByAdmin(c))
walletRoutes.get('/asset/balance',protect, (c) => wallet.userBalanceAtAsset(c)); 
walletRoutes.get('/asset/balances',protect, (c) => wallet.totalUserBalanceAtAsset(c)); 

export default walletRoutes;
