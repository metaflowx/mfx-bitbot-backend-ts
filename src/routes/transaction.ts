import { Hono } from 'hono';
import { transaction } from '../handlers';
import { isAdmin, protect } from '../middleware';

const transactionRoutes = new Hono();

transactionRoutes.post('/deposit/request',protect, (c) => transaction.txRequestForDeposit(c)); 
transactionRoutes.post('/deposit/confirmed',protect, (c) => transaction.txConfirmRequestForDeposit(c)); 
transactionRoutes.post('/withdraw', protect, (c) => transaction.txRequestForWithdrawal(c)); 
transactionRoutes.get('/read/list',protect, (c) => transaction.getTransactionList(c)); 
transactionRoutes.get('/read/one',protect, (c) => transaction.getTransactionById(c));

export default transactionRoutes;
