import mongoose, { Schema, Document } from "mongoose";


export interface IReferralLevel {
  referrals: mongoose.Types.ObjectId[];
  count: number;
  earnings: number;
  missedEarnings: number;
}

export interface IReferralStats {
  levels: Map<string, IReferralLevel>;
}

export interface IReferralEarnings extends Document {
  userId: mongoose.Types.ObjectId;
  referrerBy?: mongoose.Types.ObjectId;
  referralCode: string;
  activeTillLevel: number;
  referralStats: IReferralStats;
  processedInvestments: mongoose.Types.ObjectId[];
  totalInvestment: number;
  totalEarnings: number;
  enableReferral: boolean;

}

const referralLevelSchema = new Schema(
  {
    referrals: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    count: { type: Number, default: 0 },
    earnings: { type: Number, default: 0 },
    missedEarnings: { type: Number, default: 0 },
  },
  { _id: false }
);


const referralEarningsSchema = new Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    referrerBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    referralCode: {
      type: String,
      required: true,
      unique: true,
    },
    activeTillLevel: {
      type: Number,
      default: 4, /// 🔥 Level 1–4 always active
      min: 1,
      max: 15,
    },
    referralStats: {
      levels: {
        type: Map,
        of: referralLevelSchema,
        default: () => {
          const levels: any = {};
          for (let i = 1; i <= 15; i++) {
            levels[`level${i}`] = {
              referrals: [],
              count: 0,
              earnings: 0,
              missedEarnings: 0,
            };
          }
          return levels;
        },
      },
    },
    processedInvestments: {
      type: [mongoose.Schema.Types.ObjectId],
      default: [],
    },
    totalEarnings: {
      type: Number,
      default: 0,
    },
    totalInvestment: {
      type: Number,
      default: 0,
    },
    enableReferral: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);;
referralEarningsSchema.index({ referrerBy: 1 });

export default mongoose.model<IReferralEarnings>(
  "ReferralEarnings",
  referralEarningsSchema
);

