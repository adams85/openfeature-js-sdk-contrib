import { flagKeyPropertyKey, flagdPropertyKey, targetingPropertyKey } from './common';
import MurmurHash3 from 'imurmurhash';
import type { EvaluationContext, EvaluationContextValue, Logger } from '@openfeature/core';

export const fractionalRule = 'fractional';

export function fractionalFactory(logger: Logger) {
  return function fractional(data: unknown, context: EvaluationContext): string | null {
    if (!Array.isArray(data)) {
      return null;
    }

    const args = Array.from(data);
    if (args.length < 2) {
      logger.debug(`Invalid ${fractionalRule} configuration: Expected at least 2 buckets, got ${args.length}`);
      return null;
    }

    const flagdProperties = context[flagdPropertyKey] as { [key: string]: EvaluationContextValue };
    if (!flagdProperties) {
      logger.debug('Missing flagd properties, cannot perform fractional targeting');
      return null;
    }

    let bucketBy: string | undefined;
    let buckets: unknown[];

    if (typeof args[0] == 'string') {
      bucketBy = args[0];
      buckets = args.slice(1, args.length);
    } else {
      bucketBy = `${flagdProperties[flagKeyPropertyKey]}${context[targetingPropertyKey]}`;
      if (!bucketBy) {
        logger.debug('Missing targetingKey property, cannot perform fractional targeting');
        return null;
      }

      buckets = args;
    }

    let bucketingList;

    try {
      bucketingList = toBucketingList(buckets);
    } catch (err) {
      logger.debug(`Invalid ${fractionalRule} configuration: `, (err as Error).message);
      return null;
    }

    // hash in signed 32 format. Bitwise operation here works in signed 32 hence the conversion
    const hash = new MurmurHash3(bucketBy).result() | 0;
    const bucket = (Math.abs(hash) / 2147483648) * 100;

    let sum = 0;
    for (let i = 0; i < bucketingList.fractions.length; i++) {
      const bucketEntry = bucketingList.fractions[i];

      sum += relativeWeight(bucketingList.totalWeight, bucketEntry.fraction);

      if (sum >= bucket) {
        return bucketEntry.variant;
      }
    }

    return null;
  };
}

function relativeWeight(totalWeight: number, weight: number): number {
  if (weight == 0) {
    return 0;
  }
  return (weight * 100) / totalWeight;
}
function toBucketingList(from: unknown[]): {
  fractions: { variant: string; fraction: number }[];
  totalWeight: number;
} {
  // extract bucketing options
  const bucketingArray: { variant: string; fraction: number }[] = [];

  let totalWeight = 0;
  for (let i = 0; i < from.length; i++) {
    const entry = from[i];
    if (!Array.isArray(entry)) {
      throw new Error('Invalid bucket entries');
    }

    if (entry.length == 0 || entry.length > 2) {
      throw new Error('Invalid bucketing entry. Requires at least a variant');
    }

    if (typeof entry[0] !== 'string') {
      throw new Error('Bucketing require variant to be present in string format');
    }

    let weight = 1;
    if (entry.length >= 2) {
      if (typeof entry[1] !== 'number') {
        throw new Error('Bucketing require bucketing percentage to be present');
      }
      weight = entry[1];
    }

    bucketingArray.push({ fraction: weight, variant: entry[0] });
    totalWeight += weight;
  }

  return { fractions: bucketingArray, totalWeight };
}
