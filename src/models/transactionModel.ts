import mongoose, { Schema, Document } from 'mongoose';

export interface ITransaction extends Document {
  userId: mongoose.Types.ObjectId;
  assetId: mongoose.Types.ObjectId;
  txType: 'deposit' | 'withdrawal';
  amountInWei: string;
  receiverAddress: string;
  txStatus: 'pending' | 'confirmed' | 'processing' | 'completed' | 'failed';
  settlementStatus: 'pending' | 'completed' | 'failed';
  remarks: string;
  txHash: string;
}

const TransactionSchema: Schema = new Schema({
  userId: { type: mongoose.Types.ObjectId, required: true,ref: 'User' },
  assetId: {type: mongoose.Types.ObjectId, required: true,ref: 'Asset' },
  txType: { type: String,required: true, enum: ['deposit', 'withdrawal'] },
  amountInWei: { type: String, default: "0" },
  receiverAddress: {
    type: String,
    default:'0x'
  },
  txStatus: {
    type: String,
    default: "pending",
    enum: ['pending','confirmed','processing', 'completed', 'failed'], 
  },
  settlementStatus:{
    type: String,
    default: "pending",
    enum: ['pending','processing' ,'completed','failed'],
  },
  remarks: {
    type: String,
  },
  txHash: { type: String, unique:true,required:true},
},{ timestamps: true })

// TransactionSchema.index({ userId: 1, assetId: 1, txType: 1 });


export default mongoose.model<ITransaction>('Transaction', TransactionSchema);