import { describe, it, expect } from 'vitest';
import { handClass, allHandClasses } from '../src/hand.js';

describe('handClass', () => {
  it('classifies suited hands high rank first', () => {
    expect(handClass(['As', 'Ks'])).toBe('AKs');
  });

  it('classifies offsuit hands regardless of input order', () => {
    expect(handClass(['Kd', 'As'])).toBe('AKo');
  });

  it('classifies pairs', () => {
    expect(handClass(['7c', '7d'])).toBe('77');
  });
});

describe('allHandClasses', () => {
  it('has exactly 169 classes', () => {
    expect(allHandClasses()).toHaveLength(169);
    expect(new Set(allHandClasses()).size).toBe(169);
  });
});
