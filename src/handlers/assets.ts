import { Context } from "hono";
import AssetsModel from "../models/assetsModel";
import { getAssetPriceInUSD } from "../services/assetPriceFromCoingecko";

export const addAsset = async (c: Context) => {
    try {
        const { chainId, assetAddress, assetType,coinGeckoId, name, symbol, depositEnabled, withdrawalEnabled,withdrawalFee,minWithdrawalAmount,maxWithdrawalAmount } = await c.req.json();

        /// Validate 
        if (!chainId || !assetAddress || !assetType || !name || !symbol || !coinGeckoId || !minWithdrawalAmount || !maxWithdrawalAmount) {
            return c.json({ message: 'All fields are required' }, 400);
        }

        /// Check if asset already exists
        const existingAsset = await AssetsModel.findOne({ name });
        if (existingAsset) {
            return c.json({ message: 'Asset already exists' }, 400);
        }

        /// Create new asset
        const newAsset = await AssetsModel.create({
            chainId,
            assetAddress,
            assetType,
            coinGeckoId,
            name,
            symbol,
            depositEnabled,
            withdrawalEnabled,
            withdrawalFee,
            minWithdrawalAmount,
            maxWithdrawalAmount

        });
        return c.json({ message: 'Asset created successfully', data: newAsset }, 200);
    } catch (error) {
        return c.json({ message: 'Server error', error }, 500);
    }
}

export const editAsset = async (c: Context) => {
    try {
        let id = c.req.query("id"); 
        const updateData = await c.req.json();

        const updatedAsset = await AssetsModel.findOneAndUpdate({_id:id}, {$set:updateData}, { new: true });

        if (!updatedAsset) {
            return c.json({ message: 'Asset not found' }, 404);
        }

        return c.json({ message: 'Asset updated successfully', data: updatedAsset },200);
    } catch (error) {
        return c.json({ message: 'Server error', error }, 500);
    }
};


export const deleteAsset = async (c: Context) => {
    try {
        const { id } = c.req.query();

        const deletedAsset = await AssetsModel.findByIdAndDelete(id);

        if (!deletedAsset) {
            return c.json({ message: 'Asset not found' }, 404);
        }

        return c.json({ message: 'Asset deleted successfully' });
    } catch (error) {
        return c.json({ message: 'Server error', error }, 500);
    }
};

export const getAssetById = async (c: Context) => {
    try {
        const { id } = c.req.query(); 

        const asset = await AssetsModel.findById({ _id: id });
        if (!asset) {
            return c.json({ message: "Asset not found" }, 404);
        }
        const assetPriceInUsd = await getAssetPriceInUSD(asset.coinGeckoId);

        return c.json({ message:"Asset Successfully Fetch",data: {asset,assetPriceInUsd} }, 200);
    } catch (error) {
        return c.json({ message: "Server error", error }, 500);
    }
};


export const getAssetList = async (c: Context) => {
    try {
        const {depositEnabled,withdrawalEnabled} = c.req.query();
        let filter: any = {};
        if(depositEnabled){
            filter.depositEnabled = depositEnabled === 'true';
        }
        if(withdrawalEnabled){
            filter.withdrawalEnabled = withdrawalEnabled === 'true';
        }
        const assets = await AssetsModel.find(filter);
        return c.json({ message: 'Assets fetched successfully', data: assets });
    } catch (error) {
        return c.json({ message: 'Server error', error }, 500);
    }
};