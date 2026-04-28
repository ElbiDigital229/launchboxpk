import { getPermalink, getBlogPermalink, getAsset } from './utils/permalinks';

export const headerData = {
  links: [
    {
      text: 'Spaces',
      links: [
        { text: 'Coworking Space Lahore', href: getPermalink('/coworking-space-lahore') },
        { text: 'Coworking DHA Lahore', href: getPermalink('/coworking-dha-lahore') },
        { text: 'Services & amenities', href: getPermalink('/services') },
      ],
    },
    {
      text: 'Pricing',
      href: getPermalink('/pricing'),
    },
    {
      text: 'Blogs',
      href: getBlogPermalink(),
    },
    {
      text: 'FAQ',
      href: getPermalink('/faq'),
    },
    {
      text: 'Community',
      href: getPermalink('/our-community'),
    },
    {
      text: 'About',
      href: getPermalink('/about'),
    },
    {
      text: 'Contact',
      href: getPermalink('/contact'),
    },
  ],
  actions: [
    { variant: 'primary', text: 'Book a visit', href: getPermalink('/book-visit') },
  ],
};

export const footerData = {
  links: [
    {
      title: 'Spaces',
      links: [
        { text: 'Coworking Space Lahore', href: getPermalink('/coworking-space-lahore') },
        { text: 'Coworking DHA Lahore', href: getPermalink('/coworking-dha-lahore') },
        { text: 'Pricing', href: getPermalink('/pricing') },
        { text: 'Book a Visit', href: getPermalink('/book-visit') },
      ],
    },
    {
      title: 'Resources',
      links: [
        { text: 'Blogs', href: getBlogPermalink() },
        { text: 'FAQ', href: getPermalink('/faq') },
        { text: 'Our Community', href: getPermalink('/our-community') },
        { text: 'Book a Visit', href: getPermalink('/book-visit') },
      ],
    },
    {
      title: 'Free Resources',
      links: [
        { text: 'Job Finder', href: '#' },
        { text: 'Upwork Bidder', href: '#' },
        { text: 'Resume Builder', href: '#' },
        { text: 'Company Registration', href: '#' },
      ],
    },
    {
      title: 'Contact',
      links: [
        { text: '+92 307 0555515', href: 'tel:+923070555515' },
        { text: 'contact@launchboxpk.com', href: 'mailto:contact@launchboxpk.com' },
        {
          text: 'First Floor, 38-A CCA<br />Sector C, DHA Phase 5<br />Lahore 54000',
          href: 'https://www.google.com/maps/search/?api=1&query=Launchbox+38-A+CCA+Sector+C+DHA+Phase+5+Lahore',
          ariaLabel: 'Launchbox address — open in Google Maps',
        },
        {
          text: 'Find us on Google Maps ↗',
          href: 'https://www.google.com/maps/search/?api=1&query=Launchbox+38-A+CCA+Sector+C+DHA+Phase+5+Lahore',
          ariaLabel: 'Open Launchbox location in Google Maps',
        },
      ],
    },
  ],
  secondaryLinks: [
    { text: 'Pricing', href: getPermalink('/pricing') },
    { text: 'Book a visit', href: getPermalink('/book-visit') },
    { text: 'Terms', href: getPermalink('/terms') },
    { text: 'Privacy', href: getPermalink('/privacy') },
  ],
  socialLinks: [
    { ariaLabel: 'Instagram', icon: 'tabler:brand-instagram', href: 'https://instagram.com/launchboxpk' },
    { ariaLabel: 'Facebook', icon: 'tabler:brand-facebook', href: 'https://facebook.com/launchboxpk' },
    { ariaLabel: 'WhatsApp', icon: 'tabler:brand-whatsapp', href: 'https://wa.me/923070555515' },
  ],
  footNote: `&copy; 2026 Launchbox. All rights reserved. · Crafted slowly, with care in Lahore.`,
};
