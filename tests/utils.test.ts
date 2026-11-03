import { describe, expect, it } from 'vitest';
import { getFallbackLogo, getSafeLogo } from '../lib/utils';

describe('university logos', () => {
  it('uses local initials instead of unavailable Clearbit logos', () => {
    expect(getSafeLogo('Thapar Institute', 'https://logo.clearbit.com/thapar.edu'))
      .toBe(getFallbackLogo('Thapar Institute'));
  });

  it('preserves available logo URLs', () => {
    expect(getSafeLogo('University', 'https://example.edu/logo.svg'))
      .toBe('https://example.edu/logo.svg');
  });
});
