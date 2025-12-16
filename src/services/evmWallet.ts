import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { createPublicClient, createWalletClient, http } from "viem"
import type { Address, Chain, PrivateKeyAccount, PublicClient, WalletClient } from "viem"
import rpc from "../config/rpc.json"


type RpcConfig = [
    {
        [chain: string]: {
            name: string,
            httpRpc: string
        }
    }
]
const config: RpcConfig = JSON.parse(JSON.stringify(rpc))

export const chainToChainId: Record<string, number> = {
    "bsc": 56,
    "polygon": 137,
    "amoy": 80002,
}

export class EVMWalletService {
    private readonly evmPublicClient: PublicClient
    private readonly evmWalletClient: WalletClient
    private readonly evmAccount?: PrivateKeyAccount

    constructor(readonly chain: string, readonly privateKey?: Address) {
        const data = config.filter((item: any) => {
            return item[chain]
        })[0]

        this.evmPublicClient = createPublicClient({
            transport: http(data[chain].httpRpc),
            chain: {
                id: chainToChainId[chain],
            } as Chain
        })
        this.evmWalletClient = createWalletClient({
            transport: http(data[chain].httpRpc),
            chain: {
                id: chainToChainId[chain],
            } as Chain,
        })
        if (privateKey) {
            this.evmAccount = privateKeyToAccount(privateKey);
        }
    }
    public getPublicClient(): PublicClient {
        return this.evmPublicClient
    }
    public getWalletClient(): WalletClient {
        return this.evmWalletClient
    }
    public getAccount() {
        return this.evmAccount as PrivateKeyAccount
    }
}


export const generateRandomWallet = () => {
    const key = generatePrivateKey()
    const wallet = privateKeyToAccount(key)
    return {
        privateKey: key,
        address: wallet.address,
    }
}
