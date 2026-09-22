import path from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: { root: path.resolve(process.cwd(), "../..") },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${process.env.REALTIME_INTERNAL_URL || "http://127.0.0.1:3001"}/api/:path*` }];
  },
};

export default nextConfig;
