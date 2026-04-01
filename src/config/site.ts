export const SITE = {
  name: 'TieBack',
  title: 'TieBack | Enterprise Compliance & EU DPP Platform',
  description: 'Enterprise-grade compliance platform for Digital Product Passports (EU DPP) and GS1 Digital Link resolution. Secure your physical products with item-level authentication.',
  url: 'https://tieback.io',
  twitterHandle: '@tieback',
  socials: {
    twitter: 'https://twitter.com/tieback',
    linkedin: 'https://linkedin.com/company/tieback',
  },
  image: {
    src: '/favicon.svg',
    alt: 'TieBack Logo',
  },
} as const;

export type SiteConfig = typeof SITE;
