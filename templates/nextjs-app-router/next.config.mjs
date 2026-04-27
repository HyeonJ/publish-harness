/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 워크스페이스 패키지 트랜스파일 (monorepo 시 사용 — 빈 배열로 두면 무시)
  transpilePackages: [],
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
