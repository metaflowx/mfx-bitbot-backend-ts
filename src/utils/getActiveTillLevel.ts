export const LEVEL_CONFIG: Record<number, { percentage: number; idRequirement: number }> = {
  1: { percentage: 25, idRequirement: 0 }, /// 25%
  2: { percentage: 3, idRequirement: 0 },

  3: { percentage: 2, idRequirement: 0 },
  4: { percentage: 2, idRequirement: 0 },

  5: { percentage: 2, idRequirement: 50 },
  6: { percentage: 1, idRequirement: 100 },
  7: { percentage: 0.5, idRequirement: 150 }, /// 0.5%

  8: { percentage: 0.5, idRequirement: 200 },

  9: { percentage: 0.40, idRequirement: 400 },
  10:{ percentage: 0.30, idRequirement: 600 },

  11:{ percentage: 0.30, idRequirement: 800 },
  12:{ percentage: 0.20, idRequirement: 1500 },
  13:{ percentage: 0.20, idRequirement: 3000 },
  14:{ percentage: 0.20, idRequirement: 5000 },
  15:{ percentage: 0.20, idRequirement: 8000 },
};


export const getActiveTillLevel = (totalInvestment: number): number => {
  let activeLevel = 4; /// default (1–4 always active)

  for (let level = 5; level <= 15; level++) {
    if (totalInvestment >= LEVEL_CONFIG[level].idRequirement) {
      activeLevel = level;
    } else {
      break;
    }
  }

  return activeLevel;
};
