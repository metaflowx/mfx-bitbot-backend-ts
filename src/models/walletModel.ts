import mongoose, { Schema, Document } from 'mongoose'

export interface IWallet extends Document {
    userId: mongoose.Types.ObjectId
    address: string
    encryptedPrivateKey: string
    encryptedSymmetricKey: string
    salt: string
    assets: Array<{
        assetId: mongoose.Types.ObjectId
        balance: mongoose.Types.Decimal128
    }>,
    totalBalanceInWeiUsd: mongoose.Types.Decimal128
    totalWithdrawInWeiUsd: mongoose.Types.Decimal128
    totalDepositInWeiUsd: mongoose.Types.Decimal128
    totalFlexibleBalanceInWeiUsd: mongoose.Types.Decimal128
    totalLockInBtc: mongoose.Types.Decimal128
    lastWithdrawalAt?: Date
    createdAt: Date
    updatedAt: Date
}

const walletSchema: Schema = new Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        address: {
            type: String,
            required: true,
            validate: {
                validator: (v: string) => /^0x[a-fA-F0-9]{40}$/.test(v),
                message: (props: any) => `${props.value} is not a valid Ethereum address!`,
            },
        },
        encryptedSymmetricKey: {
            type: String,
            required: true,
        },
        encryptedPrivateKey: {
            type: String,
            required: true,
        },
        salt: {
            type: String,
            required: true,
        },
        assets: [
            {
                assetId: {
                    type: mongoose.Types.ObjectId,
                    ref: 'Asset',
                    required: true,
                },
                balance: {
                    type: mongoose.Schema.Types.Decimal128,
                    default: () => new mongoose.Types.Decimal128('0')
                }
            },
        ],
        totalBalanceInWeiUsd: {
            type: mongoose.Schema.Types.Decimal128,
            default: () => new mongoose.Types.Decimal128('0')
        },
        totalWithdrawInWeiUsd: {
            type: mongoose.Schema.Types.Decimal128,
            default: () => new mongoose.Types.Decimal128('0')
        },
        totalDepositInWeiUsd: {
            type: mongoose.Schema.Types.Decimal128,
            default: () => new mongoose.Types.Decimal128('0')
        },
        totalFlexibleBalanceInWeiUsd: {
            type: mongoose.Schema.Types.Decimal128,
            default: () => new mongoose.Types.Decimal128('0')
        },
        totalLockInBtc: {
            type: mongoose.Schema.Types.Decimal128,
            default: () => new mongoose.Types.Decimal128('0')
        },
        lastWithdrawalAt: {
            type: Date
        }
    },
    { timestamps: true }
)

export default mongoose.model<IWallet>('Wallet', walletSchema)
