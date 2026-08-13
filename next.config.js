/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // 画像はすべてローカルの public/images を使うため、リモートホストの許可は不要
    remotePatterns: [],
  },
  webpack: (config) => {
    // next-auth (Auth.js) はアダプタなし=JWTセッション戦略のため、セッションcookieは
    // 毎回 jose の EncryptJWT/jwtDecrypt で暗号化される (JWE, A256CBC-HS512)。
    // つまり JWE 自体は使っている。
    //
    // ここで抑制しているのは、jose の JWE 復号経路が Edge Runtime で未サポート扱いの
    // CompressionStream/DecompressionStream を静的参照している点だけ。この参照は
    // JWE の "zip" ヘッダ (圧縮拡張) が設定されているときにしか実行されず、
    // @auth/core もこのアプリの auth.ts も zip を設定していないため、
    // 実行時にはこのコードパスへ到達しない。
    //
    // 将来 zip 圧縮を有効にする場合は、この抑制が本物の Edge Runtime 障害を
    // 隠してしまうため、必ずこの ignoreWarnings を外して再評価すること。
    config.ignoreWarnings = [
      ...(config.ignoreWarnings ?? []),
      { module: /node_modules\/jose\/dist\/webapi\/lib\/deflate\.js/ },
    ];
    return config;
  },
};

module.exports = nextConfig;
