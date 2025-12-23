import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IInvestment extends Document {
    userId:  Types.ObjectId;
    amount: string;
    type: 'ADD' | 'REMOVE';
    btcValue: string;
    btcPrice: string;
    createdAt: Date
    updatedAt: Date
}


const InvestmentSchema: Schema = new Schema(
    {
        userId: { 
            type:  Types.ObjectId, 
            ref: 'User', 
            required: true,
            index: true 
        },
        amount: { 
            type: Number, 
            required: true
        },
        type: { 
            type: String, 
            enum: ['ADD', 'REMOVE'], 
            required: true 
        },
        btcValue: { 
            type: String, 
            required: true
        },
        btcPrice: { 
            type: String, 
            required: true
        }
    },
    { timestamps: true }
);
export default mongoose.model<IInvestment>('Investment', InvestmentSchema);
