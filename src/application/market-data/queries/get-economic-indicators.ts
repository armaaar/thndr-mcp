import { z } from 'zod';
import type { EconomicIndicators } from '../../../domain/market-data/research';
import { type InputOf, Query } from '../../use-case';
import type { MarketDataDependencies } from '../dependencies';

const DEFAULT_POINTS = 12;

const input = {
  points: z
    .number()
    .int()
    .min(1)
    .max(500)
    .default(DEFAULT_POINTS)
    .describe(`Latest N points of each series (default ${DEFAULT_POINTS})`),
};

export type EconomicIndicatorsView = EconomicIndicators & { units: string };

export class GetEconomicIndicators extends Query<typeof input, EconomicIndicatorsView> {
  readonly name = 'get_economic_indicators';
  readonly title = 'Egypt economic indicators';
  readonly description =
    'Egypt’s macroeconomic data as Thndr shows it: headline readings (inflation, CBE deposit/lending rates, ' +
    '12-month T-bill yield, unemployment, GDP) and the latest points of the inflation (monthly and yearly), CBE ' +
    'overnight rates, treasury-bill returns and quarterly unemployment series, with Thndr’s source descriptions.';
  readonly context = 'market-data';
  readonly input = input;

  constructor(private readonly deps: MarketDataDependencies) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<EconomicIndicatorsView> {
    const points = params.points ?? DEFAULT_POINTS;
    const data = await this.deps.research.getEconomicIndicators();
    return {
      ...data,
      units:
        'Rates, inflation, yields and unemployment are percent; overview `change` is the change from the previous ' +
        'reading (Thndr "growth"); GDP amounts are in EGP / USD and gdpGrowth* in percent.',
      inflationYearly: data.inflationYearly.slice(-points),
      inflationMonthly: data.inflationMonthly.slice(-points),
      overnightRates: data.overnightRates.slice(-points),
      treasuryBills: data.treasuryBills.slice(-points),
      unemployment: data.unemployment.slice(-points),
    };
  }
}
