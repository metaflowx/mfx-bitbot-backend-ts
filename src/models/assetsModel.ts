import mongoose, { Schema, Document } from 'mongoose';


export interface IAsset extends Document {
    /// EVM compatible chain ID
    chainId: number; 
    assetAddress: string;
    assetType: string;
    coinGeckoId: string;
    name: string;
    symbol: string;
    decimals: number;
    depositEnabled: boolean;
    withdrawalEnabled: boolean;
    withdrawalFee: string;
    minWithdrawalAmount: string;
    maxWithdrawalAmount: string;
}


const AssetSchema: Schema = new Schema({
    chainId: { type: Number, required: true },
    assetAddress: { type: String, required: true, unique: true },
    assetType: { type: String, required: true },
    coinGeckoId: { type: String, required: true },
    name: { type: String, required: true },
    symbol: { type: String, required: true },
    decimals: { type: Number, default: 18 },
    depositEnabled: { type: Boolean, default: true },
    withdrawalEnabled: { type: Boolean, default: false },
    withdrawalFee: { type: String, default: "0" },
    minWithdrawalAmount: { type: String, default: "0" },
    maxWithdrawalAmount: { type: String, default: "0" }
}, 
{ timestamps: true, }
);

export default mongoose.model<IAsset>("Asset", AssetSchema);