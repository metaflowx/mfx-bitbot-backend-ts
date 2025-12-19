import mongoose from "mongoose";

export const connectMongoDB= async(DATABASE_URL:string,_dbName:string)=> {
    try {
      const DB_OPTIONS = {
        dbName: _dbName,
        autoIndex: false,
        socketTimeoutMS: 45000,
        serverSelectionTimeoutMS: 60000
      }
      await mongoose.connect(DATABASE_URL, DB_OPTIONS)
      console.log('[database]: connected successfully to MongoDB')
    } catch (error) {
      console.log(error)
    }
  }


