import { EVMWalletService } from "./evmWallet"
import transactionModel, { ITransaction } from "../models/transactionModel"
import walletModel, { IWallet } from "../models/walletModel"
import { updateTx } from "../handlers/transaction"
import assetsModel, { IAsset } from "../models/assetsModel"
import { Address, parseAbiItem } from "viem"

export default class Watcher {
    constructor(private readonly chain: string) {
        this.chain = chain
    }

    public async evmWorker(title: string) {
        console.info(title)
        const network = new EVMWalletService(this.chain)
        const client = network.getPublicClient()
        const blockNumber = await client.getBlockNumber()

        /// ✅ Step 1: Find confirmed Deposits
        const dbData = await transactionModel.find({
            $and: [
                { txStatus: "confirmed" },  // Watch for pending deposits
                { txType: "deposit" }
            ]
        }).populate("userId").populate("assetId")


        if (dbData.length > 0) {
            await Promise.all(
                dbData.map(async (data: ITransaction) => {
                    try {
                        const userWallet = await walletModel.findOne({ userId: data.userId._id }) as IWallet
                        const asset = await assetsModel.findOne({ _id: data.assetId._id }) as IAsset

                        /// ✅ Step 2: Check for Deposit Events
                        const logs = await client.getLogs({
                            address: asset.assetAddress as Address,
                            event: asset.assetAddress !== '0x0000000000000000000000000000000000001010'
                                ? parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')
                                : parseAbiItem('event LogTransfer(address indexed token,address indexed from,address indexed to,uint256 amount,uint256 input1,uint256 input2,uint256 output1,uint256 output2)'),
                            args: { to: userWallet.address as Address },
                            fromBlock: blockNumber - BigInt(2000),
                            toBlock: blockNumber
                        })
                        console.log({ logs })

                        if (logs.length > 0) {
                            await Promise.all(logs.map(async (log: any) => {
                                try {
                                    /// ✅ Step 3: Prevent Duplicate Transaction Insertion
                                    const updateData = {
                                        amountInWei: asset.assetAddress !== '0x0000000000000000000000000000000000001010'
                                            ? log.args.value.toString()
                                            : log.args.amount.toString(),
                                        txHash: log.transactionHash.toString(),
                                        txStatus: "processing"
                                    }
                                    const query = {
                                        id: data._id
                                    }
                                    const info = {
                                        message: "Deposit",
                                        balance: false
                                    }
                                    await updateTx(query, updateData, info)

                                    console.log(`Transaction added:`)

                                } catch (error: any) {
                                    console.log({ error })
                                    if (error.code === 11000) {
                                        console.log(`Duplicate transaction skipped: ${log.transactionHash}`)
                                    } else {
                                        console.error("Transaction error:", error)
                                    }
                                }
                            }))
                        }
                    } catch (e) {
                        console.log({ e })
                    }
                })
            )
        }

        /// ✅ Step 4: Confirm Deposits and Update deposit 
        const pendingTransactions = await transactionModel.find({
            $and: [
                {
                    txStatus: "processing",
                    settlementStatus: "pending",
                    txType: 'deposit'

                }
            ]
        }).populate("userId").populate("assetId")
        console.log({ pendingTransactions })

        if (pendingTransactions.length > 0) {
            await Promise.all(
                pendingTransactions.map(async (data: ITransaction) => {
                    try {
                        const tx = await client.getTransactionReceipt({ hash: data.txHash as Address })

                        if (tx.status === "success") {
                            const updateData = {
                                txStatus: "completed",
                                settlementStatus: "processing",
                            }
                            const query = {
                                id: data._id
                            }
                            const info = {
                                message: "Deposit",
                                balance: false
                            }
                            await updateTx(query, updateData, info)

                            console.log(`Deposit confirmed: ${data.txHash}`)

                        } else {
                            console.log(`Deposit failed: ${data.txHash}`)
                        }
                    } catch (error) {
                        console.log("Error processing deposit:", error)
                    }
                })
            )
        }

        /// ✅ Step 5: Confirm Deposits and Update Wallet Balance
        const pendingWithdrawalTx = await transactionModel.find({
            $and: [
                {
                    txStatus: "completed",
                    settlementStatus: "processing",
                    txType: "deposit"
                }
            ]
        }).populate("userId").populate("assetId")
        console.log({ pendingWithdrawalTx })

        if (pendingWithdrawalTx.length > 0) {
            await Promise.all(
                pendingWithdrawalTx.map(async (data: ITransaction) => {
                    try {
                        const updateData = {
                            settlementStatus: "completed",
                            remarks: "Deposit Successfully"
                        }
                        const balanceData = {
                            userId: data.userId._id,
                            assetId: data.assetId,
                            amountInWei: data.amountInWei
                        }
                        const query = {
                            id: data._id
                        }
                        const info = {
                            message: "Deposit",
                            balance: true
                        }
                        const tx1 = await updateTx(query, updateData, info, balanceData)
                        console.log(tx1.message)
                    } catch (error) {
                        console.log("Error processing deposit:", error)
                    }
                })
            )
        }

    }
}

