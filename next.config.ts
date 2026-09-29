import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: process.env.NEXT_PUBLIC_APP_BASE_PATH || "",
};

export default nextConfig;
