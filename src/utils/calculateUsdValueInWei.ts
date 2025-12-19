import { Types } from "mongoose"

export const calculateUsdValueInWei = (
  amountInWei: bigint,
  assetPriceInUsd: string
): Types.Decimal128 => {
  const weiPerEth = 10n ** 18n
  
  /// Parse USD price with 6 decimals (standard for USD)
  const [integer, fraction = '00'] = assetPriceInUsd.split('.')
  const fractionPadded = fraction.padEnd(6, '0').slice(0, 6)
  const priceInMicrodollars = BigInt(integer + fractionPadded) /// 6 decimals
  
  /// Calculate USD value in microdollars
  const usdMicro = (amountInWei * priceInMicrodollars) / weiPerEth
  
  /// Convert microdollars (6 decimals) to wei-dollars (18 decimals)
  const usdInWei = usdMicro * (10n ** 12n) /// Add 12 more decimals
  
  return Types.Decimal128.fromString(usdInWei.toString())
}