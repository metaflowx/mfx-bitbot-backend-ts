import mongoose, { Schema, Document } from 'mongoose';

export interface ITransaction extends Document {
  userId: mongoose.Types.ObjectId;
  assetId: mongoose.Types.ObjectId;
  txType: 'deposit' | 'withdrawal';
  amountInWei: string;
  receiverAddress?: string;

  /** Blockchain */
  chain: string;
  txHash?: string;
  logIndex?: number;
  blockNumber?: number;
  retryCount?: number;

  /** Status */
  txStatus:
    | "pending"        /// withdrawal requested
    | "broadcasting"   /// withdrawal sent
    | "detected"       /// deposit log detected
    | "confirming"     /// waiting confirmations
    | "confirmed"      /// chain-confirmed
    | "completed"
    | "failed";

  settlementStatus:
    | "pending"
    | "processing"
    | "crediting"
    | "completed"
    | "failed";

  /** Idempotency */
  uniqueIndex?: string;

  /** Locks */
  lockedAt?: Date;
  lockedBy?: string;

  remarks?: string;
  errorReason?: string;

  createdAt: Date;
  updatedAt: Date;

}

const TransactionSchema = new Schema<ITransaction>(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    assetId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Asset",
      required: true
    },

    chain: {
      type: String,
      required: true,
    },

    txType: {
      type: String,
      enum: ["deposit", "withdrawal"],
      required: true,
    },

    amountInWei: {
      type: String,
      required: true,
      default: "0"
    },

    receiverAddress: {
      type: String
    },

    txHash: {
      type: String,
      unique: true,
    },

    logIndex: {
      type: Number
    },

    blockNumber: {
      type: Number
    },

    txStatus: {
      type: String,
      enum: [
        "pending",
        "broadcasting",
        "detected",
        "confirming",
        "confirmed",
        "completed",
        "failed"
      ],
      default: "pending"
    },

    settlementStatus: {
      type: String,
      enum: [
        "pending",
        "processing",
        "crediting",
        "completed",
        "failed"
      ],
      default: "pending"
    },

    /** Deposit idempotency */
    uniqueIndex: {
      type: String,
      sparse: true,
      unique: true
    },

    /** Cron locking */
    lockedAt: {
      type: Date
    },

    lockedBy: {
      type: String
    },

    remarks: {
      type: String
    },

    errorReason: {
      type: String
    }
  },
  { timestamps: true }
);

TransactionSchema.index({ txStatus: 1, txType: 1 });
TransactionSchema.index({ settlementStatus: 1 });
TransactionSchema.index({ lockedAt: 1 });
TransactionSchema.index({ chain: 1, blockNumber: 1 });
TransactionSchema.index({ userId: 1 });
TransactionSchema.index({ assetId: 1 });




export default mongoose.model<ITransaction>('Transaction', TransactionSchema);