import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
    email: string; 
    isEmailVerified?: boolean;
    role: string;
    password: string;
    status:string;
  }
  

  const UserSchema: Schema = new Schema(
    {
      email: {
        type: String,
      },
      isEmailVerified: {
        type: Boolean,
        default: false,
      },
      role: {
        type: String,
        required: true,
        enum: ['ADMIN', 'USER','KEEPER-BOT'],
        default: "USER"
      },
      password: {
        type: String,
        required: true,
      },
      status: {
        type: String,
        required: true,
        enum: ['ACTIVE','DELETE','INACTIVE','BLOCK','FREEZE'],
        default: "ACTIVE"
      },
    },
    {
      timestamps: true, 
    }
  );
  
  export default mongoose.model<IUser>('User', UserSchema);