/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: ['toyota.jp', 'nissan.co.jp', 'honda.co.jp', 'mazda.co.jp', 'subaru.jp'],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
}

module.exports = nextConfig
