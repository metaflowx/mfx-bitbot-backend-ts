import { EVMWalletService, chainToChainId } from "./evmWallet";
import { Address, Chain, erc20Abi, formatEther } from "viem";
import transactionModel, { ITransaction } from "../models/transactionModel";
import walletModel, { IWallet } from "../models/walletModel";
import assetsModel, { IAsset } from "../models/assetsModel";
import { privateKeyToAccount } from "viem/accounts";
import { hybridDecryptWithRSA } from "../utils/cryptography";
import { loadRSAKeyPair } from "../utils/loadRSAKeyPair";

const { privateKey: accessTokenPrivateKey } = loadRSAKeyPair();

const ADMIN_COLD_WALLET = Bun.env.ADMIN_COLD_WALLET as Address;
const ADMIN_RATIO = 60n;
const KEEPER_RATIO = 40n;
const GAS_BUFFER_PERCENT = 110n; /// +10%
const RETRIES = 3;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function retryTx<T>(
  fn: () => Promise<T>,
  retries = RETRIES,
  delayMs = 2000
): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const msg = (e?.message || "").toLowerCase();
      const retryable =
        msg.includes("underpriced") ||
        msg.includes("nonce") ||
        msg.includes("replacement") ||
        msg.includes("timeout") ||
        msg.includes("temporarily");

      if (!retryable || i === retries - 1) break;
      await sleep(delayMs);
    }
  }
  throw lastErr;
}

export default class Balance {
  private keeperPublicClient: any;
  private keeperWalletClient: any;
  private keeperWalletAccount: any;

  constructor(private readonly chain: string) {}

  public async evmWorker(title: string) {
    console.info(title);

    const dbData = await transactionModel.find({
      txStatus: "completed",
      settlementStatus: "completed",
      txType: "deposit",
    });
    if (!dbData.length) return;

    const keeperBotId = Bun.env.KEEPER_BOT!;
    const keeperWallet = (await walletModel.findOne({
      userId: keeperBotId,
    })) as IWallet;

    const keeperKey = hybridDecryptWithRSA(
      accessTokenPrivateKey,
      keeperWallet.encryptedPrivateKey,
      keeperWallet.encryptedSymmetricKey,
      keeperBotId,
      keeperWallet.salt
    );

    const keeperNetwork = new EVMWalletService(
      this.chain,
      keeperKey as Address
    );
    this.keeperPublicClient = keeperNetwork.getPublicClient();
    this.keeperWalletClient = keeperNetwork.getWalletClient();
    this.keeperWalletAccount = keeperNetwork.getAccount();

    /// 🔐 SEQUENTIAL
    for (const data of dbData) {
      await this.processTransaction(data);
    }
  }

  private async processTransaction(data: ITransaction) {
    try {
        
      const userWallet = await walletModel.findOne({
        userId: data.userId._id,
      }) as IWallet;

      const asset = await assetsModel.findOne({
        _id: data.assetId._id,
      }) as IAsset;
      console.log({wallet:userWallet.address});
      
      /// 1) Read user token balance
      const total = (await this.keeperPublicClient.readContract({
        address: asset.assetAddress as Address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [userWallet.address as Address],
        blockTag: 'latest'
      })) as bigint;

      console.log(`Token Balance of ${userWallet.address}: ${formatEther(total)}`)

    //   if (total === 0n) return;

      /// 2) Decrypt user key
      const userKey = hybridDecryptWithRSA(
        accessTokenPrivateKey,
        userWallet.encryptedPrivateKey,
        userWallet.encryptedSymmetricKey,
        `${userWallet.userId}`,
        userWallet.salt
      );
      if (!userKey) return;

      const userAccount = privateKeyToAccount(userKey as Address);

      /// 3) Split
      const adminAmount = (total * ADMIN_RATIO) / 100n;
      const keeperAmount = total - adminAmount;

      /// 4) Estimate gas for BOTH tx
      const gasAdmin =
        await this.keeperPublicClient.estimateContractGas({
          address: asset.assetAddress as Address,
          abi: erc20Abi,
          functionName: "transfer",
          args: [ADMIN_COLD_WALLET, adminAmount],
          account: userAccount.address,
          blockTag: "latest",
        });

      const gasKeeper =
        await this.keeperPublicClient.estimateContractGas({
          address: asset.assetAddress as Address,
          abi: erc20Abi,
          functionName: "transfer",
          args: [this.keeperWalletAccount.address, keeperAmount],
          account: userAccount.address,
          blockTag: "latest",
        });

      const gasPrice = await this.keeperPublicClient.getGasPrice();
      const totalGasNeeded =
        ((gasAdmin as bigint + gasKeeper as bigint) * gasPrice * GAS_BUFFER_PERCENT) / 100n;

      /// 5) Ensure user has native gas
      const nativeBal = await this.keeperPublicClient.getBalance({
        address: userWallet.address as Address,
      });

      if (nativeBal < totalGasNeeded) {
        await retryTx(() =>
          this.keeperWalletClient.sendTransaction({
            account: this.keeperWalletAccount,
            chain: { id: chainToChainId[this.chain] } as Chain,
            to: userWallet.address as Address,
            value: totalGasNeeded - nativeBal,
          })
        );
      }

      // 6) TX → ADMIN (wait)
      const txAdmin = await retryTx(() =>
        this.keeperWalletClient.writeContract({
          address: asset.assetAddress as Address,
          abi: erc20Abi,
          functionName: "transfer",
          args: [ADMIN_COLD_WALLET, adminAmount],
          account: userAccount,
          gas: gasAdmin,
        })
      );
      await this.keeperPublicClient.waitForTransactionReceipt({
        hash: txAdmin,
      });

      // 7) TX → KEEPER (wait)
      const txKeeper = await retryTx(() =>
        this.keeperWalletClient.writeContract({
          address: asset.assetAddress as Address,
          abi: erc20Abi,
          functionName: "transfer",
          args: [this.keeperWalletAccount.address, keeperAmount],
          account: userAccount,
          gas: gasKeeper,
        })
      );
      await this.keeperPublicClient.waitForTransactionReceipt({
        hash: txKeeper,
      });

      console.info(
        `✅ Split success | User: ${userWallet.address} | Admin: ${adminAmount} | Keeper: ${keeperAmount}`
      );
    } catch (e) {
      console.error("❌ Split failed:", e);
    }
  }
}
