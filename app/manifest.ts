import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Laundrivery - Express Laundry Delivery',
    short_name: 'Laundrivery',
    description: 'Express Laundry Delivery — pesan jemput cucian dari outlet terdekat.',
    start_url: '/customer/dashboard',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#2563eb',
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  }
}
