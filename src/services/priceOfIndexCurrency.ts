import { getAssetPriceInUSD } from "./assetPriceFromCoingecko";

export const priceOfIndexCurrency = async (): Promise<{
  btcPrice: string;
  // ethPrice: string;
  // solanaPrice: string;
}> => {
  const [btcPrice] = await Promise.all([
    getAssetPriceInUSD("bitcoin"),
    // getAssetPriceInUSD("ethereum"),
    // getAssetPriceInUSD("solana"),
  ]);

  return {
    btcPrice,
    // ethPrice,
    // solanaPrice,
  };
};

