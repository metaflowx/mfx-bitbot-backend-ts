import axios from "axios";

/// Function to fetch asset price from CoinGecko
export const  getAssetPriceInUSD = async (id: string) => {
    try {
      const { data } = await axios.get(
        `https://api.coingecko.com/api/v3/coins/${id}`
      );
      const priceInUsd= data["market_data"]["current_price"]["usd"]
      return priceInUsd;
    } catch (error) {
      console.error('Error fetching asset price:', error);
    }
  }
  