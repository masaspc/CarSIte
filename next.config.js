/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // 画像はすべてローカルの public/images を使うため、リモートホストの許可は不要
    remotePatterns: [],
  },
  webpack: (config) => {
    // next-auth (Auth.js) が使う jose の JWE 復号経路が、Edge Runtime で未サポート扱いの
    // CompressionStream/DecompressionStream を静的参照しているだけの既知の誤検知。
    // 実際には JWE (暗号化トークン) を使っていないため実行時には到達しない。
    config.ignoreWarnings = [
      ...(config.ignoreWarnings ?? []),
      { module: /node_modules\/jose\/dist\/webapi\/lib\/deflate\.js/ },
    ];
    return config;
  },
};

module.exports = nextConfig;
