import { EVMWalletService, chainToChainId } from "./evmWallet";
import { Address, Chain, erc20Abi, formatEther, formatGwei, parseGwei } from "viem";
import transactionModel, { ITransaction } from "../models/transactionModel";
import { privateKeyToAccount } from "viem/accounts";
import { hybridDecryptWithRSA } from "../utils/cryptography";
import walletModel, { IWallet } from "../models/walletModel";
import assetsModel, { IAsset } from "../models/assetsModel";
import { loadRSAKeyPair } from "../utils/loadRSAKeyPair";


const { privateKey: accessTokenPrivateKey } = loadRSAKeyPair();

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
        const coldWallet = await walletModel.findOne({ userId: keeperBotId }) as IWallet
        const coldkey = hybridDecryptWithRSA(accessTokenPrivateKey, coldWallet.encryptedPrivateKey, coldWallet.encryptedSymmetricKey, keeperBotId, coldWallet.salt)
        const coldNetwork = new EVMWalletService(this.chain, coldkey as Address)
        const coldWalletClient = coldNetwork.getWalletClient()
        const coldPublicClient = coldNetwork.getPublicClient()
        const coldWalletAccount = coldNetwork.getAccount()

        if (dbData.length > 0) {
            Promise.all(
                dbData.map(async (data: ITransaction) => {
                    try {
                        const userWallet = await walletModel.findOne({ userId: data.userId._id }) as IWallet;
                        const asset = await assetsModel.findOne({ _id: data.assetId._id }) as IAsset;
                        const balance = await coldPublicClient.readContract({
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
                            const gasPrice = await coldPublicClient.getGasPrice()
                            const gas = await coldPublicClient.estimateContractGas(
                                {
                                    address: asset.assetAddress as Address,
                                    abi: erc20Abi,
                                    functionName: "transfer",
                                    args: [
                                        coldWalletAccount.address,
                                        balance as bigint,

                                    ],
                                    blockTag: "latest",
                                    account: account.address
                                }
                            )
                            const txCost = Number(gas) * Number(formatGwei(gasPrice))
                            console.log({ gas, gasPrice, txCost });

                            const coinBalance = await coldPublicClient.getBalance({
                                address: userWallet.address as Address,
                                blockTag: 'latest'
                            })

                            console.log(`User Native Coin Balance: ${coinBalance}`);


                            if (Number(coinBalance) < Number(parseGwei(txCost.toString()))) {
                                const hash = await coldWalletClient.sendTransaction({
                                    account: coldWalletAccount,
                                    chain: {
                                        id: chainToChainId[this.chain],

                                    } as Chain,
                                    to: userWallet.address as Address,
                                    value: parseGwei(txCost.toString()) - coinBalance,
                                })

                                console.log(`Transfer Native COIN for gas fee : ${hash}`);
                            }

                            const { request } = await coldPublicClient.simulateContract({
                                address: asset.assetAddress as Address,
                                abi: erc20Abi,
                                functionName: "transfer",
                                args: [
                                    coldWalletAccount.address,
                                    balance as bigint,

                                ],
                                gas: gas,
                                gasPrice: gasPrice,
                                blockTag: 'latest',
                                account
                            })
                            const txHash = await coldWalletClient.writeContract(request)
                            console.info(`Transfer Token: ${txHash}`);

                        }
                    } catch (error) {
                        console.log(error);

                    }
                })
            )
        }
    }
}