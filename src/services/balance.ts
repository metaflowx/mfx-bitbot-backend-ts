import { EVMWalletService, chainToChainId } from "./evmWallet";
import { Address, Chain, erc20Abi, formatEther, formatGwei, parseGwei } from "viem";
import transactionModel, { ITransaction } from "../models/transactionModel";
import { privateKeyToAccount } from "viem/accounts";
import { hybridDecryptWithRSA } from "../utils/cryptography";
import walletModel, { IWallet } from "../models/walletModel";
import assetsModel, { IAsset } from "../models/assetsModel";
import { loadRSAKeyPair } from "../utils/loadRSAKeyPair";


const { privateKey: accessTokenPrivateKey } = loadRSAKeyPair();

const ADMIN_COLD_WALLET =`${Bun.env.ADMIN_COLD_WALLET}`
const sweepAdminRatio = 0.5 /// 50%
const sweepKeeperRatio = 0.5 /// 50%

export default class Balance {

    constructor(
        private readonly chain: string
    ) {
        this.chain = chain
    }
    public async evmWorker(title: string, privateKey?: Address) {

        console.info(title);
        const dbData = await transactionModel.find(
            {
                $and: [
                    { 
                        txStatus: "completed" 
                    },
                    { 
                        settlementStatus: "completed" 
                    },
                    {
                        txType:'deposit'
                    }
                ]
            })
        const keeperBotId = `${Bun.env.KEEPER_BOT}`
        if (!keeperBotId) {
            throw new Error("KEEPER_BOT environment variable not set");
        }
        const keeperWallet = await walletModel.findOne({ userId: keeperBotId }) as IWallet
        const keeperkey = hybridDecryptWithRSA(accessTokenPrivateKey, keeperWallet.encryptedPrivateKey, keeperWallet.encryptedSymmetricKey, keeperBotId, keeperWallet.salt)

        const keeperNetwork = new EVMWalletService(this.chain, keeperkey as Address)
        const keeperWalletClient = keeperNetwork.getWalletClient()
        const keeperPublicClient = keeperNetwork.getPublicClient()
        const keeperWalletAccount = keeperNetwork.getAccount()

        if (dbData.length > 0) {
            Promise.all(
                dbData.map(async (data: ITransaction) => {
                    try {
                        const userWallet = await walletModel.findOne({ userId: data.userId._id }) as IWallet;
                        const asset = await assetsModel.findOne({ _id: data.assetId._id }) as IAsset;
                        const balance = await keeperPublicClient.readContract({
                            address: asset.assetAddress as Address,
                            abi: erc20Abi,
                            functionName: "balanceOf",
                            args: [
                                userWallet.address as Address,
                            ],
                            blockTag: 'latest'
                        })
                        console.log(`Token Balance of ${userWallet.address}: ${formatEther(balance)}`)

                        const key = hybridDecryptWithRSA(accessTokenPrivateKey, userWallet.encryptedPrivateKey, userWallet.encryptedSymmetricKey,`${userWallet.userId}`, userWallet.salt)

                        if (Number(balance) > 0 && key) {
                            const account = privateKeyToAccount(key as Address)
                            const gasPrice = await keeperPublicClient.getGasPrice()
                            const gas = await keeperPublicClient.estimateContractGas(
                                {
                                    address: asset.assetAddress as Address,
                                    abi: erc20Abi,
                                    functionName: "transfer",
                                    args: [
                                        keeperWalletAccount.address,
                                        balance as bigint,

                                    ],
                                    blockTag: "latest",
                                    account: account.address
                                }
                            )
                            const txCost = Number(gas) * Number(formatGwei(gasPrice))
                            console.log({ gas, gasPrice, txCost });

                            /// Calculate amounts based on ratio
                            const totalBalance = BigInt(balance.toString());
                            const adminAmount = totalBalance * BigInt(Math.floor(sweepAdminRatio * 100)) / 100n;
                            const keeperAmount = totalBalance * BigInt(Math.floor(sweepKeeperRatio * 100)) / 100n;
                            
                            console.log(`Total Balance: ${formatEther(totalBalance)}`);
                            console.log(`Admin Amount (${sweepAdminRatio * 100}%): ${formatEther(adminAmount)}`);
                            console.log(`Keeper Amount (${sweepKeeperRatio * 100}%): ${formatEther(keeperAmount)}`);

                            const coinBalance = await keeperPublicClient.getBalance({
                                address: userWallet.address as Address,
                                blockTag: 'latest'
                            })

                            console.log(`User Native Coin Balance: ${coinBalance}`);


                            if (Number(coinBalance) < Number(parseGwei(txCost.toString()))) {
                                const hash = await keeperWalletClient.sendTransaction({
                                    account: keeperWalletAccount,
                                    chain: {
                                        id: chainToChainId[this.chain],

                                    } as Chain,
                                    to: userWallet.address as Address,
                                    value: parseGwei(txCost.toString()) - coinBalance,
                                })

                                console.log(`Transfer Native COIN for gas fee : ${hash}`);
                            }
                                const { request:keeperHotWallet } = await keeperPublicClient.simulateContract({
                                address: asset.assetAddress as Address,
                                abi: erc20Abi,
                                functionName: "transfer",
                                args: [
                                    keeperWalletAccount.address,
                                    BigInt((parseFloat(balance.toString())).toString()),

                                ],
                                gas: gas,
                                gasPrice: gasPrice,
                                blockTag: 'latest',
                                account
                            })
                            const txHash1 = await keeperWalletClient.writeContract(keeperHotWallet)
                            console.info(`Transfer Token to KeeperHotWallet: ${txHash1}`);
                            await keeperPublicClient.waitForTransactionReceipt({ hash: txHash1 });

                            const { request:adminColdWallet } = await keeperPublicClient.simulateContract({
                                address: asset.assetAddress as Address,
                                abi: erc20Abi,
                                functionName: "transfer",
                                args: [
                                    ADMIN_COLD_WALLET as Address,
                                    adminAmount,

                                ],
                                gas: gas,
                                gasPrice: gasPrice,
                                blockTag: 'latest',
                                account: keeperWalletAccount
                            })
                            const txHash2 = await keeperWalletClient.writeContract(adminColdWallet)
                            console.info(`Transfer Token to KeeperHotWallet: ${txHash2}`);
                            await keeperPublicClient.waitForTransactionReceipt({ hash: txHash2 });

                        }
                    } catch (error) {
                        console.log(error);

                    }
                })
            )
        }
    }
}